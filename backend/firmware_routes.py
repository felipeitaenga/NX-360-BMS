"""Biblioteca de firmwares (CATEGORIA → MODELO → VERSÃO), download público por token e OTA escalonado."""
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
from controllers import (
    CATEGORIAS, CATEGORIA_LABEL, catalog_map, inventory, registry, version_key,
)

logger = logging.getLogger("firmware")
router = APIRouter(prefix="/api")

FW_DIR = Path(__file__).parent / "uploads" / "firmware"
MAX_BYTES = 4 * 1024 * 1024
OTA_TIMEOUT_S = 600
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
SIG_RE = re.compile(rb"NXFW\|TIPO=([^|\x00]{1,32})\|MODELO=([^|\x00]{1,32})\|VERSAO=([^|\x00]{1,16})\|")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fw_base() -> str:
    pub = os.environ.get("FIRMWARE_PUBLIC_BASE", "").strip()
    if pub:
        return pub.rstrip("/") + "/"
    return os.environ["FRONTEND_URL"].rstrip("/") + "/api/firmware/files/"


def _fw_url(d: dict) -> str:
    return f"{_fw_base()}{d['token']}/{d['nome_arquivo']}"


def _fw_out(d: dict) -> dict:
    out = {k: v for k, v in d.items() if k != "_id"}
    out["id"] = str(d["_id"])
    out["url"] = _fw_url(d)
    return out


def parse_signature(data: bytes) -> Optional[dict]:
    m = SIG_RE.search(data)
    if not m:
        return None
    t, mo, v = (x.decode("ascii", "replace").strip() for x in m.groups())
    return {"tipo": t.upper(), "modelo": mo.upper(), "versao": v}


async def migrate_firmwares():
    await db.firmwares.update_many(
        {"modelo": {"$exists": False}},
        {"$set": {"modelo": "FC300", "categoria": "FANCOIL", "assinatura": False}},
    )
    try:
        await db.firmwares.drop_index("versao_1")
    except Exception:
        pass
    await db.firmwares.create_index([("modelo", 1), ("versao", 1)], unique=True)


async def _latest_by_model() -> dict:
    latest = {}
    async for f in db.firmwares.find({}, {"modelo": 1, "versao": 1}):
        cur = latest.get(f["modelo"])
        if not cur or version_key(f["versao"]) > version_key(cur):
            latest[f["modelo"]] = f["versao"]
    return latest


async def _categoria_modelo(modelo: str, tipo: Optional[str] = None) -> str:
    """Categoria sem cadastro: TIPO da assinatura → firmware já enviado → controladoras do modelo → catálogo antigo."""
    t = (tipo or "").strip().upper()
    if t in CATEGORIAS:
        return t
    fw = await db.firmwares.find_one({"modelo": modelo, "categoria": {"$in": [c for c in CATEGORIAS if c != "OUTRO"]}}, {"categoria": 1})
    if fw:
        return fw["categoria"]
    for c in await inventory():
        if c["modelo"] == modelo and c["categoria"] != "OUTRO":
            return c["categoria"]
    legado = (await catalog_map()).get(modelo)
    return (legado or {}).get("categoria") or "OUTRO"


# ---------------- Upload / lista / download ----------------
@router.post("/admin/firmware")
async def upload_firmware(
    file: UploadFile = File(...),
    versao: str = Form(""),
    modelo: str = Form(""),
    notas: str = Form(""),
    user: dict = Depends(require_admin),
):
    if not (file.filename or "").lower().endswith(".bin"):
        raise HTTPException(400, "Envie um arquivo .bin")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Arquivo maior que 4 MB")
    if not data or data[0] != 0xE9:
        raise HTTPException(400, "Arquivo não é uma imagem de firmware ESP32 válida (1º byte ≠ 0xE9)")
    versao, modelo = versao.strip(), modelo.strip().upper()
    sig = parse_signature(data)
    if sig:
        if (modelo and modelo != sig["modelo"]) or (versao and versao != sig["versao"]):
            raise HTTPException(400, f"Este arquivo é {sig['modelo']} v{sig['versao']}")
        modelo, versao = sig["modelo"], sig["versao"]
    elif not modelo or not versao:
        raise HTTPException(400, "Arquivo sem assinatura NXFW — informe o modelo e a versão")
    if not VERSION_RE.match(versao):
        raise HTTPException(400, "Versão inválida — use o formato X.Y.Z (ex.: 1.4.1)")
    categoria = await _categoria_modelo(modelo, sig["tipo"] if sig else None)
    if await db.firmwares.find_one({"modelo": modelo, "versao": versao}):
        raise HTTPException(409, f"{modelo} v{versao} já foi enviado")
    nome = f"{modelo.lower()}-{versao}.bin"
    token = secrets.token_hex(16)
    folder = FW_DIR / token
    folder.mkdir(parents=True, exist_ok=True)
    (folder / nome).write_bytes(data)
    doc = {
        "versao": versao, "modelo": modelo, "categoria": categoria,
        "tipo": sig["tipo"] if sig else None, "assinatura": bool(sig),
        "nome_arquivo": nome, "nome_original": file.filename, "tamanho": len(data),
        "md5": hashlib.md5(data).hexdigest(), "sha256": hashlib.sha256(data).hexdigest(),
        "token": token, "notas": notas.strip(), "enviado_por": user.get("email"), "criado_em": now_iso(),
    }
    res = await db.firmwares.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _fw_out(doc)


@router.get("/admin/firmware")
async def list_firmwares(categoria: str = "", modelo: str = "", _: dict = Depends(require_admin)):
    q = {}
    if categoria:
        q["categoria"] = categoria.upper()
    if modelo:
        q["modelo"] = modelo.upper()
    fws = [_fw_out(d) async for d in db.firmwares.find(q)]
    fws.sort(key=lambda f: (f["modelo"], version_key(f["versao"])), reverse=True)
    latest = await _latest_by_model()
    counts: dict = {}
    for c in await inventory():
        if c["modelo"] and c["versao"]:
            counts[(c["modelo"], c["versao"])] = counts.get((c["modelo"], c["versao"]), 0) + 1
    for f in fws:
        f["mais_recente"] = latest.get(f["modelo"]) == f["versao"]
        f["n_controladoras"] = counts.get((f["modelo"], f["versao"]), 0)
    return fws


@router.get("/admin/firmware/config")
async def firmware_config(_: dict = Depends(require_admin)):
    return {"base_url": _fw_base(), "personalizado": bool(os.environ.get("FIRMWARE_PUBLIC_BASE", "").strip())}


@router.get("/admin/firmware/arvore")
async def firmware_tree(_: dict = Depends(require_admin)):
    """Modelos descobertos automaticamente: controladoras que informaram MODELO + arquivos .bin enviados."""
    legado = await catalog_map()
    inv = await inventory()
    latest = await _latest_by_model()
    info: dict = {}

    def entry(modelo: str) -> dict:
        return info.setdefault(modelo, {"modelo": modelo, "categoria": None, "nome": (legado.get(modelo) or {}).get("nome", ""),
                                        "n_versoes": 0, "n_controladoras": 0, "n_desatualizadas": 0})

    async for f in db.firmwares.find({}, {"modelo": 1, "categoria": 1}):
        e = entry(f["modelo"])
        e["n_versoes"] += 1
        if f.get("categoria") in CATEGORIAS and f["categoria"] != "OUTRO":
            e["categoria"] = f["categoria"]
    for c in inv:
        if not c["modelo"]:
            continue
        e = entry(c["modelo"])
        e["n_controladoras"] += 1
        if not e["categoria"] and c["categoria"] != "OUTRO":
            e["categoria"] = c["categoria"]
        lt = latest.get(c["modelo"])
        if lt and c["versao"] != lt:
            e["n_desatualizadas"] += 1
    modelos = []
    for e in sorted(info.values(), key=lambda x: x["modelo"]):
        cat = e["categoria"] or (legado.get(e["modelo"]) or {}).get("categoria") or "OUTRO"
        modelos.append({**e, "categoria": cat, "categoria_label": CATEGORIA_LABEL.get(cat, cat),
                        "versao_mais_recente": latest.get(e["modelo"])})
    return {
        "modelos": modelos,
        "sem_modelo": sum(1 for c in inv if not c["modelo"]),
        "nao_catalogados": [],  # compatibilidade: catálogo manual não é mais usado
    }


@router.delete("/admin/firmware/{fw_id}")
async def delete_firmware(fw_id: str, _: dict = Depends(require_admin)):
    d = await db.firmwares.find_one({"_id": ObjectId(fw_id)})
    if not d:
        raise HTTPException(404, "Firmware não encontrado")
    if _batch and _batch.get("status") == "executando" and _batch.get("firmware_id") == fw_id:
        raise HTTPException(409, "Este firmware está sendo enviado agora")
    if (await _latest_by_model()).get(d["modelo"]) == d["versao"]:
        raise HTTPException(409, f"Não é possível excluir a versão mais recente do {d['modelo']}")
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
async def list_controllers(categoria: str = "", modelo: str = "", grupo: str = "", _: dict = Depends(require_admin)):
    inv = await inventory()
    if modelo:
        inv = [c for c in inv if c["modelo"] == modelo.upper()]
    elif grupo == "sem_modelo":
        inv = [c for c in inv if not c["modelo"]]
    if categoria:
        inv = [c for c in inv if c["categoria"] == categoria.upper()]
    inv.sort(key=lambda c: (c["identificacao"] is None, c["identificacao"] or c["device_id"]))
    return inv


# ---------------- OTA escalonado ----------------
_batch: Optional[dict] = None
_task: Optional[asyncio.Task] = None


class OtaReq(BaseModel):
    device_ids: List[str]
    forcar_sem_modelo: bool = False


async def _push_batch():
    await manager.broadcast("ota_batch", _batch or {})


def _live(did: str) -> dict:
    r = registry.get(did)
    st = svc.states.get(did)
    return {
        "versao": r.get("versao") or (st.firmware_version if st else None),
        "ota_state": r.get("ota_state") or (st.ota_state if st else None),
        "ota_state_at": r.get("ota_state_at") or (st.ota_state_at if st else None),
    }


async def _wait_result(did: str, versao: str, sent_at: str) -> tuple[str, str]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + OTA_TIMEOUT_S
    while loop.time() < deadline:
        await asyncio.sleep(2)
        lv = _live(did)
        if lv["versao"] == versao:
            return "ok", f"atualizada para {versao}"
        ota = (lv["ota_state"] or "").lower()
        if lv["ota_state_at"] and lv["ota_state_at"] > sent_at and ota.startswith(("erro", "rollback", "ignorado")):
            return "erro", lv["ota_state"]
    return "timeout", "sem resposta em 10 min"


async def _run_batch(fw: dict, forced: set):
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
                "device_id": did, "user_id": _batch["started_by"], "topic": topic, "kind": "OTA/SET",
                "value": fw["versao"], "modelo": fw["modelo"], "firmware_id": str(fw["_id"]),
                "versao_origem": _live(did)["versao"], "versao_destino": fw["versao"],
                "previous_value": str(_live(did)["versao"]),
                "forcado_sem_modelo": did in forced,
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
    inv = {c["device_id"]: c for c in await inventory()}
    ids = list(dict.fromkeys(req.device_ids))
    incompat = [d for d in ids if inv.get(d, {}).get("modelo") and inv[d]["modelo"] != fw["modelo"]]
    if incompat:
        desc = ", ".join(f"{d} ({inv[d]['modelo']})" for d in incompat)
        raise HTTPException(409, {"code": "modelo_incompativel", "device_ids": incompat,
                                  "message": f"Modelo incompatível: {desc} ≠ {fw['modelo']}"})
    sem_modelo = [d for d in ids if d in inv and not inv[d]["modelo"]]
    if sem_modelo and not req.forcar_sem_modelo:
        raise HTTPException(409, {"code": "sem_modelo", "device_ids": sem_modelo,
                                  "message": f"Controladora(s) sem modelo informado: {', '.join(sem_modelo)} — confirme para forçar"})
    items, skipped = [], []
    for did in ids:
        c = inv.get(did)
        if not c or not c["online"]:
            skipped.append({"device_id": did, "motivo": "offline"})
        elif c["versao"] == fw["versao"]:
            skipped.append({"device_id": did, "motivo": f"já está na {fw['versao']}"})
        else:
            items.append({"device_id": did, "status": "fila", "msg": None, "sent_at": None, "done_at": None})
    if not items:
        raise HTTPException(400, "Nenhuma controladora elegível (precisa estar ONLINE e com outra versão)")
    _batch = {
        "firmware_id": fw_id, "versao": fw["versao"], "modelo": fw["modelo"], "started_by": user.get("email"),
        "started_at": now_iso(), "finished_at": None, "status": "executando",
        "message": None, "items": items, "skipped": skipped,
    }
    _task = asyncio.create_task(_run_batch(fw, set(sem_modelo)))
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
