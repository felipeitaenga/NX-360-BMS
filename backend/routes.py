"""REST + WebSocket routes."""
from __future__ import annotations
import io
import csv
import json
import tarfile
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from bson.json_util import dumps as bson_dumps, loads as bson_loads
from fastapi import APIRouter, Depends, HTTPException, Response, Request, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import db
from models import (
    LoginReq, ChangePasswordReq, ResetPasswordAdminReq, UserCreate, UserUpdate, UserOut,
    FancoilCreate, FancoilUpdate, FancoilOut, PermissionsUpdate, CommandReq, BulkCommandReq,
    AlarmAck, SettingsUpdate, ScheduleCreate, ScheduleBulkCreate, ScheduleUpdate,
    TopicMappingCreate, TopicMappingUpdate,
)
from auth import (
    hash_password, verify_password, create_access_token, get_current_user,
    require_admin, require_operator, get_user_permissions, can_access_fancoil,
    allowed_fancoil_ids,
)
from mqtt_service import svc
from ws_manager import manager

logger = logging.getLogger("routes")
router = APIRouter(prefix="/api")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_out(u: dict) -> dict:
    return {
        "id": str(u.get("_id") or u.get("id")),
        "name": u.get("name", ""),
        "email": u.get("email"),
        "role": u.get("role", "viewer"),
        "active": u.get("active", True),
        "must_change_password": u.get("must_change_password", False),
        "last_login": u.get("last_login"),
        "created_at": u.get("created_at"),
    }


def _fancoil_out(fc: dict, state=None) -> dict:
    st = state or svc.get_state(fc["device_id"])
    base = {
        "id": str(fc.get("_id") or fc.get("id")),
        "name": fc["name"],
        "device_id": fc["device_id"],
        "floor": fc["floor"],
        "side": fc["side"],
        "description": fc.get("description", ""),
        "setpoint_min": fc.get("setpoint_min", 18.0),
        "setpoint_max": fc.get("setpoint_max", 26.0),
        "temp_alarm_min": fc.get("temp_alarm_min", 15.0),
        "temp_alarm_max": fc.get("temp_alarm_max", 30.0),
        "active": fc.get("active", True),
    }
    base.update(st.to_dict())
    base.pop("device_id", None)
    base["device_id"] = fc["device_id"]
    return base


# =============== AUTH ===============
@router.post("/auth/login")
async def login(req: LoginReq, response: Response, request: Request):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    if not user.get("active", True):
        raise HTTPException(status_code=401, detail="Usuário inativo")
    uid = str(user["_id"])
    token = create_access_token(uid, user["email"], user["role"])
    response.set_cookie(
        "access_token", token, httponly=True, secure=True, samesite="none",
        max_age=60 * 60 * 8, path="/",
    )
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login": now_iso()}})
    await db.access_log.insert_one({
        "user_id": uid, "email": email, "action": "login",
        "ip": request.client.host if request.client else None,
        "timestamp": now_iso(),
    })
    return {
        "access_token": token,
        "user": _user_out(user),
        "must_change_password": user.get("must_change_password", False),
    }


@router.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    await db.access_log.insert_one({
        "user_id": user["id"], "email": user["email"], "action": "logout",
        "timestamp": now_iso(),
    })
    return {"ok": True}


@router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    perms = await get_user_permissions(user["id"])
    return {"user": _user_out(user), "permissions": perms}


@router.post("/auth/change-password")
async def change_password(req: ChangePasswordReq, user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"_id": ObjectId(user["id"])})
    if not verify_password(req.current_password, u["password_hash"]):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Nova senha deve ter ao menos 6 caracteres")
    await db.users.update_one(
        {"_id": u["_id"]},
        {"$set": {"password_hash": hash_password(req.new_password), "must_change_password": False}},
    )
    return {"ok": True}


# =============== USERS (admin) ===============
@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    users = await db.users.find({}).to_list(500)
    return [_user_out(u) for u in users]


@router.post("/users")
async def create_user(req: UserCreate, _: dict = Depends(require_admin)):
    email = req.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")
    doc = {
        "name": req.name,
        "email": email,
        "password_hash": hash_password(req.password),
        "role": req.role,
        "active": req.active,
        "must_change_password": True,
        "created_at": now_iso(),
        "last_login": None,
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _user_out(doc)


@router.patch("/users/{user_id}")
async def update_user(user_id: str, req: UserUpdate, _: dict = Depends(require_admin)):
    upd = {k: v for k, v in req.dict().items() if v is not None}
    if upd:
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": upd})
    u = await db.users.find_one({"_id": ObjectId(user_id)})
    return _user_out(u)


@router.post("/users/reset-password")
async def admin_reset_password(req: ResetPasswordAdminReq, _: dict = Depends(require_admin)):
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres")
    await db.users.update_one(
        {"_id": ObjectId(req.user_id)},
        {"$set": {"password_hash": hash_password(req.new_password), "must_change_password": True}},
    )
    return {"ok": True}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, _: dict = Depends(require_admin)):
    await db.users.delete_one({"_id": ObjectId(user_id)})
    await db.permissions.delete_one({"user_id": user_id})
    return {"ok": True}


# =============== PERMISSIONS ===============
@router.get("/permissions/{user_id}")
async def get_perms(user_id: str, _: dict = Depends(require_admin)):
    return await get_user_permissions(user_id)


@router.put("/permissions")
async def set_perms(req: PermissionsUpdate, _: dict = Depends(require_admin)):
    await db.permissions.update_one(
        {"user_id": req.user_id},
        {"$set": {"user_id": req.user_id, "modules": req.modules, "fancoil_ids": req.fancoil_ids}},
        upsert=True,
    )
    return {"ok": True}


# =============== FANCOILS ===============
@router.get("/fancoils")
async def list_fancoils(user: dict = Depends(get_current_user)):
    allowed = await allowed_fancoil_ids(user)
    cursor = db.fancoils.find({})
    result = []
    async for fc in cursor:
        fid = str(fc["_id"])
        out = _fancoil_out(fc)
        if allowed is None:
            out["authorized"] = True
            result.append(out)
        else:
            # Esconde não autorizados por padrão (segurança por default)
            if fid not in allowed:
                continue
            out["authorized"] = True
            result.append(out)
    return result


@router.get("/fancoils/{fancoil_id}")
async def get_fancoil(fancoil_id: str, user: dict = Depends(get_current_user)):
    fc = await db.fancoils.find_one({"_id": ObjectId(fancoil_id)})
    if not fc:
        raise HTTPException(status_code=404, detail="Fancoil não encontrado")
    if not await can_access_fancoil(user, fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão para este fancoil")
    out = _fancoil_out(fc)
    out["authorized"] = True
    return out


@router.post("/fancoils")
async def create_fancoil(req: FancoilCreate, _: dict = Depends(require_admin)):
    if await db.fancoils.find_one({"device_id": req.device_id}):
        raise HTTPException(status_code=400, detail="device_id já cadastrado")
    doc = req.dict()
    doc["created_at"] = now_iso()
    res = await db.fancoils.insert_one(doc)
    doc["_id"] = res.inserted_id
    await db.devices.delete_one({"device_id": req.device_id})
    # Publica agenda inicial (vazia) com retained — garante que a controladora nova,
    # ao conectar, saiba que ainda não tem agenda nenhuma (limpa qualquer resíduo).
    try:
        await svc.publish_schedule_config(req.device_id)
    except Exception:
        logger.exception("[schedule] falha ao publicar agenda inicial para %s", req.device_id)
    return _fancoil_out(doc)


@router.patch("/fancoils/{fancoil_id}")
async def update_fancoil(fancoil_id: str, req: FancoilUpdate, _: dict = Depends(require_admin)):
    try:
        oid = ObjectId(fancoil_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Fancoil não encontrado")
    fc = await db.fancoils.find_one({"_id": oid})
    if not fc:
        raise HTTPException(status_code=404, detail="Fancoil não encontrado")
    upd = req.dict(exclude_unset=True)
    old_device_id = fc["device_id"]
    # Device ID change: validate uniqueness and migrate dependent data
    if "device_id" in upd:
        new_device_id = (upd.get("device_id") or "").strip()
        if not new_device_id:
            raise HTTPException(status_code=400, detail="Device ID não pode ser vazio")
        upd["device_id"] = new_device_id
        if new_device_id != old_device_id:
            existing = await db.fancoils.find_one({"device_id": new_device_id, "_id": {"$ne": oid}})
            if existing:
                raise HTTPException(status_code=400, detail=f"Device ID '{new_device_id}' já cadastrado em outro fancoil")
            # Migrate dependent collections to keep history/alarms/commands tied to the fancoil
            await db.history.update_many({"device_id": old_device_id}, {"$set": {"device_id": new_device_id}})
            await db.command_log.update_many({"device_id": old_device_id}, {"$set": {"device_id": new_device_id}})
            await db.alarms.update_many({"device_id": old_device_id}, {"$set": {"device_id": new_device_id}})
            await db.devices.delete_many({"device_id": {"$in": [old_device_id, new_device_id]}})
            # Move in-memory telemetry state and clear pending commands tied to old id
            old_state = svc.states.pop(old_device_id, None)
            if old_state is not None:
                old_state.device_id = new_device_id
                svc.states[new_device_id] = old_state
            svc.pending_cmds = {
                k: v for k, v in svc.pending_cmds.items() if not k.startswith(f"{old_device_id}:")
            }
    if upd:
        await db.fancoils.update_one({"_id": oid}, {"$set": upd})
    fc = await db.fancoils.find_one({"_id": oid})
    # Se trocou de device_id (nova placa / MAC novo), reemite as agendas no ID novo
    # e limpa o retained do ID antigo.
    if "device_id" in upd and upd["device_id"] != old_device_id:
        try:
            # Limpa agenda retained do ID antigo (payload vazio)
            if svc._client and svc.connected:
                svc._client.publish(f"{svc.topic_prefix}/{old_device_id}/SCHEDULE/SET", "", qos=1, retain=True)
            await svc.publish_schedule_config(upd["device_id"])
        except Exception:
            logger.exception("[schedule] falha ao re-publicar após troca de device_id")
    return _fancoil_out(fc)


@router.delete("/fancoils/{fancoil_id}")
async def delete_fancoil(fancoil_id: str, _: dict = Depends(require_admin)):
    await db.fancoils.delete_one({"_id": ObjectId(fancoil_id)})
    return {"ok": True}


@router.post("/fancoils/import")
async def import_fancoils(file: UploadFile = File(...), _: dict = Depends(require_admin)):
    content = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    inserted = 0
    errors = []
    for row in reader:
        try:
            doc = {
                "name": row["name"].strip(),
                "device_id": row["device_id"].strip(),
                "floor": int(row["floor"]),
                "side": int(row["side"]),
                "description": row.get("description", "").strip(),
                "setpoint_min": float(row.get("setpoint_min", 18.0)),
                "setpoint_max": float(row.get("setpoint_max", 26.0)),
                "temp_alarm_min": float(row.get("temp_alarm_min", 15.0)),
                "temp_alarm_max": float(row.get("temp_alarm_max", 30.0)),
                "active": True,
                "created_at": now_iso(),
            }
            if await db.fancoils.find_one({"device_id": doc["device_id"]}):
                errors.append(f"{doc['device_id']}: já existe")
                continue
            await db.fancoils.insert_one(doc)
            inserted += 1
        except Exception as e:
            errors.append(f"Linha {row}: {e}")
    return {"inserted": inserted, "errors": errors}


# =============== COMMANDS ===============
@router.post("/fancoils/{fancoil_id}/command")
async def send_command(fancoil_id: str, req: CommandReq, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode enviar comandos")
    if not await can_access_fancoil(user, fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão para este fancoil")
    fc = await db.fancoils.find_one({"_id": ObjectId(fancoil_id)})
    if not fc:
        raise HTTPException(status_code=404, detail="Fancoil não encontrado")
    st = svc.get_state(fc["device_id"])
    if not st.online:
        raise HTTPException(status_code=400, detail="Fancoil offline")
    # Validate CMD only in FORÇADO
    var_map = {"ESTADO": "ESTADO/SET", "CMD": "CMD/SET", "SETPOINT": "SETPOINT/SET", "PRESSAO": "PRESSAO/SET"}
    var = var_map[req.kind]
    value = req.value
    if req.kind == "CMD" and st.estado is True:
        raise HTTPException(status_code=400, detail="Fancoil em modo AUTOMÁTICO — altere para FORÇADO antes de comandar")
    if req.kind == "SETPOINT":
        try:
            v = float(value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Setpoint inválido")
        if v < fc.get("setpoint_min", 10) or v > fc.get("setpoint_max", 35):
            raise HTTPException(
                status_code=400,
                detail=f"Setpoint fora dos limites do cadastro ({fc.get('setpoint_min')}-{fc.get('setpoint_max')} °C)",
            )
        value = f"{v:.1f}"
    if req.kind == "PRESSAO":
        try:
            v = float(value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Pressão inválida")
        if v < 0.0 or v > 100.0:
            raise HTTPException(status_code=400, detail="Pressão deve estar entre 0 e 100 %")
        value = f"{v:.1f}"
    if req.kind in ("ESTADO", "CMD"):
        if value.lower() not in ("true", "false"):
            raise HTTPException(status_code=400, detail="Valor deve ser true/false")
        value = value.lower()
    result = await svc.publish_command(fc["device_id"], var, value, user["id"])
    return result


@router.post("/fancoils/bulk-command")
async def bulk_command(req: BulkCommandReq, user: dict = Depends(get_current_user)):
    """Executa comando em massa:
    - force_all: envia ESTADO/SET=false em todos (modo FORÇADO)
    - unforce_all: envia ESTADO/SET=true em todos (modo AUTOMÁTICO)
    - turn_on_all: garante FORÇADO + envia CMD/SET=true
    - turn_off_all: garante FORÇADO + envia CMD/SET=false
    Ignora fancoils offline/inativos. Retorna resumo por device."""
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode enviar comandos")

    query = {"active": True}
    if req.fancoil_ids:
        query["_id"] = {"$in": [ObjectId(i) for i in req.fancoil_ids]}
    allowed = await allowed_fancoil_ids(user)

    results = {"sent": [], "skipped": []}
    async for fc in db.fancoils.find(query):
        fid = str(fc["_id"])
        if allowed is not None and fid not in allowed:
            results["skipped"].append({"device_id": fc["device_id"], "reason": "sem permissão"})
            continue
        st = svc.get_state(fc["device_id"])
        if not st.online:
            results["skipped"].append({"device_id": fc["device_id"], "reason": "offline"})
            continue
        did = fc["device_id"]
        try:
            if req.action == "force_all":
                await svc.publish_command(did, "ESTADO/SET", "false", user["id"])
            elif req.action == "unforce_all":
                await svc.publish_command(did, "ESTADO/SET", "true", user["id"])
            elif req.action in ("turn_on_all", "turn_off_all"):
                # Garante FORÇADO (CMD só funciona em FORÇADO)
                if st.estado is not False:
                    await svc.publish_command(did, "ESTADO/SET", "false", user["id"])
                val = "true" if req.action == "turn_on_all" else "false"
                await svc.publish_command(did, "CMD/SET", val, user["id"])
            results["sent"].append({"device_id": did, "name": fc["name"]})
        except Exception as e:
            results["skipped"].append({"device_id": did, "reason": str(e)})
    return results


# =============== ALARMS ===============
@router.get("/alarms")
async def list_alarms(active_only: bool = False, limit: int = 500, user: dict = Depends(get_current_user)):
    q = {}
    if active_only:
        q["active"] = True
    allowed = await allowed_fancoil_ids(user)
    cursor = db.alarms.find(q).sort("started_at", -1).limit(limit)
    out = []
    # Build device_id -> fancoil_id map for permission filter
    fancoil_map = {}
    async for fc in db.fancoils.find({}):
        fancoil_map[fc["device_id"]] = str(fc["_id"])
    async for a in cursor:
        did = a["device_id"]
        if did == "__system__":
            if user["role"] != "admin":
                continue
        else:
            fid = fancoil_map.get(did)
            if allowed is not None and (fid is None or fid not in allowed):
                continue
        a["id"] = str(a["_id"])
        a.pop("_id", None)
        out.append(a)
    return out


@router.post("/alarms/ack")
async def ack_alarm(req: AlarmAck, user: dict = Depends(get_current_user)):
    r = await db.alarms.find_one_and_update(
        {"_id": ObjectId(req.alarm_id)},
        {"$set": {"acknowledged": True, "acknowledged_by": user["id"], "acknowledged_at": now_iso()}},
    )
    if not r:
        raise HTTPException(status_code=404, detail="Alarme não encontrado")
    await manager.broadcast("alarm_ack", {"id": req.alarm_id, "by": user["email"]})
    return {"ok": True}


# =============== HISTORY / REPORTS ===============
@router.get("/history/{fancoil_id}")
async def get_history(fancoil_id: str, days: int = 1, user: dict = Depends(get_current_user)):
    if not await can_access_fancoil(user, fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão")
    fc = await db.fancoils.find_one({"_id": ObjectId(fancoil_id)})
    if not fc:
        raise HTTPException(status_code=404, detail="Fancoil não encontrado")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db.history.find({"device_id": fc["device_id"], "timestamp": {"$gte": since}}).sort("timestamp", 1).limit(10000)
    out = []
    async for h in cursor:
        h.pop("_id", None)
        out.append(h)
    return out


@router.get("/reports/commands")
async def report_commands(days: int = 7, format: str = "json", user: dict = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    allowed = await allowed_fancoil_ids(user)
    fancoil_map = {}
    async for fc in db.fancoils.find({}):
        fancoil_map[fc["device_id"]] = {"id": str(fc["_id"]), "name": fc["name"]}
    cursor = db.command_log.find({"timestamp": {"$gte": since}}).sort("timestamp", -1).limit(5000)
    rows = []
    async for c in cursor:
        did = c.get("device_id")
        fm = fancoil_map.get(did, {"id": None, "name": did})
        if allowed is not None and fm["id"] not in allowed:
            continue
        rows.append({
            "timestamp": c["timestamp"],
            "fancoil": fm["name"],
            "device_id": did,
            "kind": c.get("kind"),
            "value": c.get("value"),
            "previous_value": c.get("previous_value"),
            "confirmed": c.get("confirmed", False),
            "user_id": c.get("user_id"),
        })
    if format == "csv":
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()) if rows else ["timestamp", "fancoil"])
        w.writeheader()
        for r in rows:
            w.writerow(r)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=log_comandos.csv"},
        )
    return rows


@router.get("/reports/access-log")
async def report_access(days: int = 30, _: dict = Depends(require_admin)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db.access_log.find({"timestamp": {"$gte": since}}).sort("timestamp", -1).limit(2000)
    rows = []
    async for a in cursor:
        a.pop("_id", None)
        rows.append(a)
    return rows


@router.get("/reports/hours-on")
async def report_hours_on(days: int = 30, user: dict = Depends(get_current_user)):
    """Approximate hours ON per fancoil based on history samples (1 min each)."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    allowed = await allowed_fancoil_ids(user)
    results = {}
    async for fc in db.fancoils.find({}):
        fid = str(fc["_id"])
        if allowed is not None and fid not in allowed:
            continue
        count = await db.history.count_documents({
            "device_id": fc["device_id"],
            "timestamp": {"$gte": since},
            "status": True,
        })
        results[fc["name"]] = round(count / 60.0, 2)  # minutes -> hours
    return results


# =============== ADMIN / SETTINGS ===============
@router.get("/admin/settings")
async def get_settings(_: dict = Depends(require_admin)):
    s = await db.settings.find_one({"_id": "global"}) or {}
    s.pop("_id", None)
    s["broker_connected"] = svc.connected
    s["broker_last_error"] = svc.last_error
    s["simulation_enabled"] = s.get("simulation_enabled", True)
    return s


@router.put("/admin/settings")
async def update_settings(req: SettingsUpdate, _: dict = Depends(require_admin)):
    upd = {k: v for k, v in req.dict().items() if v is not None}
    if "broker" in upd and isinstance(upd["broker"], dict) is False:
        upd["broker"] = upd["broker"]
    await db.settings.update_one({"_id": "global"}, {"$set": upd}, upsert=True)
    # restart svc if broker/simulation changed
    if "broker" in upd or "simulation_enabled" in upd:
        await svc.restart()
    s = await db.settings.find_one({"_id": "global"}) or {}
    s.pop("_id", None)
    s["broker_connected"] = svc.connected
    s["broker_last_error"] = svc.last_error
    return s


class BrokerTestReq(BaseModel):
    host: str
    port: int = 1883
    username: str = ""
    password: str = ""
    tls: bool = False
    client_id: str = "pilares-backend"


@router.post("/admin/broker/test")
async def test_broker_connection(req: BrokerTestReq, _: dict = Depends(require_admin)):
    """Try to connect to the broker without touching the running client. Blocking op; short timeout."""
    import asyncio as _asyncio
    result = await _asyncio.to_thread(
        _sync_test, req.host, req.port, req.username, req.password, req.tls, req.client_id
    )
    return result


def _sync_test(host, port, username, password, tls, client_id):
    import asyncio as _asyncio
    loop = _asyncio.new_event_loop()
    try:
        return loop.run_until_complete(
            svc.test_connection(host=host, port=port, username=username,
                                password=password, tls=tls, client_id=client_id)
        )
    finally:
        loop.close()


@router.get("/admin/detected-devices")
async def detected_devices(_: dict = Depends(require_admin)):
    out = []
    async for d in db.devices.find({}).sort("last_seen", -1):
        d.pop("_id", None)
        out.append(d)
    return out


@router.get("/admin/mqtt/sniff")
async def mqtt_sniff_summary(_: dict = Depends(require_admin)):
    """Live summary of raw MQTT traffic grouped by device_id."""
    return {
        "connected": svc.connected,
        "simulation": svc.simulation,
        "prefix": svc.topic_prefix,
        "devices": svc.sniff_summary(),
        "unknown_sample": svc.get_sniff_unknown()[-30:],
    }


@router.get("/admin/mqtt/sniff/{device_id}")
async def mqtt_sniff_device(device_id: str, _: dict = Depends(require_admin)):
    """Last ~50 raw messages received for a given device_id."""
    return {"device_id": device_id, "events": svc.get_sniff(device_id)}


# =============== TOPIC MAPPINGS (admin only) ===============
def _mapping_out(m: dict) -> dict:
    return {
        "id": str(m["_id"]),
        "topic": m["topic"],
        "target_device_id": m["target_device_id"],
        "target_var": m["target_var"],
        "enabled": m.get("enabled", True),
    }


@router.get("/admin/topic-mappings")
async def list_topic_mappings(_: dict = Depends(require_admin)):
    out = []
    async for m in db.topic_mappings.find({}).sort("topic", 1):
        out.append(_mapping_out(m))
    return out


@router.post("/admin/topic-mappings")
async def create_topic_mapping(req: TopicMappingCreate, _: dict = Depends(require_admin)):
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Tópico vazio")
    existing = await db.topic_mappings.find_one({"topic": topic})
    if existing:
        raise HTTPException(status_code=400, detail="Já existe um mapeamento para este tópico")
    doc = {
        "topic": topic,
        "target_device_id": req.target_device_id.strip(),
        "target_var": req.target_var,
        "enabled": True,
        "created_at": now_iso(),
    }
    res = await db.topic_mappings.insert_one(doc)
    doc["_id"] = res.inserted_id
    await svc.reload_mappings()
    return _mapping_out(doc)


@router.patch("/admin/topic-mappings/{mid}")
async def update_topic_mapping(mid: str, req: TopicMappingUpdate, _: dict = Depends(require_admin)):
    update = {k: v for k, v in req.dict(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Nada para atualizar")
    r = await db.topic_mappings.update_one({"_id": ObjectId(mid)}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Mapeamento não encontrado")
    await svc.reload_mappings()
    doc = await db.topic_mappings.find_one({"_id": ObjectId(mid)})
    return _mapping_out(doc)


@router.delete("/admin/topic-mappings/{mid}")
async def delete_topic_mapping(mid: str, _: dict = Depends(require_admin)):
    r = await db.topic_mappings.delete_one({"_id": ObjectId(mid)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Mapeamento não encontrado")
    await svc.reload_mappings()
    return {"ok": True}


# =============== BACKUP / RESTORE (admin only) ===============
BACKUP_COLLECTIONS = [
    "users", "fancoils", "schedules", "alarms", "device_states", "settings",
    "pavimentos", "lighting_controllers", "lighting_points", "lighting_states",
    "lighting_events", "topic_mappings",
]
UPLOADS_DIR = Path(__file__).parent / "uploads"


@router.get("/admin/backup")
async def download_backup(_: dict = Depends(require_admin)):
    """Gera um tar.gz com todas as coleções do Mongo + arquivos de uploads (plantas, logos)."""
    buf = io.BytesIO()
    collections_info = []
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        # 1) Dump de cada coleção em JSON (bson_dumps preserva ObjectId/datetime)
        for name in BACKUP_COLLECTIONS:
            docs = await db[name].find({}).to_list(length=None)
            data = bson_dumps(docs, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name=f"db/{name}.json")
            info.size = len(data)
            info.mtime = int(datetime.now().timestamp())
            tar.addfile(info, io.BytesIO(data))
            collections_info.append({"name": name, "count": len(docs), "bytes": len(data)})
        # 2) Arquivos de upload (plantas, logos)
        uploaded_files = 0
        if UPLOADS_DIR.exists():
            for file_path in UPLOADS_DIR.rglob("*"):
                if file_path.is_file():
                    rel = file_path.relative_to(UPLOADS_DIR.parent)
                    tar.add(str(file_path), arcname=str(rel))
                    uploaded_files += 1
        # 3) Metadata
        meta = {
            "version": "1.0",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "collections": collections_info,
            "uploaded_files": uploaded_files,
            "app": "NX-360 BMS",
        }
        meta_bytes = json.dumps(meta, indent=2).encode("utf-8")
        info = tarfile.TarInfo(name="metadata.json")
        info.size = len(meta_bytes)
        info.mtime = int(datetime.now().timestamp())
        tar.addfile(info, io.BytesIO(meta_bytes))

    buf.seek(0)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"nx360-backup-{stamp}.tar.gz"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/admin/restore")
async def restore_backup(
    file: UploadFile = File(...),
    wipe: bool = False,
    _: dict = Depends(require_admin),
):
    """Restaura um backup gerado por /api/admin/backup.
    - `wipe=true`: apaga TUDO antes de inserir (recomendado quando restaurando num servidor zerado)
    - `wipe=false` (padrão): mergeia (insert_many ignorando duplicados por _id)
    """
    content = await file.read()
    if len(content) > 500 * 1024 * 1024:  # 500 MB
        raise HTTPException(400, "Arquivo maior que 500 MB")
    try:
        tar = tarfile.open(fileobj=io.BytesIO(content), mode="r:gz")
    except Exception as e:
        raise HTTPException(400, f"Arquivo inválido (não é tar.gz): {e}")

    # Validar: tem metadata.json?
    try:
        meta_member = tar.getmember("metadata.json")
        meta_bytes = tar.extractfile(meta_member).read()
        meta = json.loads(meta_bytes.decode("utf-8"))
        if meta.get("app") != "NX-360 BMS":
            raise HTTPException(400, "Backup não é do NX-360 BMS")
    except KeyError:
        raise HTTPException(400, "Backup inválido: metadata.json ausente")

    summary = {"collections": {}, "files_restored": 0, "wipe": wipe}

    # Restaurar coleções
    for name in BACKUP_COLLECTIONS:
        member_name = f"db/{name}.json"
        try:
            member = tar.getmember(member_name)
        except KeyError:
            summary["collections"][name] = "skipped (not in backup)"
            continue
        raw = tar.extractfile(member).read()
        docs = bson_loads(raw.decode("utf-8"))
        coll = db[name]
        if wipe:
            await coll.delete_many({})
        inserted = 0
        skipped = 0
        for doc in docs:
            try:
                await coll.insert_one(doc)
                inserted += 1
            except Exception:
                skipped += 1  # duplicate _id ou outro erro
        summary["collections"][name] = {"inserted": inserted, "skipped": skipped}

    # Restaurar arquivos de upload (com proteção contra path traversal / zip-slip)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    uploads_root = UPLOADS_DIR.resolve()
    for member in tar.getmembers():
        if not (member.isfile() and member.name.startswith("uploads/")):
            continue
        # Ignora caminhos absolutos ou com ".."
        if member.name.startswith("/") or ".." in Path(member.name).parts:
            logger.warning("restore: ignorando membro suspeito '%s'", member.name)
            continue
        rel = Path(member.name).relative_to("uploads")
        target = (UPLOADS_DIR / rel)
        # Valida que o caminho final resolvido fica dentro de UPLOADS_DIR
        try:
            resolved = target.resolve()
        except Exception:
            logger.warning("restore: não resolveu caminho de '%s'", member.name)
            continue
        try:
            resolved.relative_to(uploads_root)
        except ValueError:
            logger.warning("restore: membro '%s' aponta para fora de UPLOADS_DIR — ignorado", member.name)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        # Self-hosted deploy: files vão para o volume Docker 'nx360_uploads' persistente
        # (não é Emergent cloud; esse app roda em servidor próprio via docker-compose)
        src = tar.extractfile(member)
        if src is None:
            continue
        Path(str(target)).write_bytes(src.read())
        summary["files_restored"] += 1

    tar.close()
    # Reload runtime caches
    try:
        await svc.reload_mappings()
    except Exception:
        pass
    try:
        from lighting_service import lighting_svc
        await lighting_svc.restore()
    except Exception:
        pass
    return summary


# =============== SCHEDULES ===============
def _schedule_out(s: dict) -> dict:
    return {
        "id": str(s["_id"]),
        "fancoil_id": s["fancoil_id"],
        "days": s.get("days", []),
        "hour": s["hour"],
        "minute": s["minute"],
        "action": s["action"],
        "value": s["value"],
        "enabled": s.get("enabled", True),
        "last_run": s.get("last_run"),
    }


@router.get("/schedules")
async def list_all_schedules(user: dict = Depends(get_current_user)):
    """Retorna todos os agendamentos dos fancoils que o usuário pode acessar."""
    out = []
    async for s in db.schedules.find({}).sort([("hour", 1), ("minute", 1)]):
        if not await can_access_fancoil(user, s["fancoil_id"]):
            continue
        out.append(_schedule_out(s))
    return out


@router.get("/schedules/{fancoil_id}")
async def list_schedules(fancoil_id: str, user: dict = Depends(get_current_user)):
    if not await can_access_fancoil(user, fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão")
    out = []
    async for s in db.schedules.find({"fancoil_id": fancoil_id}).sort([("hour", 1), ("minute", 1)]):
        out.append(_schedule_out(s))
    return out


MAX_SCHEDULES_PER_DEVICE = 10


@router.get("/schedules/health/online-sem-agenda")
async def online_without_schedule(user: dict = Depends(get_current_user)):
    """Lista fancoils online cujo ID ainda não tem nenhuma agenda cadastrada."""
    allowed = await allowed_fancoil_ids(user)
    out = []
    async for fc in db.fancoils.find({"active": {"$ne": False}}):
        fid = str(fc["_id"])
        if allowed is not None and fid not in allowed:
            continue
        count = await db.schedules.count_documents({"fancoil_id": fid})
        if count > 0:
            continue
        st = svc.states.get(fc["device_id"])
        if not st or not st.online:
            continue
        out.append({
            "fancoil_id": fid,
            "name": fc.get("name"),
            "device_id": fc.get("device_id"),
            "floor": fc.get("floor"),
            "side": fc.get("side"),
        })
    return out


class CopyScheduleReq(BaseModel):
    from_fancoil_id: str
    to_fancoil_id: str
    replace: bool = False  # True = apaga agendas do destino antes de copiar


@router.post("/schedules/copy")
async def copy_schedules(req: CopyScheduleReq, user: dict = Depends(get_current_user)):
    """Copia todos os agendamentos de um fancoil para outro (útil ao trocar placa).
    Publica SCHEDULE/SET na controladora de destino após copiar.
    """
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode copiar agendamentos")
    if not await can_access_fancoil(user, req.from_fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão na origem")
    if not await can_access_fancoil(user, req.to_fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão no destino")
    dst = await db.fancoils.find_one({"_id": ObjectId(req.to_fancoil_id)})
    if not dst:
        raise HTTPException(status_code=404, detail="Fancoil de destino não encontrado")

    if req.replace:
        await db.schedules.delete_many({"fancoil_id": req.to_fancoil_id})

    # Verifica limite 10
    existing = await db.schedules.count_documents({"fancoil_id": req.to_fancoil_id})
    src_count = await db.schedules.count_documents({"fancoil_id": req.from_fancoil_id})
    if existing + src_count > MAX_SCHEDULES_PER_DEVICE:
        raise HTTPException(
            status_code=400,
            detail=f"Limite de {MAX_SCHEDULES_PER_DEVICE} agendamentos por controladora excedido "
                   f"(destino tem {existing}, origem tem {src_count}).",
        )

    copied = 0
    async for s in db.schedules.find({"fancoil_id": req.from_fancoil_id}):
        doc = {
            "fancoil_id": req.to_fancoil_id,
            "days": s.get("days", []),
            "hour": s.get("hour", 0),
            "minute": s.get("minute", 0),
            "action": s.get("action"),
            "value": s.get("value"),
            "enabled": s.get("enabled", True),
            "created_at": now_iso(),
            "created_by": user["id"],
            "last_run": None,
        }
        await db.schedules.insert_one(doc)
        copied += 1
    await svc.publish_schedule_config(dst["device_id"])
    return {"copied": copied, "destination_device_id": dst["device_id"]}


@router.post("/schedules/bulk")
async def create_schedule_bulk(req: ScheduleBulkCreate, user: dict = Depends(get_current_user)):
    """Cria o mesmo agendamento em TODOS os fancoils acessíveis (ou nos informados).
    Publica SCHEDULE/SET em cada controladora.
    """
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode criar agendamentos")

    allowed = await allowed_fancoil_ids(user)  # None para admin, lista para operator
    # Monta a lista alvo
    if req.fancoil_ids:
        target_ids = []
        for fid in req.fancoil_ids:
            if await can_access_fancoil(user, fid):
                target_ids.append(fid)
    else:
        if allowed is None:  # admin: pega todos ativos
            target_ids = [str(f["_id"]) async for f in db.fancoils.find({"active": {"$ne": False}})]
        else:
            target_ids = list(allowed)

    if not target_ids:
        raise HTTPException(status_code=400, detail="Nenhum fancoil elegível")

    # Validação setpoint
    if req.action == "setpoint":
        try:
            v = float(req.value)
            if v < 10.0 or v > 35.0:
                raise HTTPException(status_code=400, detail="Setpoint deve estar entre 10 e 35 °C")
        except ValueError:
            raise HTTPException(status_code=400, detail="Setpoint inválido")

    created = []
    skipped = []
    for fid in target_ids:
        try:
            fc = await db.fancoils.find_one({"_id": ObjectId(fid)})
            if not fc:
                skipped.append({"fancoil_id": fid, "reason": "não encontrado"})
                continue
            # Limite 10 slots
            cur_count = await db.schedules.count_documents({"fancoil_id": fid})
            if cur_count >= MAX_SCHEDULES_PER_DEVICE:
                skipped.append({"fancoil_id": fid, "name": fc.get("name"), "reason": f"já no limite de {MAX_SCHEDULES_PER_DEVICE} agendamentos"})
                continue
            doc = {
                "fancoil_id": fid,
                "days": req.days,
                "hour": req.hour,
                "minute": req.minute,
                "action": req.action,
                "value": req.value,
                "enabled": req.enabled,
                "created_at": now_iso(),
                "created_by": user["id"],
                "last_run": None,
            }
            res = await db.schedules.insert_one(doc)
            doc["_id"] = res.inserted_id
            await svc.publish_schedule_config(fc["device_id"])
            created.append(_schedule_out(doc))
        except Exception as e:
            logger.exception("[bulk-schedule] falha em %s", fid)
            skipped.append({"fancoil_id": fid, "reason": str(e)})

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "created": created,
        "skipped": skipped,
    }


@router.post("/schedules")
async def create_schedule(req: ScheduleCreate, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode criar agendamentos")
    if not await can_access_fancoil(user, req.fancoil_id):
        raise HTTPException(status_code=403, detail="Sem permissão")
    # Validações do contrato ESP32
    if req.action == "setpoint":
        try:
            v = float(req.value)
            if v < 10.0 or v > 35.0:
                raise HTTPException(status_code=400, detail="Setpoint deve estar entre 10 e 35 °C")
        except ValueError:
            raise HTTPException(status_code=400, detail="Setpoint inválido")
    count = await db.schedules.count_documents({"fancoil_id": req.fancoil_id})
    if count >= MAX_SCHEDULES_PER_DEVICE:
        raise HTTPException(
            status_code=400,
            detail=f"Esta controladora já tem {MAX_SCHEDULES_PER_DEVICE} agendamentos (limite máximo).",
        )
    fc = await db.fancoils.find_one({"_id": ObjectId(req.fancoil_id)})
    if not fc:
        raise HTTPException(status_code=404, detail="Fancoil não encontrado")
    doc = req.dict()
    doc["created_at"] = now_iso()
    doc["created_by"] = user["id"]
    doc["last_run"] = None
    res = await db.schedules.insert_one(doc)
    doc["_id"] = res.inserted_id
    await svc.publish_schedule_config(fc["device_id"])
    return _schedule_out(doc)


@router.patch("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, req: ScheduleUpdate, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode editar")
    s = await db.schedules.find_one({"_id": ObjectId(schedule_id)})
    if not s:
        raise HTTPException(status_code=404, detail="Agendamento não encontrado")
    if not await can_access_fancoil(user, s["fancoil_id"]):
        raise HTTPException(status_code=403, detail="Sem permissão")
    upd = {k: v for k, v in req.dict().items() if v is not None}
    if upd:
        await db.schedules.update_one({"_id": ObjectId(schedule_id)}, {"$set": upd})
    s = await db.schedules.find_one({"_id": ObjectId(schedule_id)})
    fc = await db.fancoils.find_one({"_id": ObjectId(s["fancoil_id"])})
    if fc:
        await svc.publish_schedule_config(fc["device_id"])
    return _schedule_out(s)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(status_code=403, detail="Viewer não pode remover")
    s = await db.schedules.find_one({"_id": ObjectId(schedule_id)})
    if not s:
        raise HTTPException(status_code=404, detail="Não encontrado")
    if not await can_access_fancoil(user, s["fancoil_id"]):
        raise HTTPException(status_code=403, detail="Sem permissão")
    fc = await db.fancoils.find_one({"_id": ObjectId(s["fancoil_id"])})
    await db.schedules.delete_one({"_id": ObjectId(schedule_id)})
    if fc:
        await svc.publish_schedule_config(fc["device_id"])
    return {"ok": True}


# =============== HEATMAP ===============
@router.get("/heatmap")
async def heatmap(user: dict = Depends(get_current_user)):
    """Snapshot of temperature per fancoil (filtered by permission)."""
    allowed = await allowed_fancoil_ids(user)
    cells = []
    async for fc in db.fancoils.find({"active": True}):
        fid = str(fc["_id"])
        if allowed is not None and fid not in allowed:
            continue
        st = svc.get_state(fc["device_id"])
        cells.append({
            "id": fid,
            "name": fc["name"],
            "floor": fc["floor"],
            "side": fc["side"],
            "temperature": st.temperature,
            "setpoint": st.setpoint,
            "status": st.status,
            "online": st.online,
            "temp_error": st.temp_error,
        })
    return cells


# =============== WEBSOCKET ===============
@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # Send snapshot
        fancoils = await db.fancoils.find({}).to_list(500)
        snapshot = []
        for fc in fancoils:
            snapshot.append({
                "device_id": fc["device_id"],
                "state": svc.get_state(fc["device_id"]).to_dict(),
            })
        import json as _j
        await ws.send_text(_j.dumps({"event": "snapshot", "data": snapshot}))
        while True:
            await ws.receive_text()  # Ignore client msgs
    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception:
        logger.exception("WS error")
        await manager.disconnect(ws)
