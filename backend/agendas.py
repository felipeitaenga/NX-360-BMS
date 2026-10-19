"""Programação horária por AGENDAS (v1.13).

Uma agenda é uma lista de PERÍODOS de funcionamento:
    {"dias": [1,2,3,4,5], "liga": "07:00", "desliga": "20:00" | None, "setpoint": 23.0 | None}
Dias: 0=Dom .. 6=Sáb (mesmo padrão do firmware).

Cada fancoil escolhe (campo fancoils.agenda):
    {"modo": "agenda", "agenda_id": "<id>"}          segue uma agenda (ex.: Geral do prédio)
    {"modo": "individual", "periodos": [...]}         agenda só dele
    {"modo": "nenhuma"}                               sem agenda (controle manual)

O backend gera os eventos da controladora (SCHEDULE/SET, mesmo contrato do firmware):
    liga     → [SETPOINT valor] + CMD true
    desliga  → ESTADO true (volta para AUTOMÁTICO) + CMD false
Eventos iguais (hora, ação, valor) de períodos diferentes são unidos (dias somados).
No mesmo minuto a controladora executa na ordem do payload: ESTADO/SETPOINT antes de CMD.
"""
from __future__ import annotations
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin, can_access_fancoil, allowed_fancoil_ids
from db import db

logger = logging.getLogger("agendas")
router = APIRouter(prefix="/api")

MAX_EVENTOS = 10  # limite de slots do firmware FC300
HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
DIAS_NOME = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------- Modelos ----------------
class Periodo(BaseModel):
    dias: List[int]
    liga: str
    desliga: Optional[str] = None
    setpoint: Optional[float] = None


class AgendaIn(BaseModel):
    nome: str
    periodos: List[Periodo] = []


class AgendaUpd(BaseModel):
    nome: Optional[str] = None
    periodos: Optional[List[Periodo]] = None


class AtribuirReq(BaseModel):
    fancoil_ids: List[str]
    modo: str  # agenda | individual | nenhuma
    agenda_id: Optional[str] = None
    periodos: Optional[List[Periodo]] = None


class PreviewReq(BaseModel):
    periodos: List[Periodo] = []


class PublicarReq(BaseModel):
    fancoil_ids: Optional[List[str]] = None


# ---------------- Regras ----------------
def _min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def normalizar(periodos: list) -> list:
    """Valida e normaliza. Lança HTTPException(400) com mensagem em português."""
    out = []
    for i, p in enumerate(periodos, 1):
        p = p.dict() if isinstance(p, BaseModel) else dict(p)
        dias = sorted(set(int(d) for d in p.get("dias") or []))
        if not dias or any(d < 0 or d > 6 for d in dias):
            raise HTTPException(400, f"Período {i}: escolha pelo menos um dia")
        liga = (p.get("liga") or "").strip()
        desliga = (p.get("desliga") or "").strip() or None
        if not HHMM.match(liga):
            raise HTTPException(400, f"Período {i}: horário de ligar inválido (use HH:MM)")
        if desliga is not None:
            if not HHMM.match(desliga):
                raise HTTPException(400, f"Período {i}: horário de desligar inválido (use HH:MM)")
            if _min(desliga) <= _min(liga):
                raise HTTPException(400, f"Período {i}: o desligamento precisa ser depois de ligar "
                                         f"(para virar a noite, crie dois períodos)")
        sp = p.get("setpoint")
        if sp is not None:
            sp = round(float(sp), 1)
            if not 10.0 <= sp <= 35.0:
                raise HTTPException(400, f"Período {i}: setpoint deve estar entre 10 e 35 °C")
        out.append({"dias": dias, "liga": liga, "desliga": desliga, "setpoint": sp})
    # Sobreposição no mesmo dia
    for d in range(7):
        faixas = sorted((_min(p["liga"]), _min(p["desliga"]) if p["desliga"] else 1440, idx)
                        for idx, p in enumerate(out, 1) if d in p["dias"])
        for (a1, b1, i1), (a2, b2, i2) in zip(faixas, faixas[1:]):
            if a2 < b1:
                raise HTTPException(400, f"Períodos {i1} e {i2} se sobrepõem na {DIAS_NOME[d]}")
    out.sort(key=lambda p: (_min(p["liga"]), p["dias"]))
    return out


def gerar_eventos(periodos: list) -> list:
    """Períodos normalizados → eventos {hora, dias, acao, valor} ordenados para o firmware."""
    acc: dict = {}
    ordem = {"ESTADO": 0, "SETPOINT": 1, "CMD": 2}

    def add(hora, dias, acao, valor):
        k = (hora, acao, valor)
        acc.setdefault(k, set()).update(dias)

    for p in periodos:
        if p["setpoint"] is not None:
            add(p["liga"], p["dias"], "SETPOINT", f"{p['setpoint']:.1f}")
        add(p["liga"], p["dias"], "CMD", "true")
        if p["desliga"]:
            add(p["desliga"], p["dias"], "ESTADO", "true")
            add(p["desliga"], p["dias"], "CMD", "false")
    evs = [{"hora": h, "dias": sorted(d), "acao": a, "valor": v} for (h, a, v), d in acc.items()]
    evs.sort(key=lambda e: (_min(e["hora"]), ordem[e["acao"]], e["dias"]))
    return evs


def payload_firmware(eventos: list) -> str:
    linhas = []
    for i, e in enumerate(eventos):
        dias = "*" if len(e["dias"]) == 7 else ",".join(str(d) for d in e["dias"])
        linhas.append(f"{i};{e['hora']};{dias};{e['acao']};{e['valor']};1")
    return "\n".join(linhas)


def checar_limite(eventos: list):
    if len(eventos) > MAX_EVENTOS:
        raise HTTPException(400, f"Esta agenda gera {len(eventos)} eventos na controladora "
                                 f"(máximo {MAX_EVENTOS}). Junte dias com o mesmo horário ou remova um período.")


def resumo_dia(periodos: list, dia: int) -> str:
    fx = [f"{p['liga']}–{p['desliga'] or '24h'}" for p in periodos if dia in p["dias"]]
    return ", ".join(fx) if fx else "desligado"


# ---------------- Persistência ----------------
async def agenda_padrao() -> Optional[dict]:
    return await db.agendas.find_one({"padrao": True})


async def periodos_efetivos(fc: dict) -> tuple[list, str, Optional[str]]:
    """(períodos, modo, nome_da_agenda) do fancoil."""
    cfg = fc.get("agenda") or {"modo": "nenhuma"}
    modo = cfg.get("modo", "nenhuma")
    if modo == "agenda":
        ag = None
        if cfg.get("agenda_id") and ObjectId.is_valid(cfg["agenda_id"]):
            ag = await db.agendas.find_one({"_id": ObjectId(cfg["agenda_id"])})
        ag = ag or await agenda_padrao()
        return (ag or {}).get("periodos", []), "agenda", (ag or {}).get("nome")
    if modo == "individual":
        return cfg.get("periodos", []), "individual", None
    return [], "nenhuma", None


async def payload_do_fancoil(fc: dict) -> tuple[str, int]:
    periodos, _, _ = await periodos_efetivos(fc)
    evs = gerar_eventos(periodos)
    return payload_firmware(evs[:MAX_EVENTOS]), len(evs)


async def publicar(fc: dict):
    from mqtt_service import svc
    await svc.publish_schedule_config(fc["device_id"])


def _agenda_out(a: dict, n_fc: int = 0) -> dict:
    evs = gerar_eventos(a.get("periodos", []))
    return {"id": str(a["_id"]), "nome": a["nome"], "padrao": bool(a.get("padrao")),
            "periodos": a.get("periodos", []), "n_eventos": len(evs), "n_fancoils": n_fc,
            "atualizado_em": a.get("atualizado_em")}


# ---------------- Migração (uma vez) ----------------
def _converter_antigo(schedules: list) -> list:
    """Agendamentos antigos (eventos soltos) → períodos. Duplicados somem; ESTADO é descartado."""
    por_dia = {d: {"on": set(), "off": set(), "sp": {}} for d in range(7)}
    for s in schedules:
        if not s.get("enabled", True):
            continue
        dias = s.get("days") or list(range(7))
        hhmm = f"{int(s.get('hour', 0)):02d}:{int(s.get('minute', 0)):02d}"
        acao, val = s.get("action"), str(s.get("value", "")).strip().lower()
        for d in dias:
            if acao == "cmd":
                por_dia[d]["on" if val in ("true", "1", "on") else "off"].add(hhmm)
            elif acao == "setpoint":
                try:
                    por_dia[d]["sp"][hhmm] = round(float(val), 1)
                except ValueError:
                    pass
    grupos: dict = {}
    for d, x in por_dia.items():
        ons, offs = sorted(x["on"], key=_min), sorted(x["off"], key=_min)
        pares, usados = [], set()
        for on in ons:
            if pares and pares[-1][1] is None:
                continue  # dois "liga" seguidos sem desligar: mantém o primeiro
            prox = next((f for f in offs if _min(f) > _min(on) and f not in usados), None)
            if prox:
                usados.add(prox)
            pares.append((on, prox))
        for on, off in pares:
            sp = x["sp"].get(on)
            grupos.setdefault((on, off, sp), []).append(d)
    periodos = [{"dias": sorted(ds), "liga": on, "desliga": off, "setpoint": sp}
                for (on, off, sp), ds in grupos.items()]
    try:
        return normalizar(periodos)
    except HTTPException:
        return []


async def migrar_agendas():
    if await db.agendas.count_documents({}) > 0:
        return
    logger.info("Migrando agendamentos antigos para o modelo de agendas…")
    individuais = {}
    async for fc in db.fancoils.find({}):
        fid = str(fc["_id"])
        olds = await db.schedules.find({"fancoil_id": fid}).to_list(None)
        individuais[fid] = _converter_antigo(olds)
    # A programação mais comum vira a "Geral do prédio"
    chave = lambda ps: repr(ps)  # noqa: E731
    comuns = Counter(chave(ps) for ps in individuais.values() if ps)
    geral_periodos = []
    if comuns:
        k, _ = comuns.most_common(1)[0]
        geral_periodos = next(ps for ps in individuais.values() if chave(ps) == k)
    res = await db.agendas.insert_one({"nome": "Geral do prédio", "padrao": True, "periodos": geral_periodos,
                                       "criado_em": now_iso(), "atualizado_em": now_iso()})
    gid = str(res.inserted_id)
    for fid, ps in individuais.items():
        if not ps:
            cfg = {"modo": "nenhuma"}
        elif geral_periodos and chave(ps) == chave(geral_periodos):
            cfg = {"modo": "agenda", "agenda_id": gid}
        else:
            cfg = {"modo": "individual", "periodos": ps}
        await db.fancoils.update_one({"_id": ObjectId(fid)}, {"$set": {"agenda": cfg}})
    logger.info("Agendas migradas: %d fancoils (geral com %d período(s))", len(individuais), len(geral_periodos))


# ---------------- Rotas: agendas ----------------
@router.get("/agendas")
async def listar_agendas(user: dict = Depends(get_current_user)):
    cont = Counter()
    padrao = await agenda_padrao()
    async for fc in db.fancoils.find({}, {"agenda": 1}):
        cfg = fc.get("agenda") or {}
        if cfg.get("modo") == "agenda":
            cont[cfg.get("agenda_id") or (str(padrao["_id"]) if padrao else "")] += 1
    out = [_agenda_out(a, cont.get(str(a["_id"]), 0)) async for a in db.agendas.find({})]
    out.sort(key=lambda a: (not a["padrao"], a["nome"].lower()))
    return out


@router.post("/agendas")
async def criar_agenda(req: AgendaIn, _: dict = Depends(require_admin)):
    nome = req.nome.strip()
    if not nome:
        raise HTTPException(400, "Informe o nome da agenda")
    if await db.agendas.find_one({"nome": nome}):
        raise HTTPException(409, "Já existe uma agenda com esse nome")
    ps = normalizar(req.periodos)
    checar_limite(gerar_eventos(ps))
    padrao = await db.agendas.count_documents({}) == 0
    doc = {"nome": nome, "padrao": padrao, "periodos": ps, "criado_em": now_iso(), "atualizado_em": now_iso()}
    res = await db.agendas.insert_one(doc)
    doc["_id"] = res.inserted_id
    return _agenda_out(doc)


async def _seguidores(agenda: dict) -> list:
    aid = str(agenda["_id"])
    q = {"agenda.modo": "agenda", "$or": [{"agenda.agenda_id": aid}]}
    if agenda.get("padrao"):
        q["$or"] += [{"agenda.agenda_id": None}, {"agenda.agenda_id": {"$exists": False}}]
    return await db.fancoils.find(q).to_list(None)


@router.put("/agendas/{aid}")
async def editar_agenda(aid: str, req: AgendaUpd, _: dict = Depends(require_admin)):
    a = await db.agendas.find_one({"_id": ObjectId(aid)}) if ObjectId.is_valid(aid) else None
    if not a:
        raise HTTPException(404, "Agenda não encontrada")
    upd = {"atualizado_em": now_iso()}
    if req.nome is not None:
        nome = req.nome.strip()
        if not nome:
            raise HTTPException(400, "Informe o nome da agenda")
        if await db.agendas.find_one({"nome": nome, "_id": {"$ne": a["_id"]}}):
            raise HTTPException(409, "Já existe uma agenda com esse nome")
        upd["nome"] = nome
    if req.periodos is not None:
        ps = normalizar(req.periodos)
        checar_limite(gerar_eventos(ps))
        upd["periodos"] = ps
    await db.agendas.update_one({"_id": a["_id"]}, {"$set": upd})
    a = await db.agendas.find_one({"_id": a["_id"]})
    segs = await _seguidores(a)
    if req.periodos is not None:
        for fc in segs:
            await publicar(fc)
    return {**_agenda_out(a, len(segs)), "publicados": len(segs) if req.periodos is not None else 0}


@router.post("/agendas/{aid}/padrao")
async def tornar_padrao(aid: str, _: dict = Depends(require_admin)):
    a = await db.agendas.find_one({"_id": ObjectId(aid)}) if ObjectId.is_valid(aid) else None
    if not a:
        raise HTTPException(404, "Agenda não encontrada")
    await db.agendas.update_many({}, {"$set": {"padrao": False}})
    await db.agendas.update_one({"_id": a["_id"]}, {"$set": {"padrao": True}})
    return {"ok": True}


@router.delete("/agendas/{aid}")
async def excluir_agenda(aid: str, _: dict = Depends(require_admin)):
    a = await db.agendas.find_one({"_id": ObjectId(aid)}) if ObjectId.is_valid(aid) else None
    if not a:
        raise HTTPException(404, "Agenda não encontrada")
    if a.get("padrao"):
        raise HTTPException(400, "A agenda padrão não pode ser excluída — defina outra como padrão antes")
    segs = await _seguidores(a)
    if segs:
        raise HTTPException(400, f"{len(segs)} fancoil(s) seguem esta agenda — mude-os antes de excluir")
    await db.agendas.delete_one({"_id": a["_id"]})
    return {"ok": True}


@router.post("/agendas/preview")
async def preview(req: PreviewReq, _: dict = Depends(get_current_user)):
    try:
        ps = normalizar(req.periodos)
    except HTTPException as e:
        return {"ok": False, "erro": e.detail, "n_eventos": None, "eventos": []}
    evs = gerar_eventos(ps)
    erro = None if len(evs) <= MAX_EVENTOS else (
        f"Gera {len(evs)} eventos na controladora (máximo {MAX_EVENTOS}). "
        "Junte dias com o mesmo horário ou remova um período.")
    return {"ok": erro is None, "erro": erro, "n_eventos": len(evs), "eventos": evs, "periodos": ps}


# ---------------- Rotas: fancoils ----------------
@router.get("/programacao/fancoils")
async def fancoils_e_agendas(user: dict = Depends(get_current_user)):
    from mqtt_service import svc
    allowed = await allowed_fancoil_ids(user)
    # dia da semana em Brasília (UTC-3); Python seg=0 → firmware dom=0
    agora_br = datetime.now(timezone.utc).timestamp() - 3 * 3600
    hoje = (datetime.fromtimestamp(agora_br, timezone.utc).weekday() + 1) % 7
    out = []
    async for fc in db.fancoils.find({}):
        fid = str(fc["_id"])
        if allowed is not None and fid not in allowed:
            continue
        ps, modo, nome = await periodos_efetivos(fc)
        cfg = fc.get("agenda") or {"modo": "nenhuma"}
        st = svc.states.get(fc["device_id"])
        payload, n = await payload_do_fancoil(fc)
        enviado = st.schedule_sent_payload if st else None
        aplicado = st.schedule_applied_payload if st else None
        norm = st._norm_schedule if st else (lambda x: set())
        if aplicado is not None and norm(aplicado) == norm(payload):
            sync = "ok"
        elif enviado is not None and norm(enviado) == norm(payload):
            sync = "pendente"
        else:
            sync = "nao_publicada"
        out.append({
            "id": fid, "name": fc.get("name"), "device_id": fc.get("device_id"),
            "floor": fc.get("floor"), "side": fc.get("side"), "active": fc.get("active", True),
            "modo": modo, "agenda_id": cfg.get("agenda_id") if modo == "agenda" else None,
            "agenda_nome": nome, "periodos": ps, "n_eventos": n,
            "hoje": resumo_dia(ps, hoje) if modo != "nenhuma" else None,
            "online": bool(st and st.online), "sync": sync,
        })
    out.sort(key=lambda x: (-(x["floor"] or 0), x["side"] or 0, x["name"] or ""))
    return out


@router.put("/programacao/fancoils")
async def atribuir(req: AtribuirReq, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(403, "Visualizador não pode alterar a programação")
    if req.modo not in ("agenda", "individual", "nenhuma"):
        raise HTTPException(400, "Modo inválido")
    if not req.fancoil_ids:
        raise HTTPException(400, "Selecione pelo menos um fancoil")
    agenda_id = None
    if req.modo == "agenda":
        ag = await db.agendas.find_one({"_id": ObjectId(req.agenda_id)}) if req.agenda_id and ObjectId.is_valid(req.agenda_id) else None
        if not ag:
            raise HTTPException(400, "Escolha uma agenda")
        agenda_id = str(ag["_id"])
    ps_novos = None
    if req.modo == "individual" and req.periodos is not None:
        ps_novos = normalizar(req.periodos)
        checar_limite(gerar_eventos(ps_novos))
    feitos = []
    for fid in req.fancoil_ids:
        if not ObjectId.is_valid(fid) or not await can_access_fancoil(user, fid):
            raise HTTPException(403, "Sem permissão em um dos fancoils selecionados")
        fc = await db.fancoils.find_one({"_id": ObjectId(fid)})
        if not fc:
            continue
        if req.modo == "agenda":
            cfg = {"modo": "agenda", "agenda_id": agenda_id}
        elif req.modo == "individual":
            ps = ps_novos if ps_novos is not None else (await periodos_efetivos(fc))[0]
            cfg = {"modo": "individual", "periodos": ps}
        else:
            cfg = {"modo": "nenhuma"}
        await db.fancoils.update_one({"_id": fc["_id"]}, {"$set": {"agenda": cfg}})
        fc["agenda"] = cfg
        await publicar(fc)
        feitos.append(fc.get("name"))
    await db.command_log.insert_one({"user_id": user.get("email"), "kind": "AGENDA", "value": req.modo,
                                     "fancoils": feitos, "timestamp": now_iso(), "confirmed": True})
    return {"atualizados": len(feitos)}


@router.post("/programacao/publicar")
async def republicar(req: PublicarReq, user: dict = Depends(get_current_user)):
    if user["role"] == "viewer":
        raise HTTPException(403, "Visualizador não pode publicar")
    allowed = await allowed_fancoil_ids(user)
    n = 0
    async for fc in db.fancoils.find({}):
        fid = str(fc["_id"])
        if req.fancoil_ids is not None and fid not in req.fancoil_ids:
            continue
        if allowed is not None and fid not in allowed:
            continue
        await publicar(fc)
        n += 1
    return {"publicados": n}
