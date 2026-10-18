"""Firmware das controladoras: upload de .bin, download público por token e OTA escalonado."""
from __future__ import annotations
import asyncio
import hashlib
import logging
import os
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from auth import require_admin
from db import db
from mqtt_service import svc
from ws_manager import manager
from alarms import raise_alarm, clear_alarm

logger = logging.getLogger("firmware")
router = APIRouter(prefix="/api")

FW_DIR = Path(__file__).parent / "uploads" / "firmware"
MAX_BYTES = 4 * 1024 * 1024
OTA_TIMEOUT_S = 600
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fw_out(d: dict) -> dict:
    out = {k: v for k, v in d.items() if k != "_id"}
    out["id"] = str(d["_id"])
    out["url"] = _fw_url(d)
    return out


def _fw_url(d: dict) -> str:
    base = os.environ["FRONTEND_URL"].rstrip("/")
    return f"{base}/api/firmware/files/{d['token']}/{d['nome_arquivo']}"


# ---------------- Upload / lista / download ----------------
@router.post("/admin/firmware")
async def upload_firmware(
    file: UploadFile = File(...),
    versao: str = Form(...),
    notas: str = Form(""),
    user: dict = Depends(require_admin),
):
    versao = versao.strip()
    if not VERSION_RE.match(versao):
        raise HTTPException(400, "Versão inválida — use o formato X.Y.Z (ex.: 1.4.1)")
    if not (file.filename or "").lower().endswith(".bin"):
        raise HTTPException(400, "Envie um arquivo .bin")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Arquivo maior que 4 MB")
    if not data:
        raise HTTPException(400, "Arquivo vazio")
    if await db.firmwares.find_one({"versao": versao}):
        raise HTTPException(409, f"A versão {versao} já foi enviada")
    nome = re.sub(r"[^A-Za-z0-9._-]", "_", Path(file.filename).name)
    token = secrets.token_hex(16)
    folder = FW_DIR / token
    folder.mkdir(parents=True, exist_ok=True)
    (folder / nome).write_bytes(data)
    doc = {
        "versao": versao,
        "nome_arquivo": nome,
        "tamanho": len(data),
        "md5": hashlib.md5(data).hexdigest(),
        "sha256": hashlib.sha256(data).hexdigest(),
        "token": token,
        "notas": notas.strip(),
        "enviado_por": user.get("email"),
        "criado_em": now_iso(),
    }
    res = await db.firmwares.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _fw_out(doc)


@router.get("/admin/firmware")
async def list_firmwares(_: dict = Depends(require_admin)):
    return [_fw_out(d) async for d in db.firmwares.find({}).sort("criado_em", -1)]


@router.delete("/admin/firmware/{fw_id}")
async def delete_firmware(fw_id: str, _: dict = Depends(require_admin)):
    d = await db.firmwares.find_one({"_id": ObjectId(fw_id)})
    if not d:
        raise HTTPException(404, "Firmware não encontrado")
    if _batch and _batch.get("status") == "executando" and _batch.get("firmware_id") == fw_id:
        raise HTTPException(409, "Este firmware está sendo enviado agora")
    shutil.rmtree(FW_DIR / d["token"], ignore_errors=True)
    await db.firmwares.delete_one({"_id": d["_id"]})
    return {"ok": True}


@router.get("/firmware/files/{token}/{nome}")
async def download_firmware(token: str, nome: str):
    """Público (a controladora não autentica). O token aleatório protege a URL."""
    d = await db.firmwares.find_one({"token": token, "nome_arquivo": nome})
    path = FW_DIR / token / nome
    if not d or not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="application/octet-stream", filename=nome)


# ---------------- Controladoras ----------------
@router.get("/admin/firmware/controladoras")
async def list_controllers(_: dict = Depends(require_admin)):
    fcs = {fc["device_id"]: fc async for fc in db.fancoils.find({})}
    out = []
    for did in sorted(set(fcs) | {d for d in svc.states if not d.startswith("__")}):
        st = svc.get_state(did).to_dict()
        fc = fcs.get(did)
        out.append({**st, "name": fc["name"] if fc else None, "cadastrado": bool(fc)})
    out.sort(key=lambda x: (not x["cadastrado"], x["name"] or x["device_id"]))
    return out


# ---------------- OTA escalonado ----------------
_batch: Optional[dict] = None
_task: Optional[asyncio.Task] = None


class OtaReq(BaseModel):
    device_ids: List[str]


async def _push_batch():
    await manager.broadcast("ota_batch", _batch or {})


async def _wait_result(did: str, versao: str, sent_at: str) -> tuple[str, str]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + OTA_TIMEOUT_S
    while loop.time() < deadline:
        await asyncio.sleep(2)
        st = svc.get_state(did)
        if st.firmware_version == versao:
            return "ok", f"atualizada para {versao}"
        ota = (st.ota_state or "").lower()
        if st.ota_state_at and st.ota_state_at > sent_at and ota.startswith(("erro", "rollback", "ignorado")):
            return "erro", st.ota_state
    return "timeout", "sem resposta em 10 min"


async def _run_batch(fw: dict, user_email: str):
    global _batch
    url = _fw_url(fw)
    payload = f"{fw['versao']};{url};{fw['md5']}"
    try:
        for item in _batch["items"]:
            if _batch["status"] != "executando":
                break
            did = item["device_id"]
            topic = f"{svc.topic_prefix}/{did}/OTA/SET"
            item.update(status="enviado", sent_at=now_iso())
            svc._client.publish(topic, payload, qos=1, retain=False)
            await db.command_log.insert_one({
                "device_id": did, "user_id": user_email, "topic": topic, "kind": "OTA/SET",
                "value": fw["versao"], "previous_value": str(svc.get_state(did).firmware_version),
                "timestamp": item["sent_at"], "confirmed": False, "confirmed_at": None,
            })
            await _push_batch()
            status, msg = await _wait_result(did, fw["versao"], item["sent_at"])
            item.update(status=status, msg=msg, done_at=now_iso())
            if status == "ok":
                await clear_alarm(did, "OTA_FALHA")
                await db.command_log.update_one(
                    {"device_id": did, "kind": "OTA/SET", "timestamp": item["sent_at"]},
                    {"$set": {"confirmed": True, "confirmed_at": item["done_at"]}},
                )
            else:
                await raise_alarm(did, "OTA_FALHA", {"versao": fw["versao"], "motivo": msg})
                _batch["status"] = "pausado"
                _batch["message"] = f"Lote pausado: {did} — {msg}. As demais não foram atualizadas."
            await _push_batch()
        if _batch["status"] == "executando":
            _batch["status"] = "concluido"
            _batch["message"] = "Lote concluído"
    except Exception as e:
        logger.exception("OTA batch erro")
        _batch["status"] = "pausado"
        _batch["message"] = f"Erro interno: {e}"
    _batch["finished_at"] = now_iso()
    await _push_batch()


@router.post("/admin/firmware/{fw_id}/enviar")
async def send_ota(fw_id: str, req: OtaReq, user: dict = Depends(require_admin)):
    global _batch, _task
    if _batch and _batch["status"] == "executando":
        raise HTTPException(409, "Já existe um lote de atualização em andamento")
    if svc.simulation or not (svc._client and svc.connected):
        raise HTTPException(400, "Broker MQTT desconectado (ou modo simulação ativo)")
    fw = await db.firmwares.find_one({"_id": ObjectId(fw_id)})
    if not fw:
        raise HTTPException(404, "Firmware não encontrado")
    items, skipped = [], []
    for did in dict.fromkeys(req.device_ids):
        st = svc.states.get(did)
        if not st or not st.online:
            skipped.append({"device_id": did, "motivo": "offline"})
        elif st.firmware_version == fw["versao"]:
            skipped.append({"device_id": did, "motivo": f"já está na {fw['versao']}"})
        else:
            items.append({"device_id": did, "status": "fila", "msg": None, "sent_at": None, "done_at": None})
    if not items:
        raise HTTPException(400, "Nenhuma controladora elegível (precisa estar ONLINE e com outra versão)")
    _batch = {
        "firmware_id": fw_id, "versao": fw["versao"], "started_by": user.get("email"),
        "started_at": now_iso(), "finished_at": None, "status": "executando",
        "message": None, "items": items, "skipped": skipped,
    }
    _task = asyncio.create_task(_run_batch(fw, user.get("email")))
    await _push_batch()
    return _batch


@router.get("/admin/firmware/lote")
async def get_batch(_: dict = Depends(require_admin)):
    return _batch or {}


@router.post("/admin/firmware/lote/cancelar")
async def cancel_batch(_: dict = Depends(require_admin)):
    if _batch and _batch["status"] == "executando":
        _batch["status"] = "cancelado"
        _batch["message"] = "Cancelado — a controladora em andamento termina sozinha; as demais não serão enviadas."
        await _push_batch()
    return _batch or {}
