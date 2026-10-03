"""Lighting module REST routes."""
from __future__ import annotations
import os
import re
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from db import db
from auth import get_current_user, require_admin
from lighting_service import lighting_svc

logger = logging.getLogger("lighting_routes")

router = APIRouter(prefix="/api/lighting", tags=["lighting"])

UPLOAD_DIR = Path(__file__).parent / "uploads" / "plantas"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".svg", ".webp"}
MAX_SIZE = 15 * 1024 * 1024  # 15 MB
MQTT_ID_RE = re.compile(r"^[0-9A-Z]{4}$")  # 4 alphanumeric uppercase (hex + letras p/ IDs tipo "TEST")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------- Models -------
class PavimentoCreate(BaseModel):
    nome: str
    ordem: int = 0


class PavimentoUpdate(BaseModel):
    nome: Optional[str] = None
    ordem: Optional[int] = None


class ControladoraCreate(BaseModel):
    mqtt_id: str = Field(..., description="4-char hex (ex.: A1F3)")
    nome: str
    local: str = ""


class ControladoraUpdate(BaseModel):
    nome: Optional[str] = None
    local: Optional[str] = None


class CircuitoRename(BaseModel):
    numero: int = Field(..., ge=1, le=16)
    nome_circuito: str


class PontoCreate(BaseModel):
    pavimento_id: str
    controladora_id: str
    circuito: int = Field(..., ge=1, le=16)
    nome: str
    tipo: Literal["lampada", "spot", "plafon", "fita_led", "arandela", "refletor", "balizador", "emergencia"]
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class PontoUpdate(BaseModel):
    pavimento_id: Optional[str] = None
    controladora_id: Optional[str] = None
    circuito: Optional[int] = Field(None, ge=1, le=16)
    nome: Optional[str] = None
    tipo: Optional[Literal["lampada", "spot", "plafon", "fita_led", "arandela", "refletor", "balizador", "emergencia"]] = None
    x: Optional[float] = Field(None, ge=0.0, le=1.0)
    y: Optional[float] = Field(None, ge=0.0, le=1.0)


class CircuitCommand(BaseModel):
    value: Literal["true", "false", "TOGGLE"]


class ModeCommand(BaseModel):
    mode: Literal["AUTO", "MANUAL"]


# ------- Helpers -------
def _pav_out(p: dict) -> dict:
    return {
        "id": str(p["_id"]),
        "nome": p["nome"],
        "ordem": p.get("ordem", 0),
        "planta_url": p.get("planta_url"),
        "largura_px": p.get("largura_px"),
        "altura_px": p.get("altura_px"),
    }


def _ctrl_out(c: dict) -> dict:
    state = lighting_svc.controllers.get(c["mqtt_id"], {})
    return {
        "id": str(c["_id"]),
        "mqtt_id": c["mqtt_id"],
        "nome": c["nome"],
        "local": c.get("local", ""),
        "online": state.get("online", False),
        "rede": state.get("rede"),
        "ultimo_contato": state.get("ultimo_contato"),
        "circuitos": [
            {
                "numero": i,
                "nome_circuito": (c.get("circuitos", {}) or {}).get(str(i), f"L{i:02d}"),
                "estado": state.get("circuitos", {}).get(i, {}).get("estado") if state else None,
                "modo": state.get("circuitos", {}).get(i, {}).get("modo") if state else None,
                "last_input": state.get("circuitos", {}).get(i, {}).get("last_input") if state else None,
            }
            for i in range(1, 17)
        ],
    }


def _ponto_out(p: dict) -> dict:
    return {
        "id": str(p["_id"]),
        "pavimento_id": p["pavimento_id"],
        "controladora_id": p["controladora_id"],
        "circuito": p["circuito"],
        "nome": p["nome"],
        "tipo": p["tipo"],
        "x": p["x"],
        "y": p["y"],
    }


# ============ Pavimentos ============
@router.get("/pavimentos")
async def list_pavimentos(user: dict = Depends(get_current_user)):
    out = []
    async for p in db.pavimentos.find({}).sort([("ordem", 1), ("nome", 1)]):
        out.append(_pav_out(p))
    return out


@router.post("/pavimentos")
async def create_pavimento(req: PavimentoCreate, _: dict = Depends(require_admin)):
    doc = {"nome": req.nome, "ordem": req.ordem, "planta_url": None,
           "largura_px": None, "altura_px": None, "created_at": now_iso()}
    r = await db.pavimentos.insert_one(doc)
    doc["_id"] = r.inserted_id
    return _pav_out(doc)


@router.patch("/pavimentos/{pid}")
async def update_pavimento(pid: str, req: PavimentoUpdate, _: dict = Depends(require_admin)):
    update = {k: v for k, v in req.dict(exclude_unset=True).items() if v is not None}
    if update:
        r = await db.pavimentos.update_one({"_id": ObjectId(pid)}, {"$set": update})
        if r.matched_count == 0:
            raise HTTPException(404, "Pavimento não encontrado")
    doc = await db.pavimentos.find_one({"_id": ObjectId(pid)})
    return _pav_out(doc)


@router.delete("/pavimentos/{pid}")
async def delete_pavimento(pid: str, _: dict = Depends(require_admin)):
    pontos_count = await db.lighting_points.count_documents({"pavimento_id": pid})
    if pontos_count > 0:
        raise HTTPException(400, f"Pavimento tem {pontos_count} ponto(s). Remova-os primeiro.")
    r = await db.pavimentos.delete_one({"_id": ObjectId(pid)})
    if r.deleted_count == 0:
        raise HTTPException(404, "Pavimento não encontrado")
    return {"ok": True}


@router.post("/pavimentos/{pid}/planta")
async def upload_planta(pid: str, file: UploadFile = File(...), _: dict = Depends(require_admin)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Extensão inválida. Use PNG, JPG, SVG ou WEBP.")
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(400, "Arquivo maior que 15 MB")
    # Try to detect dimensions
    width = height = None
    if ext in (".png", ".jpg", ".jpeg", ".webp"):
        try:
            from PIL import Image
            import io as _io
            img = Image.open(_io.BytesIO(data))
            width, height = img.size
        except Exception:
            pass
    fname = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / fname).write_bytes(data)
    planta_url = f"/api/lighting/plantas/{fname}"
    await db.pavimentos.update_one(
        {"_id": ObjectId(pid)},
        {"$set": {"planta_url": planta_url, "largura_px": width, "altura_px": height}},
    )
    doc = await db.pavimentos.find_one({"_id": ObjectId(pid)})
    return _pav_out(doc)


@router.get("/plantas/{fname}")
async def get_planta(fname: str):
    # Sanitize filename
    if "/" in fname or ".." in fname:
        raise HTTPException(400, "Nome inválido")
    path = UPLOAD_DIR / fname
    if not path.exists():
        raise HTTPException(404, "Planta não encontrada")
    return FileResponse(path)


# ============ Controladoras ============
@router.get("/controladoras")
async def list_controladoras(_: dict = Depends(get_current_user)):
    out = []
    async for c in db.lighting_controllers.find({}).sort("nome", 1):
        out.append(_ctrl_out(c))
    return out


@router.get("/controladoras/descobertas")
async def descobrir_controladoras(_: dict = Depends(require_admin)):
    """IDs vistos no MQTT publicando Lnn mas ainda não cadastrados."""
    cadastradas = set()
    async for c in db.lighting_controllers.find({}, {"mqtt_id": 1}):
        cadastradas.add(c["mqtt_id"])
    novas = []
    for mid in sorted(lighting_svc.lighting_ids - cadastradas):
        state = lighting_svc.controllers.get(mid, {})
        novas.append({
            "mqtt_id": mid,
            "online": state.get("online", False),
            "rede": state.get("rede"),
            "ultimo_contato": state.get("ultimo_contato"),
        })
    return novas


@router.post("/controladoras")
async def create_controladora(req: ControladoraCreate, _: dict = Depends(require_admin)):
    mid = req.mqtt_id.strip().upper()
    if not MQTT_ID_RE.match(mid):
        raise HTTPException(400, "mqtt_id deve ter 4 caracteres alfanuméricos maiúsculos (ex.: A1F3 ou TEST)")
    existing = await db.lighting_controllers.find_one({"mqtt_id": mid})
    if existing:
        raise HTTPException(400, "Já existe uma controladora com este mqtt_id")
    doc = {
        "mqtt_id": mid,
        "nome": req.nome,
        "local": req.local,
        "circuitos": {str(i): f"L{i:02d}" for i in range(1, 17)},
        "created_at": now_iso(),
    }
    r = await db.lighting_controllers.insert_one(doc)
    doc["_id"] = r.inserted_id
    lighting_svc.lighting_ids.add(mid)
    return _ctrl_out(doc)


@router.patch("/controladoras/{cid}")
async def update_controladora(cid: str, req: ControladoraUpdate, _: dict = Depends(require_admin)):
    update = {k: v for k, v in req.dict(exclude_unset=True).items() if v is not None}
    if update:
        r = await db.lighting_controllers.update_one({"_id": ObjectId(cid)}, {"$set": update})
        if r.matched_count == 0:
            raise HTTPException(404, "Controladora não encontrada")
    doc = await db.lighting_controllers.find_one({"_id": ObjectId(cid)})
    return _ctrl_out(doc)


@router.patch("/controladoras/{cid}/circuitos")
async def rename_circuito(cid: str, req: CircuitoRename, _: dict = Depends(require_admin)):
    r = await db.lighting_controllers.update_one(
        {"_id": ObjectId(cid)},
        {"$set": {f"circuitos.{req.numero}": req.nome_circuito}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Controladora não encontrada")
    doc = await db.lighting_controllers.find_one({"_id": ObjectId(cid)})
    return _ctrl_out(doc)


@router.delete("/controladoras/{cid}")
async def delete_controladora(cid: str, _: dict = Depends(require_admin)):
    pontos = []
    async for p in db.lighting_points.find({"controladora_id": cid}):
        pontos.append({"id": str(p["_id"]), "nome": p["nome"], "circuito": p["circuito"]})
    if pontos:
        raise HTTPException(400, {"msg": f"{len(pontos)} ponto(s) vinculados.", "pontos": pontos})
    r = await db.lighting_controllers.delete_one({"_id": ObjectId(cid)})
    if r.deleted_count == 0:
        raise HTTPException(404, "Controladora não encontrada")
    return {"ok": True}


# ============ Pontos ============
@router.get("/pontos")
async def list_pontos(pavimento_id: Optional[str] = None, _: dict = Depends(get_current_user)):
    q = {"pavimento_id": pavimento_id} if pavimento_id else {}
    out = []
    async for p in db.lighting_points.find(q).sort("nome", 1):
        out.append(_ponto_out(p))
    return out


@router.post("/pontos")
async def create_ponto(req: PontoCreate, _: dict = Depends(require_admin)):
    # Validate FKs
    pav = await db.pavimentos.find_one({"_id": ObjectId(req.pavimento_id)})
    if not pav:
        raise HTTPException(400, "Pavimento inválido")
    ctrl = await db.lighting_controllers.find_one({"_id": ObjectId(req.controladora_id)})
    if not ctrl:
        raise HTTPException(400, "Controladora inválida")
    doc = {
        "pavimento_id": req.pavimento_id,
        "controladora_id": req.controladora_id,
        "circuito": req.circuito,
        "nome": req.nome,
        "tipo": req.tipo,
        "x": req.x,
        "y": req.y,
        "created_at": now_iso(),
    }
    r = await db.lighting_points.insert_one(doc)
    doc["_id"] = r.inserted_id
    return _ponto_out(doc)


@router.patch("/pontos/{pid}")
async def update_ponto(pid: str, req: PontoUpdate, _: dict = Depends(require_admin)):
    update = {k: v for k, v in req.dict(exclude_unset=True).items() if v is not None}
    if update:
        r = await db.lighting_points.update_one({"_id": ObjectId(pid)}, {"$set": update})
        if r.matched_count == 0:
            raise HTTPException(404, "Ponto não encontrado")
    doc = await db.lighting_points.find_one({"_id": ObjectId(pid)})
    return _ponto_out(doc)


@router.delete("/pontos/{pid}")
async def delete_ponto(pid: str, _: dict = Depends(require_admin)):
    r = await db.lighting_points.delete_one({"_id": ObjectId(pid)})
    if r.deleted_count == 0:
        raise HTTPException(404, "Ponto não encontrado")
    return {"ok": True}


# ============ Comandos ============
@router.post("/controladoras/{cid}/circuitos/{numero}/comando")
async def cmd_circuito(cid: str, numero: int, req: CircuitCommand, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(403, "Viewer não pode enviar comandos")
    if numero < 1 or numero > 16:
        raise HTTPException(400, "Circuito deve estar entre 1 e 16")
    ctrl = await db.lighting_controllers.find_one({"_id": ObjectId(cid)})
    if not ctrl:
        raise HTTPException(404, "Controladora não encontrada")
    try:
        return await lighting_svc.send_circuit_command(ctrl["mqtt_id"], numero, req.value, user["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/controladoras/{cid}/circuitos/{numero}/modo")
async def cmd_modo(cid: str, numero: int, req: ModeCommand, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(403, "Viewer não pode enviar comandos")
    ctrl = await db.lighting_controllers.find_one({"_id": ObjectId(cid)})
    if not ctrl:
        raise HTTPException(404, "Controladora não encontrada")
    try:
        return await lighting_svc.send_mode_command(ctrl["mqtt_id"], numero, req.mode, user["id"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/controladoras/{cid}/todos")
async def cmd_todos(cid: str, on: bool, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(403, "Viewer não pode enviar comandos")
    ctrl = await db.lighting_controllers.find_one({"_id": ObjectId(cid)})
    if not ctrl:
        raise HTTPException(404, "Controladora não encontrada")
    return await lighting_svc.send_all_command(ctrl["mqtt_id"], on, user["id"])


@router.post("/pavimentos/{pid}/todos")
async def cmd_pavimento_todos(pid: str, on: bool, user: dict = Depends(get_current_user)):
    """Liga/desliga todos os circuitos usados por pontos deste pavimento."""
    if user["role"] == "viewer":
        raise HTTPException(403, "Viewer não pode enviar comandos")
    # Collect unique (controladora_mqtt_id, circuito) pairs
    pairs = set()
    async for p in db.lighting_points.find({"pavimento_id": pid}):
        ctrl = await db.lighting_controllers.find_one({"_id": ObjectId(p["controladora_id"])})
        if ctrl:
            pairs.add((ctrl["mqtt_id"], p["circuito"]))
    sent = []
    skipped = []
    for mid, circ in sorted(pairs):
        try:
            await lighting_svc.send_circuit_command(mid, circ, "true" if on else "false", user["id"])
            sent.append({"mqtt_id": mid, "circuito": circ})
        except Exception as e:
            skipped.append({"mqtt_id": mid, "circuito": circ, "reason": str(e)})
    return {"sent": sent, "skipped": skipped}


# ============ Overview + Eventos ============
@router.get("/overview")
async def overview(_: dict = Depends(get_current_user)):
    """Resumo por pavimento + totais."""
    pavs = []
    async for p in db.pavimentos.find({}).sort([("ordem", 1), ("nome", 1)]):
        pavs.append(_pav_out(p))

    all_ctrls = {}
    async for c in db.lighting_controllers.find({}):
        all_ctrls[str(c["_id"])] = c

    # pontos per pavimento
    by_pav = {}
    async for p in db.lighting_points.find({}):
        by_pav.setdefault(p["pavimento_id"], []).append(p)

    out_pavs = []
    total_on = 0
    for pav in pavs:
        pontos = by_pav.get(pav["id"], [])
        acesos = 0
        offline_ctrl = False
        for pt in pontos:
            ctrl = all_ctrls.get(pt["controladora_id"])
            if not ctrl:
                continue
            state = lighting_svc.controllers.get(ctrl["mqtt_id"], {})
            if not state.get("online"):
                offline_ctrl = True
                continue
            circ_state = state.get("circuitos", {}).get(pt["circuito"], {})
            if circ_state.get("estado") is True:
                acesos += 1
        total_on += acesos
        out_pavs.append({**pav, "pontos_total": len(pontos), "pontos_acesos": acesos, "offline": offline_ctrl})

    ctrls_total = len(all_ctrls)
    ctrls_online = sum(
        1 for c in all_ctrls.values()
        if lighting_svc.controllers.get(c["mqtt_id"], {}).get("online")
    )
    return {
        "pavimentos": out_pavs,
        "controladoras_total": ctrls_total,
        "controladoras_online": ctrls_online,
        "circuitos_ligados": total_on,
    }


@router.get("/snapshot")
async def snapshot(_: dict = Depends(get_current_user)):
    """Estado em memória de todas as controladoras de iluminação (para popular ao abrir)."""
    return lighting_svc.snapshot()


@router.get("/eventos")
async def list_eventos(
    mqtt_id: Optional[str] = None,
    circuito: Optional[int] = None,
    limit: int = 100,
    _: dict = Depends(get_current_user),
):
    q = {}
    if mqtt_id:
        q["mqtt_id"] = mqtt_id
    if circuito is not None:
        q["circuito"] = circuito
    out = []
    async for e in db.lighting_events.find(q).sort("timestamp", -1).limit(min(limit, 500)):
        e["id"] = str(e.pop("_id"))
        out.append(e)
    return out
