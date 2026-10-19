"""Catálogo de modelos de controladora + inventário de todas as controladoras (qualquer categoria)."""
from __future__ import annotations
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin
from db import db

logger = logging.getLogger("controllers")
router = APIRouter(prefix="/api")

CATEGORIAS = ["FANCOIL", "ILUMINACAO", "CAG", "HIDRAULICA", "OUTRO"]
CATEGORIA_LABEL = {"FANCOIL": "Fancoil", "ILUMINACAO": "Iluminação", "CAG": "CAG", "HIDRAULICA": "Hidráulica", "OUTRO": "Outro"}
COMMON_VARS = {"TIPO", "MODELO", "VERSAO", "ONLINE", "RESET", "RSSI", "UPTIME", "OTA/STATE"}
CREATE_VARS = COMMON_VARS - {"ONLINE"}  # ONLINE sozinho não cria entrada (evita lixo do broker)
MODEL_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{1,31}$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def version_key(v: str) -> tuple:
    try:
        return tuple(int(x) for x in v.split("."))
    except (ValueError, AttributeError):
        return (0,)


# ---------------- Registro em memória (persistido em db.controllers) ----------------
class ControllerRegistry:
    def __init__(self):
        self.items: Dict[str, dict] = {}

    async def restore(self):
        async for d in db.controllers.find({}, {"_id": 0}):
            self.items[d["device_id"]] = d
        logger.info("Inventário de controladoras: %d", len(self.items))

    async def handle(self, device_id: str, var: str, payload: str):
        if var not in COMMON_VARS:
            return
        c = self.items.get(device_id)
        if c is None:
            if var not in CREATE_VARS:
                return
            c = self.items[device_id] = {"device_id": device_id}
        p = payload.strip()
        c["last_seen"] = now_iso()
        if var == "ONLINE":
            c["online"] = p == "1" or p.lower() == "true"
        else:
            c["online"] = True
            if var == "TIPO":
                c["tipo"] = p.upper() or None
            elif var == "MODELO":
                c["modelo"] = p.upper() or None
            elif var == "VERSAO":
                prev = c.get("versao")
                if p and prev and p != prev:
                    await self._registrar_atualizacao(c, prev, p)
                c["versao"] = p or None
            elif var == "RESET":
                c["reset"] = p or None
            elif var in ("RSSI", "UPTIME"):
                try:
                    c["rssi" if var == "RSSI" else "uptime"] = int(float(p))
                except ValueError:
                    pass
                if var == "UPTIME" and c.get("uptime") is not None:
                    self._atualizar_boot(c)
            elif var == "OTA/STATE":
                c["ota_state"] = p or None
                c["ota_state_at"] = c["last_seen"]
        await db.controllers.update_one({"device_id": device_id}, {"$set": c}, upsert=True)

    def get(self, device_id: str) -> dict:
        return self.items.get(device_id) or {}

    @staticmethod
    def _atualizar_boot(c: dict):
        """last_boot_at = agora - uptime (minuto). Só muda se deslocar > 2 min (jitter de publicação)."""
        boot = (datetime.now(timezone.utc) - timedelta(minutes=c["uptime"])).replace(second=0, microsecond=0)
        atual = c.get("last_boot_at")
        try:
            desloc = abs((boot - datetime.fromisoformat(atual)).total_seconds()) if atual else None
        except ValueError:
            desloc = None
        if desloc is None or desloc > 120:
            c["last_boot_at"] = boot.isoformat()

    @staticmethod
    async def _registrar_atualizacao(c: dict, de: str, para: str):
        """Versão mudou: grava data/hora e histórico. Origem OTA se houve OTA/STATE nos últimos 15 min."""
        agora = now_iso()
        origem = "manual"
        ota_at = c.get("ota_state_at")
        if ota_at and re.match(r"(?i)^(baixando|ok|reiniciando)", c.get("ota_state") or ""):
            try:
                if datetime.now(timezone.utc) - datetime.fromisoformat(ota_at) <= timedelta(minutes=15):
                    origem = "OTA"
            except ValueError:
                pass
        c["fw_updated_at"] = agora
        c["fw_prev_version"] = de
        await db.firmware_updates.insert_one(
            {"device_id": c["device_id"], "de": de, "para": para, "em": agora, "origem": origem})
        logger.info("Firmware %s: %s -> %s (%s)", c["device_id"], de, para, origem)


registry = ControllerRegistry()


async def catalog_map() -> Dict[str, dict]:
    return {m["modelo"]: m async for m in db.controller_models.find({}, {"_id": 0})}


async def inventory() -> list:
    """Une cadastro (fancoils, lighting_controllers) + controladoras que publicaram o contrato comum."""
    from mqtt_service import svc
    from lighting_service import lighting_svc
    catalog = await catalog_map()
    origins: Dict[str, dict] = {}
    async for fc in db.fancoils.find({}, {"_id": 1, "name": 1, "device_id": 1}):
        origins[fc["device_id"]] = {"origem": "FANCOIL", "identificacao": fc["name"], "ref_id": str(fc["_id"])}
    async for lc in db.lighting_controllers.find({}, {"_id": 1, "mqtt_id": 1, "nome": 1}):
        origins[lc["mqtt_id"]] = {"origem": "ILUMINACAO", "identificacao": lc.get("nome") or lc["mqtt_id"], "ref_id": str(lc["_id"])}
    out = []
    for did in sorted(set(origins) | set(registry.items)):
        r = registry.get(did)
        o = origins.get(did, {})
        fst = svc.states.get(did)
        lst = lighting_svc.controllers.get(did)
        modelo = r.get("modelo") or (fst.modelo if fst else None)
        cat_entry = catalog.get(modelo) if modelo else None
        categoria = (r.get("tipo") or (fst.tipo if fst else None)
                     or (cat_entry or {}).get("categoria") or o.get("origem") or "OUTRO")
        online = bool(r.get("online") or (fst and fst.online) or (lst and lst.get("online")))
        out.append({
            "device_id": did,
            "identificacao": o.get("identificacao"),
            "origem": o.get("origem"),
            "ref_id": o.get("ref_id"),
            "tipo": r.get("tipo"),
            "categoria": categoria if categoria in CATEGORIAS else "OUTRO",
            "modelo": modelo,
            "modelo_informado": bool(modelo),
            "catalogado": bool(cat_entry),
            "versao": r.get("versao") or (fst.firmware_version if fst else None),
            "online": online,
            "rssi": r.get("rssi", fst.rssi if fst else None),
            "uptime_min": r.get("uptime", fst.uptime_min if fst else None),
            "reset_reason": r.get("reset") or (fst.reset_reason if fst else None),
            "last_boot_at": r.get("last_boot_at") or (fst.reset_at if fst else None),
            "fw_updated_at": r.get("fw_updated_at"),
            "fw_prev_version": r.get("fw_prev_version"),
            "ota_state": r.get("ota_state") or (fst.ota_state if fst else None),
            "ota_state_at": r.get("ota_state_at") or (fst.ota_state_at if fst else None),
            "last_seen": r.get("last_seen") or (fst.last_update if fst else None),
        })
    return out


async def get_controller(device_id: str) -> Optional[dict]:
    return next((c for c in await inventory() if c["device_id"] == device_id), None)


@router.get("/admin/controllers/{device_id}/firmware-updates")
async def firmware_updates(device_id: str, _: dict = Depends(require_admin)):
    cur = db.firmware_updates.find({"device_id": device_id}, {"_id": 0}).sort("em", -1).limit(20)
    return [d async for d in cur]


# ---------------- Catálogo de modelos ----------------
class ModelIn(BaseModel):
    modelo: str
    categoria: str
    nome: str = ""
    hardware: str = ""
    descricao: str = ""
    ativo: bool = True


async def seed_models():
    await db.controller_models.create_index("modelo", unique=True)
    await db.controller_models.update_one(
        {"modelo": "FC300"},
        {"$setOnInsert": {"modelo": "FC300", "categoria": "FANCOIL", "nome": "Controladora de fancoil",
                          "hardware": "KinCony KC868-A4", "descricao": "", "ativo": True, "criado_em": now_iso()}},
        upsert=True,
    )


def _validate(m: ModelIn) -> dict:
    d = m.dict()
    d["modelo"] = d["modelo"].strip().upper()
    d["categoria"] = d["categoria"].strip().upper()
    if not MODEL_RE.match(d["modelo"]):
        raise HTTPException(400, "Modelo inválido (letras maiúsculas, números, - ou _)")
    if d["categoria"] not in CATEGORIAS:
        raise HTTPException(400, f"Categoria inválida — use {', '.join(CATEGORIAS)}")
    return d


@router.get("/admin/controller-models")
async def list_models(_: dict = Depends(require_admin)):
    return [m async for m in db.controller_models.find({}, {"_id": 0}).sort("modelo", 1)]


@router.post("/admin/controller-models")
async def create_model(m: ModelIn, _: dict = Depends(require_admin)):
    d = _validate(m)
    if await db.controller_models.find_one({"modelo": d["modelo"]}):
        raise HTTPException(409, f"Modelo {d['modelo']} já cadastrado")
    d["criado_em"] = now_iso()
    await db.controller_models.insert_one(dict(d))
    return d


@router.put("/admin/controller-models/{modelo}")
async def update_model(modelo: str, m: ModelIn, _: dict = Depends(require_admin)):
    d = _validate(m)
    d.pop("modelo")
    res = await db.controller_models.update_one({"modelo": modelo.upper()}, {"$set": d})
    if not res.matched_count:
        raise HTTPException(404, "Modelo não encontrado")
    return await db.controller_models.find_one({"modelo": modelo.upper()}, {"_id": 0})
