"""MQTT handling: real paho client + built-in simulator.

Payloads are plain text:
- ONLINE/STATUS/MODO: "1"/"0"
- ESTADO/SET, CMD/SET: "true"/"false"
- TEMPERATURA: numeric or "ERRO"
- VAG, SETPOINT/SET: numeric
Topic format: {prefix}/{device_id}/{var}
"""
from __future__ import annotations
import asyncio
import logging
import os
import random
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional
from db import db
from ws_manager import manager

logger = logging.getLogger("mqtt")

READ_TOPICS = ("ONLINE", "STATUS", "MODO", "TEMPERATURA", "VAG")
WRITE_TOPICS = ("ESTADO/SET", "CMD/SET", "SETPOINT/SET", "PRESSAO/SET")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FancoilState:
    """In-memory per-device state."""

    def __init__(self, device_id: str):
        self.device_id = device_id
        self.online: bool = False
        self.status: Optional[bool] = None
        self.modo: Optional[bool] = None  # True=AUTO
        self.estado: Optional[bool] = None  # True=AUTOMATIC schedule
        self.cmd: Optional[bool] = None  # True=LIGAR
        self.temperature: Optional[float] = None
        self.temp_error: bool = False
        self.setpoint: Optional[float] = None
        self.vag: Optional[float] = None
        self.pressure: Optional[float] = None  # % — supervisório envia via PRESSAO/SET
        self.last_update: Optional[str] = None
        self.last_change_ts: float = time.time()

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "online": self.online,
            "status": self.status,
            "modo": self.modo,
            "estado": self.estado,
            "cmd": self.cmd,
            "temperature": self.temperature,
            "temp_error": self.temp_error,
            "setpoint": self.setpoint,
            "vag": self.vag,
            "pressure": self.pressure,
            "last_update": self.last_update,
        }


class MQTTService:
    def __init__(self):
        self.states: Dict[str, FancoilState] = {}
        self.connected: bool = False
        self.simulation: bool = True
        self.topic_prefix: str = os.environ.get("MQTT_TOPIC_PREFIX", "TJS")
        self.broker_cfg: dict = {}
        self._client = None
        self._sim_task: Optional[asyncio.Task] = None
        self._alarm_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Simulation params
        self.sim_schedule_start = 7  # 07h
        self.sim_schedule_end = 21  # 21h
        # Pending commands waiting for echo
        self.pending_cmds: Dict[str, dict] = {}
        # Last broker error message for UI feedback
        self.last_error: Optional[str] = None

    def get_state(self, device_id: str) -> FancoilState:
        s = self.states.get(device_id)
        if not s:
            s = FancoilState(device_id)
            self.states[device_id] = s
        return s

    async def start(self):
        self._loop = asyncio.get_running_loop()
        settings = await db.settings.find_one({"_id": "global"}) or {}
        self.simulation = settings.get("simulation_enabled", True)
        self.topic_prefix = settings.get("broker", {}).get("topic_prefix") or self.topic_prefix
        self.broker_cfg = settings.get("broker", {})
        # Load existing fancoil state hints
        async for fc in db.fancoils.find({}):
            st = self.get_state(fc["device_id"])
            st.setpoint = fc.get("setpoint_min", 22.0)
        if self.simulation:
            await self._start_simulation()
        else:
            await self._start_real()
        # Start alarm engine
        if not self._alarm_task:
            from alarms import run_alarm_engine
            self._alarm_task = asyncio.create_task(run_alarm_engine(self))
        # Start scheduler
        if not hasattr(self, "_sched_task") or not self._sched_task:
            from scheduler import run_scheduler
            self._sched_task = asyncio.create_task(run_scheduler(self))

    async def restart(self):
        # Clear in-memory telemetry when switching modes (avoid stale sim data
        # polluting real broker view, and vice-versa). Preserve setpoint hints
        # loaded from fancoils collection by re-reading them in start().
        self.states.clear()
        self.pending_cmds.clear()
        await self.stop()
        await self.start()

    async def stop(self):
        if self._sim_task:
            self._sim_task.cancel()
            self._sim_task = None
        if self._client:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
            self._client = None
        self.connected = False

    async def _start_simulation(self):
        self.connected = True
        self.last_error = None
        logger.info("MQTT em modo SIMULAÇÃO")
        self._sim_task = asyncio.create_task(self._simulation_loop())

    async def _start_real(self):
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            self.last_error = "paho-mqtt não instalado"
            logger.error(self.last_error)
            return
        cfg = self.broker_cfg
        if not cfg.get("host"):
            self.last_error = "Broker MQTT não configurado (host vazio)"
            logger.warning(self.last_error)
            self.connected = False
            return
        host = str(cfg["host"]).strip()
        port = int(cfg.get("port", 1883))
        use_tls = bool(cfg.get("tls", False))
        client = mqtt.Client(client_id=cfg.get("client_id", "pilares-backend"), protocol=mqtt.MQTTv311)
        if cfg.get("username"):
            client.username_pw_set(cfg["username"], cfg.get("password", ""))
        if use_tls:
            try:
                client.tls_set()
            except Exception as e:
                self.last_error = f"Erro ao configurar TLS: {e}"
                logger.error(self.last_error)
                return

        rc_messages = {
            0: "sucesso",
            1: "versão de protocolo não aceita",
            2: "ID de cliente rejeitado",
            3: "servidor indisponível",
            4: "usuário ou senha incorretos",
            5: "não autorizado",
        }

        def on_connect(c, u, flags, rc):
            if rc == 0:
                self.connected = True
                self.last_error = None
                c.subscribe(f"{self.topic_prefix}/+/#", qos=1)
                logger.info(f"MQTT conectado em {host}:{port} (TLS={use_tls})")
            else:
                self.connected = False
                msg = rc_messages.get(rc, f"código {rc}")
                self.last_error = f"Falha de conexão MQTT: {msg} (rc={rc})"
                logger.error(self.last_error)

        def on_disconnect(c, u, rc):
            self.connected = False
            if rc != 0:
                self.last_error = f"Conexão MQTT caiu (rc={rc})"
                logger.warning(self.last_error)
            else:
                logger.info("MQTT desconectado")

        def on_message(c, u, msg):
            try:
                payload = msg.payload.decode(errors="ignore").strip()
                asyncio.run_coroutine_threadsafe(
                    self._handle_message(msg.topic, payload), self._loop
                )
            except Exception as e:
                logger.exception(f"Erro msg MQTT: {e}")

        client.on_connect = on_connect
        client.on_disconnect = on_disconnect
        client.on_message = on_message
        try:
            # Synchronous connect to catch socket errors (wrong port, host unreachable, TLS mismatch)
            client.connect(host, port, keepalive=60)
            client.loop_start()
            self._client = client
            logger.info(f"MQTT inicializando conexão com {host}:{port} TLS={use_tls}")
        except ConnectionRefusedError:
            self.last_error = f"Conexão recusada em {host}:{port}. Verifique se a porta está correta (1883 sem TLS / 8883 com TLS)."
            logger.error(self.last_error)
            self.connected = False
        except OSError as e:
            self.last_error = f"Erro de rede ao conectar em {host}:{port} — {e}"
            logger.error(self.last_error)
            self.connected = False
        except Exception as e:
            self.last_error = f"Erro ao conectar MQTT: {e}"
            logger.exception(self.last_error)
            self.connected = False

    async def test_connection(self, host: str, port: int, username: str = "",
                              password: str = "", tls: bool = False,
                              client_id: str = "pilares-test") -> dict:
        """Try to connect briefly and return success/error without impacting the running client."""
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            return {"ok": False, "error": "paho-mqtt não instalado"}
        if not host:
            return {"ok": False, "error": "Host vazio"}
        host = str(host).strip()
        port = int(port)
        import threading, time as _time
        result = {"ok": False, "error": "Timeout aguardando resposta do broker"}
        done = threading.Event()
        c = mqtt.Client(client_id=f"{client_id}-test", protocol=mqtt.MQTTv311)
        if username:
            c.username_pw_set(username, password or "")
        if tls:
            try:
                c.tls_set()
            except Exception as e:
                return {"ok": False, "error": f"TLS: {e}"}
        rc_msgs = {0: "sucesso", 1: "versão de protocolo não aceita",
                   2: "ID de cliente rejeitado", 3: "servidor indisponível",
                   4: "usuário ou senha incorretos", 5: "não autorizado"}

        def _on_connect(cli, u, flags, rc):
            if rc == 0:
                result["ok"] = True
                result["error"] = None
            else:
                result["ok"] = False
                result["error"] = f"Rejeitado pelo broker: {rc_msgs.get(rc, 'código ' + str(rc))}"
            done.set()
        c.on_connect = _on_connect
        try:
            c.connect(host, port, keepalive=10)
        except ConnectionRefusedError:
            return {"ok": False, "error": f"Conexão recusada em {host}:{port}. A porta ou o TLS podem estar errados (1883 sem TLS / 8883 com TLS)."}
        except OSError as e:
            return {"ok": False, "error": f"Erro de rede: {e}"}
        except Exception as e:
            return {"ok": False, "error": f"{e}"}
        c.loop_start()
        done.wait(timeout=6)
        try:
            c.loop_stop()
            c.disconnect()
        except Exception:
            pass
        return result

    async def _handle_message(self, topic: str, payload: str):
        parts = topic.split("/")
        if len(parts) < 3:
            return
        prefix = parts[0]
        if prefix != self.topic_prefix:
            return
        device_id = parts[1]
        var = "/".join(parts[2:])
        await self._apply_update(device_id, var, payload)

    async def _apply_update(self, device_id: str, var: str, payload: str):
        st = self.get_state(device_id)
        changed = True
        st.last_update = now_iso()

        if var == "ONLINE":
            st.online = payload == "1"
        elif var == "STATUS":
            st.status = payload == "1"
            st.online = True
        elif var == "MODO":
            st.modo = payload == "1"
            st.online = True
        elif var == "TEMPERATURA":
            st.online = True
            if payload.upper() == "ERRO":
                st.temp_error = True
                st.temperature = None
            else:
                try:
                    st.temperature = float(payload)
                    st.temp_error = False
                except ValueError:
                    pass
        elif var == "VAG":
            st.online = True
            try:
                st.vag = float(payload)
            except ValueError:
                pass
        elif var == "ESTADO/SET":
            st.estado = payload.lower() == "true"
        elif var == "CMD/SET":
            st.cmd = payload.lower() == "true"
        elif var == "SETPOINT/SET":
            try:
                v = float(payload)
                if 10.0 <= v <= 35.0:
                    st.setpoint = v
            except ValueError:
                pass
        elif var == "PRESSAO/SET":
            try:
                v = float(payload)
                if 0.0 <= v <= 100.0:
                    st.pressure = v
            except ValueError:
                pass
        else:
            changed = False

        # Register unknown device
        fc = await db.fancoils.find_one({"device_id": device_id})
        if not fc:
            await db.devices.update_one(
                {"device_id": device_id},
                {"$set": {"device_id": device_id, "last_seen": now_iso()}},
                upsert=True,
            )

        # Resolve pending commands by matching var/value
        pk = f"{device_id}:{var}"
        if pk in self.pending_cmds:
            pending = self.pending_cmds.pop(pk)
            await db.command_log.update_one(
                {"_id": pending["log_id"]},
                {"$set": {"confirmed": True, "confirmed_at": now_iso()}},
            )

        # Push via WS
        if changed:
            await manager.broadcast("telemetry", {"device_id": device_id, "state": st.to_dict()})

        # Persist history sample every ~60s (keyed by rounded minute)
        if var in ("TEMPERATURA", "SETPOINT/SET", "VAG", "STATUS") and st.online:
            await self._maybe_save_history(st)

    async def _maybe_save_history(self, st: FancoilState):
        now = datetime.now(timezone.utc)
        minute_key = now.replace(second=0, microsecond=0).isoformat()
        await db.history.update_one(
            {"device_id": st.device_id, "minute": minute_key},
            {
                "$set": {
                    "device_id": st.device_id,
                    "minute": minute_key,
                    "timestamp": now.isoformat(),
                    "temperature": st.temperature,
                    "setpoint": st.setpoint,
                    "vag": st.vag,
                    "status": st.status,
                }
            },
            upsert=True,
        )

    async def publish_command(self, device_id: str, var: str, value: str, user_id: str) -> dict:
        """Publish ESTADO/SET, CMD/SET or SETPOINT/SET. Returns log entry."""
        if var not in WRITE_TOPICS:
            raise ValueError("Tópico inválido")
        topic = f"{self.topic_prefix}/{device_id}/{var}"
        st = self.get_state(device_id)
        prev_val = {
            "ESTADO/SET": st.estado,
            "CMD/SET": st.cmd,
            "SETPOINT/SET": st.setpoint,
            "PRESSAO/SET": st.pressure,
        }.get(var)
        log = {
            "device_id": device_id,
            "user_id": user_id,
            "topic": topic,
            "kind": var,
            "value": value,
            "previous_value": str(prev_val),
            "timestamp": now_iso(),
            "confirmed": False,
            "confirmed_at": None,
        }
        res = await db.command_log.insert_one(log)
        log["_id"] = res.inserted_id

        if self.simulation:
            await self._sim_handle_command(device_id, var, value)
        else:
            if self._client and self.connected:
                self._client.publish(topic, value, qos=1, retain=True)
            else:
                logger.warning("MQTT desconectado, comando não enviado")

        self.pending_cmds[f"{device_id}:{var}"] = {"log_id": res.inserted_id, "ts": time.time()}
        asyncio.create_task(self._cmd_timeout(res.inserted_id, device_id, var))
        return {"id": str(res.inserted_id), "topic": topic, "value": value}

    async def _cmd_timeout(self, log_id, device_id: str, var: str):
        await asyncio.sleep(15)
        pk = f"{device_id}:{var}"
        if pk in self.pending_cmds and self.pending_cmds[pk]["log_id"] == log_id:
            self.pending_cmds.pop(pk, None)
            await manager.broadcast(
                "command_timeout",
                {"device_id": device_id, "var": var, "log_id": str(log_id)},
            )

    # -------- Simulation --------
    async def _simulation_loop(self):
        try:
            while True:
                await self._tick_simulation()
                await asyncio.sleep(2)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Erro no loop de simulação")

    async def _tick_simulation(self):
        """Simulate device behavior and publish updates."""
        fancoils = await db.fancoils.find({"active": True}).to_list(1000)
        now = datetime.now(timezone.utc) - timedelta(hours=3)  # Brasília
        hour = now.hour
        for fc in fancoils:
            did = fc["device_id"]
            st = self.get_state(did)
            # Initialize defaults
            if st.estado is None:
                st.estado = True  # AUTOMÁTICO (schedule)
            if st.setpoint is None:
                st.setpoint = 23.0
            if st.modo is None:
                st.modo = True  # AUTO quadro
            # Determine desired on/off
            schedule_on = self.sim_schedule_start <= hour < self.sim_schedule_end
            if st.estado:  # AUTOMÁTICO
                desired = schedule_on
                st.cmd = desired  # echo cmd state matching schedule
            else:  # FORÇADO
                desired = bool(st.cmd) if st.cmd is not None else False
            # STATUS lags cmd with ~3s delay simulated via last_change_ts
            if st.status != desired:
                if time.time() - st.last_change_ts > 3:
                    st.status = desired
                    st.last_change_ts = time.time()
            else:
                st.last_change_ts = time.time()
            # Online
            st.online = True
            # VAG and temperature simulation
            if st.status:
                # cooling toward setpoint
                base = st.setpoint or 23.0
                current = st.temperature if st.temperature is not None else base + 3
                delta = (base - current) * 0.15 + random.uniform(-0.2, 0.2)
                st.temperature = round(current + delta, 1)
                diff = max(0, current - base)
                st.vag = round(min(100, max(0, diff * 25 + 10 + random.uniform(-5, 5))), 1)
            else:
                st.vag = 0.0
                base_amb = 26 + random.uniform(-1, 1)
                current = st.temperature if st.temperature is not None else base_amb
                st.temperature = round(current + (base_amb - current) * 0.05 + random.uniform(-0.1, 0.1), 1)
            st.temp_error = False
            st.last_update = now_iso()
            # Broadcast
            await manager.broadcast("telemetry", {"device_id": did, "state": st.to_dict()})
            await self._maybe_save_history(st)

    async def _sim_handle_command(self, device_id: str, var: str, value: str):
        st = self.get_state(device_id)
        if var == "ESTADO/SET":
            st.estado = value.lower() == "true"
        elif var == "CMD/SET":
            # Only effective in FORÇADO
            if st.estado is False:
                st.cmd = value.lower() == "true"
            # ESP echoes real relay state; keep cmd matched to effective
        elif var == "SETPOINT/SET":
            try:
                v = float(value)
                if 10.0 <= v <= 35.0:
                    st.setpoint = v
            except ValueError:
                pass
        elif var == "PRESSAO/SET":
            try:
                v = float(value)
                if 0.0 <= v <= 100.0:
                    st.pressure = v
            except ValueError:
                pass
        # Immediate echo
        await manager.broadcast("telemetry", {"device_id": device_id, "state": st.to_dict()})
        # Mark pending as confirmed (echo back by MQTT would do this in real)
        pk = f"{device_id}:{var}"
        if pk in self.pending_cmds:
            pending = self.pending_cmds.pop(pk)
            await db.command_log.update_one(
                {"_id": pending["log_id"]},
                {"$set": {"confirmed": True, "confirmed_at": now_iso()}},
            )


svc = MQTTService()
