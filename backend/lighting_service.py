"""Lighting controller state management + MQTT handling.

Topic contract (firmware pronto, não alterar):
- TJS/<ID>/Lnn               → estado real (true/false), retido
- TJS/<ID>/Lnn/SET           ← comando ON/OFF/TOGGLE (NÃO retido)
- TJS/<ID>/Lnn/MODO          → modo (true=AUTO, false=MANUAL), retido
- TJS/<ID>/Lnn/MODO/SET      ← AUTO | MANUAL (NÃO retido)
- TJS/<ID>/TODOS/SET         ← true/false (NÃO retido) — aciona 16 circuitos
- TJS/<ID>/Xnn               → 1/0 — entrada interruptor de parede
- TJS/<ID>/ONLINE            → 1/0 (LWT, retido)
- TJS/<ID>/REDE              → ETH | WIFI (retido)
"""
from __future__ import annotations
import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Set
from db import db
from ws_manager import manager

logger = logging.getLogger("lighting")

L_TOPIC_RE = re.compile(r"^L(\d{2})(?:/(SET|MODO(?:/SET)?))?$")
X_TOPIC_RE = re.compile(r"^X(\d{2})$")
CMD_TIMEOUT_SEC = 3.0


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LightingService:
    def __init__(self):
        # mqtt_id -> {online, rede, ultimo_contato, circuitos: {1..16: {estado, modo, last_input}}}
        self.controllers: Dict[str, dict] = {}
        # ids seen publishing Lnn (candidates for lighting controller)
        self.lighting_ids: Set[str] = set()
        # Pending commands: {(mqtt_id, kind, circuito): {log_id, requested_at, prev_value, task}}
        # kind: "estado" or "modo"
        self.pending: Dict[tuple, dict] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._mqtt_svc = None  # reference to the main MQTT service

    def set_mqtt(self, mqtt_svc):
        self._mqtt_svc = mqtt_svc

    def set_loop(self, loop):
        self._loop = loop

    def _get(self, mqtt_id: str) -> dict:
        c = self.controllers.get(mqtt_id)
        if not c:
            c = {
                "mqtt_id": mqtt_id,
                "online": False,
                "rede": None,
                "ultimo_contato": None,
                "circuitos": {i: {"estado": None, "modo": None, "last_input": None} for i in range(1, 17)},
            }
            self.controllers[mqtt_id] = c
        return c

    async def restore(self):
        """Restore last known lighting states from DB."""
        async for doc in db.lighting_states.find({}):
            did = doc.get("mqtt_id")
            if not did:
                continue
            c = self._get(did)
            c["online"] = bool(doc.get("online", False))
            c["rede"] = doc.get("rede")
            c["ultimo_contato"] = doc.get("ultimo_contato")
            saved = doc.get("circuitos", {}) or {}
            for k, v in saved.items():
                try:
                    i = int(k)
                except (TypeError, ValueError):
                    continue
                if 1 <= i <= 16 and isinstance(v, dict):
                    c["circuitos"][i].update({
                        "estado": v.get("estado"),
                        "modo": v.get("modo"),
                        "last_input": v.get("last_input"),
                    })
            self.lighting_ids.add(did)

    # ------- Topic routing -------
    def is_lighting_subtopic(self, var: str) -> bool:
        """Return True if the sub-path after TJS/<id>/ looks like a lighting topic."""
        if var in ("ONLINE", "REDE"):
            return False  # ambiguous — we only tag ONLINE/REDE for IDs already known as lighting
        if var == "TODOS/SET":
            return True
        return bool(L_TOPIC_RE.match(var) or X_TOPIC_RE.match(var))

    async def handle(self, mqtt_id: str, var: str, payload: str) -> bool:
        """Try to handle as lighting topic. Return True if handled."""
        # Lighting-tagging rule: an ID becomes a lighting controller when it publishes L## or X##
        if L_TOPIC_RE.match(var) or X_TOPIC_RE.match(var):
            self.lighting_ids.add(mqtt_id)

        m = L_TOPIC_RE.match(var)
        if m:
            circ = int(m.group(1))
            sub = m.group(2)  # None | "SET" | "MODO" | "MODO/SET"
            if sub is None:
                await self._apply_estado(mqtt_id, circ, payload)
                return True
            if sub == "MODO":
                await self._apply_modo(mqtt_id, circ, payload)
                return True
            # "SET" / "MODO/SET" são comandos — ignorar echo
            return True

        m = X_TOPIC_RE.match(var)
        if m:
            circ = int(m.group(1))
            await self._apply_input(mqtt_id, circ, payload)
            return True

        if var in ("ONLINE", "REDE") and mqtt_id in self.lighting_ids:
            if var == "ONLINE":
                await self._apply_online(mqtt_id, payload)
            else:
                await self._apply_rede(mqtt_id, payload)
            return True

        return False

    async def _apply_estado(self, mqtt_id: str, circuito: int, payload: str):
        c = self._get(mqtt_id)
        new = payload.strip().lower() in ("true", "1", "on")
        prev = c["circuitos"][circuito]["estado"]
        c["circuitos"][circuito]["estado"] = new
        c["ultimo_contato"] = now_iso()
        c["online"] = True  # if receiving L##, controller is online
        await self._log_event(mqtt_id, circuito, "estado", str(new).lower(), "campo" if prev is not None else "snapshot")
        await self._resolve_pending(mqtt_id, "estado", circuito)
        await self._broadcast(mqtt_id, {"circuito": circuito, "estado": new})
        await self._persist(mqtt_id)

    async def _apply_modo(self, mqtt_id: str, circuito: int, payload: str):
        c = self._get(mqtt_id)
        v = payload.strip().lower()
        new = v in ("true", "1", "auto", "automatico", "automático")
        c["circuitos"][circuito]["modo"] = new
        c["ultimo_contato"] = now_iso()
        await self._log_event(mqtt_id, circuito, "modo", "AUTO" if new else "MANUAL", "campo")
        await self._resolve_pending(mqtt_id, "modo", circuito)
        await self._broadcast(mqtt_id, {"circuito": circuito, "modo": new})
        await self._persist(mqtt_id)

    async def _apply_input(self, mqtt_id: str, circuito: int, payload: str):
        c = self._get(mqtt_id)
        pressed = payload.strip() == "1"
        if pressed:
            c["circuitos"][circuito]["last_input"] = now_iso()
            await self._log_event(mqtt_id, circuito, "entrada", "1", "campo")
            await self._broadcast(mqtt_id, {"circuito": circuito, "last_input": c["circuitos"][circuito]["last_input"]})

    async def _apply_online(self, mqtt_id: str, payload: str):
        c = self._get(mqtt_id)
        online = payload.strip() == "1"
        c["online"] = online
        c["ultimo_contato"] = now_iso()
        await self._log_event(mqtt_id, 0, "online", "1" if online else "0", "campo")
        await self._broadcast(mqtt_id, {"online": online})
        await self._persist(mqtt_id)

    async def _apply_rede(self, mqtt_id: str, payload: str):
        c = self._get(mqtt_id)
        c["rede"] = payload.strip().upper()
        c["ultimo_contato"] = now_iso()
        await self._broadcast(mqtt_id, {"rede": c["rede"]})
        await self._persist(mqtt_id)

    async def _broadcast(self, mqtt_id: str, delta: dict):
        payload = {"mqtt_id": mqtt_id, **delta}
        await manager.broadcast("lighting_telemetry", payload)

    async def _persist(self, mqtt_id: str):
        c = self.controllers.get(mqtt_id)
        if not c:
            return
        try:
            await db.lighting_states.update_one(
                {"mqtt_id": mqtt_id},
                {"$set": {
                    "mqtt_id": mqtt_id,
                    "online": c["online"],
                    "rede": c["rede"],
                    "ultimo_contato": c["ultimo_contato"],
                    "circuitos": {str(k): v for k, v in c["circuitos"].items()},
                    "updated_at": now_iso(),
                }},
                upsert=True,
            )
        except Exception:
            logger.exception("failed to persist lighting state")

    async def _log_event(self, mqtt_id: str, circuito: int, tipo: str, valor: str, origem: str, usuario: str = None):
        try:
            await db.lighting_events.insert_one({
                "timestamp": now_iso(),
                "mqtt_id": mqtt_id,
                "circuito": circuito,
                "tipo": tipo,
                "valor": valor,
                "origem": origem,
                "usuario": usuario,
            })
        except Exception:
            logger.exception("failed to log lighting event")

    # ------- Commands -------
    def _publish(self, topic: str, payload: str):
        """Publish SEM retained (retain=False) via main MQTT service."""
        if not self._mqtt_svc:
            logger.warning("MQTT svc não configurado")
            return
        cli = getattr(self._mqtt_svc, "_client", None)
        if not cli or not self._mqtt_svc.connected:
            logger.warning("MQTT desconectado — comando %s não enviado", topic)
            return
        cli.publish(topic, payload, qos=1, retain=False)

    async def send_circuit_command(self, mqtt_id: str, circuito: int, value: str, user_id: str = None) -> dict:
        prefix = self._mqtt_svc.topic_prefix if self._mqtt_svc else "TJS"
        topic = f"{prefix}/{mqtt_id}/L{circuito:02d}/SET"
        c = self._get(mqtt_id)
        if not c["online"]:
            raise ValueError("Controladora offline")
        prev = c["circuitos"][circuito]["estado"]
        self._publish(topic, value)
        await self._log_event(mqtt_id, circuito, "comando", value, "app", user_id)
        await self._set_pending(mqtt_id, "estado", circuito, prev)
        return {"topic": topic, "value": value, "retain": False}

    async def send_mode_command(self, mqtt_id: str, circuito: int, mode: str, user_id: str = None) -> dict:
        prefix = self._mqtt_svc.topic_prefix if self._mqtt_svc else "TJS"
        topic = f"{prefix}/{mqtt_id}/L{circuito:02d}/MODO/SET"
        c = self._get(mqtt_id)
        if not c["online"]:
            raise ValueError("Controladora offline")
        prev = c["circuitos"][circuito]["modo"]
        v = "AUTO" if mode.upper() in ("AUTO", "TRUE", "1") else "MANUAL"
        self._publish(topic, v)
        await self._log_event(mqtt_id, circuito, "cmd_modo", v, "app", user_id)
        await self._set_pending(mqtt_id, "modo", circuito, prev)
        return {"topic": topic, "value": v, "retain": False}

    async def send_all_command(self, mqtt_id: str, on: bool, user_id: str = None) -> dict:
        prefix = self._mqtt_svc.topic_prefix if self._mqtt_svc else "TJS"
        topic = f"{prefix}/{mqtt_id}/TODOS/SET"
        v = "true" if on else "false"
        self._publish(topic, v)
        await self._log_event(mqtt_id, 0, "comando_todos", v, "app", user_id)
        return {"topic": topic, "value": v, "retain": False}

    async def _set_pending(self, mqtt_id: str, kind: str, circuito: int, prev_value):
        key = (mqtt_id, kind, circuito)
        # Cancel existing pending for same key
        existing = self.pending.get(key)
        if existing and existing.get("task"):
            existing["task"].cancel()
        task = asyncio.create_task(self._pending_timeout(key))
        self.pending[key] = {"requested_at": time.time(), "prev_value": prev_value, "task": task}
        await manager.broadcast("lighting_pending", {"mqtt_id": mqtt_id, "circuito": circuito, "kind": kind})

    async def _resolve_pending(self, mqtt_id: str, kind: str, circuito: int):
        key = (mqtt_id, kind, circuito)
        p = self.pending.pop(key, None)
        if p and p.get("task"):
            p["task"].cancel()
            await manager.broadcast("lighting_pending_resolved", {"mqtt_id": mqtt_id, "circuito": circuito, "kind": kind})

    async def _pending_timeout(self, key):
        try:
            await asyncio.sleep(CMD_TIMEOUT_SEC)
        except asyncio.CancelledError:
            return
        p = self.pending.pop(key, None)
        if not p:
            return
        mqtt_id, kind, circuito = key
        await manager.broadcast("lighting_pending_timeout", {
            "mqtt_id": mqtt_id, "circuito": circuito, "kind": kind,
            "prev_value": p.get("prev_value"),
        })

    # ------- Snapshot for new WS clients -------
    def snapshot(self) -> list:
        out = []
        for mid, c in self.controllers.items():
            if mid not in self.lighting_ids:
                continue
            out.append({
                "mqtt_id": mid,
                "online": c["online"],
                "rede": c["rede"],
                "ultimo_contato": c["ultimo_contato"],
                "circuitos": [
                    {"numero": i, **c["circuitos"][i]} for i in range(1, 17)
                ],
            })
        return out


lighting_svc = LightingService()
