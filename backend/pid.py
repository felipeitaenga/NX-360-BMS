"""PID da controladora FC300 (firmware ≥ 1.4.4): PID/SET (não retido), confirmação via PID/CONFIG."""
from __future__ import annotations
import json
import logging
import time
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin
from db import db

logger = logging.getLogger("pid")
router = APIRouter(prefix="/api")

# Escala v1.4.6 do firmware (NORMAL = antigo MUITO_RAPIDO; demais proporcionais)
PROFILES = {
    "MUITO_LENTO": {"kp": 45, "ti": 290, "taxa": 10, "zm": 0.20},
    "LENTO": {"kp": 52, "ti": 190, "taxa": 14, "zm": 0.20},
    "NORMAL": {"kp": 60, "ti": 120, "taxa": 20, "zm": 0.15},
    "RAPIDO": {"kp": 75, "ti": 80, "taxa": 30, "zm": 0.15},
    "MUITO_RAPIDO": {"kp": 90, "ti": 50, "taxa": 40, "zm": 0.10},
}
RANGES = {"kp": (5, 150), "ti": (30, 3600), "taxa": (1, 50), "zm": (0.10, 1.00)}
RESEND_INTERVAL_S = 300
_last_sent: dict = {}


class PidReq(BaseModel):
    perfil: str
    kp: Optional[float] = None
    ti: Optional[float] = None
    taxa: Optional[float] = None
    zm: Optional[float] = None


def normalize(req: PidReq) -> dict:
    perfil = req.perfil.strip().upper()
    if perfil in PROFILES:
        return {"perfil": perfil, **PROFILES[perfil]}
    if perfil != "PERSONALIZADO":
        raise HTTPException(400, "Perfil inválido")
    out = {"perfil": perfil}
    for k, (lo, hi) in RANGES.items():
        v = getattr(req, k)
        if v is None or not (lo <= v <= hi):
            raise HTTPException(400, f"{k} fora da faixa ({lo}–{hi})")
        out[k] = round(float(v), 2) if k == "zm" else (int(v) if float(v).is_integer() else float(v))
    return out


def matches(desired: dict, config: Optional[dict]) -> bool:
    if not config or config.get("erro") or config.get("perfil") != desired.get("perfil"):
        return False
    if desired["perfil"] != "PERSONALIZADO":
        return True
    return all(abs(float(config.get(k, -1)) - float(desired[k])) < 1e-6 for k in RANGES)


def _payload(desired: dict) -> str:
    if desired["perfil"] == "PERSONALIZADO":
        return json.dumps({k: desired[k] for k in ("perfil", "kp", "ti", "taxa", "zm")})
    return json.dumps({"perfil": desired["perfil"]})


def publish_pid(device_id: str, desired: dict) -> bool:
    from mqtt_service import svc
    if svc.simulation or not (svc._client and svc.connected):
        return False
    svc._client.publish(f"{svc.topic_prefix}/{device_id}/PID/SET", _payload(desired), qos=1, retain=False)
    _last_sent[device_id] = time.monotonic()
    return True


async def pid_auto_resend(device_id: str):
    """Reenvia PID/SET quando a controladora volta ONLINE ou publica config ≠ desejado (máx. 1×/5 min)."""
    from mqtt_service import svc
    st = svc.states.get(device_id)
    if not st or not st.online or not st.pid_config or st.pid_config.get("erro"):
        return
    fc = await db.fancoils.find_one({"device_id": device_id}, {"pid_desejado": 1})
    desired = (fc or {}).get("pid_desejado")
    if not desired or matches(desired, st.pid_config):
        return
    if time.monotonic() - _last_sent.get(device_id, -1e9) < RESEND_INTERVAL_S:
        return
    if publish_pid(device_id, desired):
        logger.info("PID reenviado automaticamente para %s (%s)", device_id, desired["perfil"])


@router.post("/devices/{fid}/pid")
async def set_pid(fid: str, req: PidReq, user: dict = Depends(require_admin)):
    from mqtt_service import svc, now_iso
    q = {"_id": ObjectId(fid)} if ObjectId.is_valid(fid) else {"device_id": fid}
    fc = await db.fancoils.find_one(q)
    if not fc:
        raise HTTPException(404, "Fancoil não encontrado")
    desired = normalize(req)
    did = fc["device_id"]
    await db.fancoils.update_one({"_id": fc["_id"]}, {"$set": {"pid_desejado": desired}})
    st = svc.states.get(did)
    sent = publish_pid(did, desired) if st and st.online else False
    await db.command_log.insert_one({
        "device_id": did, "user_id": user.get("email"), "topic": f"{svc.topic_prefix}/{did}/PID/SET",
        "kind": "PID/SET", "value": _payload(desired),
        "previous_value": json.dumps((st.pid_config if st else None) or {}),
        "timestamp": now_iso(), "confirmed": False, "confirmed_at": None,
    })
    return {"pid_desejado": desired, "enviado": sent, "online": bool(st and st.online)}
