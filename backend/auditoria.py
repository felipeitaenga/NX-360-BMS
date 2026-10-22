"""Trilha de auditoria + LGPD (v1.18).

Auditoria
  Middleware ASGI grava em `audit_log` toda requisição que ALTERA algo (POST/PUT/PATCH/DELETE em /api),
  com quem fez (id, nome e e-mail no momento), o quê (categoria + descrição em português), alvo, resultado
  (HTTP status) e IP. O corpo da requisição é guardado só como resumo, sem campos sensíveis
  (senha, token, segredo, hash, chave) e sem uploads de arquivo.

LGPD (Lei 13.709/2018)
  Dados pessoais tratados nos registros: nome, e-mail e IP de usuários do sistema.
  Finalidade: segurança da informação e rastreabilidade da operação predial
  (art. 7º, II — obrigação legal/regulatória; IX — legítimo interesse; art. 37 — registro das operações).
  Minimização: e-mail e IP só aparecem para administradores; demais perfis veem só o nome.
  Retenção: expurgo automático diário (padrão 180 dias para acessos — mínimo do Marco Civil, art. 15 —
  e 365 dias para auditoria e comandos), configurável pelo administrador.
  Exportações de relatório também ficam registradas (quem exportou, quando, qual relatório).
"""
from __future__ import annotations
import asyncio
import csv
import io
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import get_current_user, require_admin, _secret, JWT_ALGORITHM
from db import db

logger = logging.getLogger("auditoria")
router = APIRouter(prefix="/api")

LGPD_PADRAO = {"retencao_acessos_dias": 180, "retencao_auditoria_dias": 365, "retencao_comandos_dias": 365}
SENSIVEIS = ("password", "senha", "token", "secret", "segredo", "hash", "chave", "key", "pin", "credencial")
IGNORAR = re.compile(r"^/api/(auth/(login|logout|forgot-password|reset-password)|forgot-password|reset-password|"
                     r"agendas/preview|admin/broker/test|health)$")

# (método, regex do caminho sem /api, categoria, descrição) — primeira que casar
ROTAS = [
    ("POST", r"/fancoils/bulk-command", "Fancoils", "Comando em lote"),
    ("POST", r"/fancoils/import", "Fancoils", "Importou fancoils"),
    ("POST", r"/fancoils/(?P<fc>[^/]+)/command", "Fancoils", "Comando no fancoil"),
    ("POST", r"/fancoils", "Fancoils", "Cadastrou fancoil"),
    ("PATCH", r"/fancoils/(?P<fc>[^/]+)", "Fancoils", "Editou fancoil"),
    ("DELETE", r"/fancoils/(?P<fc>[^/]+)", "Fancoils", "Excluiu fancoil"),
    ("POST", r"/devices/(?P<fc>[^/]+)/pid", "Fancoils", "Alterou PID"),
    ("POST", r"/cag/comando", "CAG", "Comando em equipamento"),
    ("POST", r"/cag/central", "CAG", "Comando da central"),
    ("POST", r"/cag/setpoint", "CAG", "Alterou setpoint"),
    ("POST", r"/cag/sequencia/rearmar", "CAG", "Rearmou linha do chiller"),
    ("PUT", r"/cag/programacao", "CAG", "Alterou programação horária"),
    ("PUT", r"/cag/simulacao", "CAG", "Ligou/desligou simulação"),
    ("POST", r"/cag/simular-falha", "CAG", "Simulou falha"),
    ("POST", r"/hidraulica/comando", "Hidráulica", "Comando em bomba"),
    ("POST", r"/hidraulica/modo", "Hidráulica", "Alterou modo do sistema"),
    ("PUT", r"/hidraulica/simulacao", "Hidráulica", "Ligou/desligou simulação"),
    ("POST", r"/hidraulica/simular-falha", "Hidráulica", "Simulou falha"),
    ("POST", r"/agendas/(?P<ag>[^/]+)/padrao", "Programação", "Definiu agenda padrão"),
    ("POST", r"/agendas", "Programação", "Criou agenda"),
    ("PUT", r"/agendas/(?P<ag>[^/]+)", "Programação", "Editou agenda"),
    ("DELETE", r"/agendas/(?P<ag>[^/]+)", "Programação", "Excluiu agenda"),
    ("PUT", r"/programacao/fancoils", "Programação", "Atribuiu programação a fancoils"),
    ("POST", r"/programacao/publicar", "Programação", "Republicou programação"),
    ("POST", r"/lighting/controladoras/[^/]+/circuitos/[^/]+/comando", "Iluminação", "Comando em circuito"),
    ("POST", r"/lighting/controladoras/[^/]+/circuitos/[^/]+/modo", "Iluminação", "Alterou modo do circuito"),
    ("POST", r"/lighting/(controladoras|pavimentos)/[^/]+/todos", "Iluminação", "Comando geral"),
    ("POST", r"/lighting/pavimentos/[^/]+/planta", "Iluminação", "Enviou planta do pavimento"),
    ("POST", r"/lighting/(?P<tipo>controladoras|pavimentos|pontos)", "Iluminação", "Cadastrou"),
    ("PATCH", r"/lighting/(?P<tipo>controladoras|pavimentos|pontos)/.+", "Iluminação", "Editou"),
    ("DELETE", r"/lighting/(?P<tipo>controladoras|pavimentos|pontos)/.+", "Iluminação", "Excluiu"),
    ("POST", r"/users/reset-password", "Usuários", "Redefiniu senha de usuário"),
    ("POST", r"/users", "Usuários", "Criou usuário"),
    ("PATCH", r"/users/(?P<us>[^/]+)", "Usuários", "Editou usuário"),
    ("DELETE", r"/users/(?P<us>[^/]+)", "Usuários", "Excluiu usuário"),
    ("PUT", r"/permissions", "Usuários", "Alterou permissões"),
    ("POST", r"/auth/change-password", "Usuários", "Trocou a própria senha"),
    ("PUT", r"/admin/settings", "Sistema", "Alterou parâmetros do sistema"),
    ("POST", r"/admin/restore", "Sistema", "Restaurou backup"),
    ("PUT", r"/lgpd", "Sistema", "Alterou retenção de dados (LGPD)"),
    ("POST", r"/lgpd/expurgar", "Sistema", "Executou expurgo de registros (LGPD)"),
    ("POST|PATCH|DELETE", r"/admin/topic-mappings.*", "Sistema", "Alterou mapeamento de tópicos"),
    ("POST|PUT", r"/admin/controller-models.*", "Sistema", "Alterou modelo de controladora"),
    ("POST", r"/admin/firmware/lote/cancelar", "Firmware", "Cancelou atualização em lote"),
    ("POST", r"/admin/firmware/[^/]+/enviar", "Firmware", "Enviou atualização OTA"),
    ("POST", r"/admin/firmware", "Firmware", "Enviou arquivo de firmware"),
    ("DELETE", r"/admin/firmware/[^/]+", "Firmware", "Excluiu firmware"),
    ("POST", r"/alarms/ack-todos", "Alarmes", "Reconheceu todos os alarmes"),
    ("POST", r"/alarms/ack", "Alarmes", "Reconheceu alarme"),
]
_ROTAS = [(set(m.split("|")), re.compile(f"^{p}$"), c, d) for m, p, c, d in ROTAS]
CATEGORIAS = ["Fancoils", "CAG", "Hidráulica", "Iluminação", "Programação", "Usuários", "Sistema", "Firmware", "Alarmes", "Outros"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ip_da_requisicao(headers: dict, client) -> Optional[str]:
    xff = headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return headers.get("x-real-ip") or (client[0] if client else None)


def sanitizar(obj, prof: int = 0):
    """Remove campos sensíveis (recursivo) e encurta listas/strings longas."""
    if prof > 4:
        return "…"
    if isinstance(obj, dict):
        return {k: sanitizar(v, prof + 1) for k, v in obj.items()
                if not any(s in k.lower() for s in SENSIVEIS)}
    if isinstance(obj, list):
        r = [sanitizar(v, prof + 1) for v in obj[:10]]
        return r + [f"+{len(obj) - 10}"] if len(obj) > 10 else r
    if isinstance(obj, str) and len(obj) > 80:
        return obj[:80] + "…"
    return obj


def classificar(metodo: str, caminho: str) -> tuple[str, str, dict]:
    sub = caminho[4:] if caminho.startswith("/api") else caminho
    for metodos, rx, cat, desc in _ROTAS:
        if metodo in metodos:
            m = rx.match(sub)
            if m:
                return cat, desc, {k: v for k, v in m.groupdict().items() if v}
    return "Outros", f"{metodo} {sub}", {}


async def _nome_alvo(ids: dict) -> Optional[str]:
    try:
        if "fc" in ids:
            q = {"_id": ObjectId(ids["fc"])} if ObjectId.is_valid(ids["fc"]) else {"device_id": ids["fc"]}
            f = await db.fancoils.find_one(q, {"name": 1})
            return f["name"] if f else ids["fc"]
        if "us" in ids and ObjectId.is_valid(ids["us"]):
            u = await db.users.find_one({"_id": ObjectId(ids["us"])}, {"name": 1, "email": 1})
            return (u.get("name") or u.get("email")) if u else ids["us"]
        if "ag" in ids and ObjectId.is_valid(ids["ag"]):
            a = await db.agendas.find_one({"_id": ObjectId(ids["ag"])}, {"nome": 1})
            return a["nome"] if a else ids["ag"]
        if "tipo" in ids:
            return ids["tipo"]
    except Exception:
        pass
    return None


def _alvo_do_corpo(corpo: dict) -> Optional[str]:
    for k in ("equipamento", "bomba", "sistema", "device_id", "chiller", "name", "nome", "email"):
        if isinstance(corpo.get(k), str):
            return corpo[k]
    return None


async def registrar(token: Optional[str], metodo: str, caminho: str, status: int, ip: Optional[str],
                    corpo: Optional[bytes], tipo_conteudo: str):
    if not token:
        return
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except Exception:
        return
    uid = payload.get("sub")
    u = await db.users.find_one({"_id": ObjectId(uid)}, {"name": 1, "email": 1, "role": 1}) if ObjectId.is_valid(uid or "") else None
    cat, desc, ids = classificar(metodo, caminho)
    detalhe, dados = None, {}
    if corpo and "json" in (tipo_conteudo or ""):
        try:
            dados = json.loads(corpo.decode() or "{}")
            if isinstance(dados, dict):
                detalhe = json.dumps(sanitizar(dados), ensure_ascii=False)[:400]
        except Exception:
            dados = {}
    elif corpo and "multipart" in (tipo_conteudo or ""):
        detalhe = "(arquivo enviado)"
    alvo = await _nome_alvo(ids) or (_alvo_do_corpo(dados) if isinstance(dados, dict) else None)
    await db.audit_log.insert_one({
        "timestamp": now_iso(), "user_id": uid,
        "nome": (u or {}).get("name") or payload.get("email"), "email": (u or {}).get("email") or payload.get("email"),
        "perfil": (u or {}).get("role") or payload.get("role"),
        "categoria": cat, "acao": desc, "alvo": alvo, "detalhe": detalhe,
        "metodo": metodo, "rota": caminho, "status": status, "ip": ip,
    })


async def registrar_exportacao(user: dict, relatorio: str, filtros: dict):
    await db.audit_log.insert_one({
        "timestamp": now_iso(), "user_id": user.get("id"), "nome": user.get("name") or user.get("email"),
        "email": user.get("email"), "perfil": user.get("role"), "categoria": "Relatórios",
        "acao": f"Exportou relatório: {relatorio}", "alvo": None,
        "detalhe": json.dumps({k: v for k, v in filtros.items() if v not in (None, "")}, ensure_ascii=False),
        "metodo": "GET", "rota": "/api/reports", "status": 200, "ip": None,
    })


class AuditoriaMiddleware:
    """ASGI puro: não interfere no corpo/streaming; grava depois que a resposta sai."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH", "DELETE") \
                or not scope["path"].startswith("/api/") or IGNORAR.match(scope["path"]):
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode(errors="ignore") for k, v in scope.get("headers", [])}
        tipo = headers.get("content-type", "")
        guardar = "multipart" not in tipo
        partes, tamanho, status = [], 0, [0]

        async def receive_wrap():
            nonlocal tamanho
            msg = await receive()
            if msg["type"] == "http.request" and guardar and tamanho < 65536:
                b = msg.get("body", b"")
                partes.append(b)
                tamanho += len(b)
            return msg

        async def send_wrap(msg):
            if msg["type"] == "http.response.start":
                status[0] = msg["status"]
            await send(msg)

        try:
            await self.app(scope, receive_wrap, send_wrap)
        finally:
            if status[0] and status[0] != 401:
                token = None
                for par in headers.get("cookie", "").split(";"):
                    k, _, v = par.strip().partition("=")
                    if k == "access_token":
                        token = v
                if not token and headers.get("authorization", "").startswith("Bearer "):
                    token = headers["authorization"][7:]
                corpo = b"".join(partes) if guardar else (b"x" if tipo else None)
                ip = ip_da_requisicao(headers, scope.get("client"))
                asyncio.create_task(_seguro(registrar(token, scope["method"], scope["path"], status[0], ip, corpo, tipo)))


async def _seguro(coro):
    try:
        await coro
    except Exception:
        logger.exception("falha ao gravar auditoria")


# ---------------- usuários: exibição conforme perfil (minimização) ----------------
async def mapa_usuarios() -> dict:
    m = {}
    async for u in db.users.find({}, {"name": 1, "email": 1}):
        info = {"nome": u.get("name") or u.get("email"), "email": u.get("email")}
        m[str(u["_id"])] = info
        if u.get("email"):
            m[u["email"]] = info
    return m


def quem(ref: Optional[str], mapa: dict, admin: bool, nome_salvo: Optional[str] = None, email_salvo: Optional[str] = None) -> dict:
    """ref = id ou e-mail gravado no log. Admin vê e-mail; demais perfis só o nome."""
    if not ref and not nome_salvo:
        return {"usuario": "—", "email": None}
    info = mapa.get(ref or "") or {}
    if not info and ref and "@" not in ref and not ObjectId.is_valid(ref):
        return {"usuario": ref, "email": None}  # ex.: "programação CAG", "sequenciador"
    nome = info.get("nome") or nome_salvo or ("usuário removido" if ref else "—")
    email = info.get("email") or email_salvo or (ref if ref and "@" in ref else None)
    if not admin and nome == email:  # sem nome cadastrado → não expõe o e-mail inteiro
        nome = mascarar_email(email)
    return {"usuario": nome, "email": email if admin else None}


def mascarar_email(e: Optional[str]) -> str:
    if not e or "@" not in e:
        return e or "—"
    a, d = e.split("@", 1)
    return f"{a[:2]}***@{d}"


def csv_resposta(nome: str, linhas: list, colunas: list[tuple[str, str]]) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")  # BOM: Excel abre com acentos
    w = csv.writer(buf, delimiter=";")
    w.writerow([t for _, t in colunas])
    for r in linhas:
        w.writerow(["" if r.get(k) is None else r.get(k) for k, _ in colunas])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f"attachment; filename={nome}"})


def fmt_local(ts: Optional[str]) -> str:
    if not ts:
        return ""
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromisoformat(ts).astimezone(ZoneInfo("America/Sao_Paulo")).strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        return ts


# ---------------- relatório de auditoria ----------------
@router.get("/reports/auditoria")
async def rel_auditoria(days: int = 30, usuario: str = "", categoria: str = "", q: str = "",
                        format: str = "json", user: dict = Depends(get_current_user)):
    admin = user["role"] == "admin"
    days = max(1, min(days, 3650))
    filtro: dict = {"timestamp": {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}}
    if not admin:
        filtro["categoria"] = {"$nin": ["Usuários", "Sistema", "Relatórios"]}  # trilha administrativa só p/ admin
    if usuario:
        filtro["user_id"] = usuario
    if categoria:
        filtro["categoria"] = categoria if admin or categoria not in ("Usuários", "Sistema", "Relatórios") else "__nenhuma__"
    mapa = await mapa_usuarios()
    escopo = None if admin else await _escopo(user)
    rows = []
    async for a in db.audit_log.find(filtro, {"_id": 0}).sort("timestamp", -1).limit(5000):
        if escopo and not _no_escopo(a, escopo, user):
            continue
        u = quem(a.get("user_id"), mapa, admin, a.get("nome"), a.get("email"))
        r = {"timestamp": a["timestamp"], "user_id": a.get("user_id"), **u, "perfil": a.get("perfil"),
             "categoria": a.get("categoria"), "acao": a.get("acao"), "alvo": a.get("alvo"),
             "detalhe": a.get("detalhe") if admin else None, "status": a.get("status"),
             "ip": a.get("ip") if admin else None}
        if q:
            txt = " ".join(str(v) for v in r.values() if v).lower()
            if q.lower() not in txt:
                continue
        rows.append(r)
    if format == "csv":
        await registrar_exportacao(user, "Alterações (auditoria)", {"dias": days, "usuario": usuario, "categoria": categoria, "busca": q})
        for r in rows:
            r["quando"] = fmt_local(r["timestamp"])
            r["resultado"] = "ok" if (r["status"] or 0) < 400 else f"recusado ({r['status']})"
        cols = [("quando", "Data/hora"), ("usuario", "Usuário")] + ([("email", "E-mail")] if admin else []) + \
               [("perfil", "Perfil"), ("categoria", "Sistema"), ("acao", "Ação"), ("alvo", "Alvo")] + \
               ([("detalhe", "Detalhe"), ("ip", "IP")] if admin else []) + [("resultado", "Resultado")]
        return csv_resposta("auditoria.csv", rows, cols)
    return rows


async def _escopo(user: dict) -> dict:
    """O que um não-admin pode ver: módulos e nomes dos fancoils autorizados."""
    from auth import allowed_modules, allowed_fancoil_ids
    mods = await allowed_modules(user) or []
    ids = set(await allowed_fancoil_ids(user) or [])
    nomes = set()
    async for f in db.fancoils.find({}, {"name": 1, "device_id": 1}):
        if str(f["_id"]) in ids:
            nomes.update({f.get("name"), f.get("device_id")})
    return {"mods": set(mods), "fancoils": nomes}


def _no_escopo(a: dict, esc: dict, user: dict) -> bool:
    if a.get("user_id") == user.get("id"):
        return True  # as próprias ações sempre aparecem
    cat = a.get("categoria")
    if cat == "Fancoils":
        return a.get("alvo") in esc["fancoils"]
    return {"CAG": "cag", "Hidráulica": "hidraulica", "Iluminação": "iluminacao"}.get(cat) in esc["mods"]


@router.get("/reports/usuarios")
async def rel_usuarios(user: dict = Depends(get_current_user)):
    """Lista para o filtro 'Usuário' dos relatórios (só nome para não-admin)."""
    admin = user["role"] == "admin"
    out = []
    if not admin:  # não-admin não recebe a lista de usuários do sistema
        return [{"id": user["id"], "nome": user.get("name") or mascarar_email(user.get("email")), "email": None}]
    async for u in db.users.find({}, {"name": 1, "email": 1}).sort("name", 1):
        out.append({"id": str(u["_id"]), "nome": u.get("name") or (u.get("email") if admin else mascarar_email(u.get("email"))),
                    "email": u.get("email") if admin else None})
    return out


# ---------------- LGPD: retenção e inventário ----------------
class LgpdIn(BaseModel):
    retencao_acessos_dias: int
    retencao_auditoria_dias: int
    retencao_comandos_dias: int


async def lgpd_config() -> dict:
    s = await db.settings.find_one({"_id": "global"}) or {}
    return {**LGPD_PADRAO, **(s.get("lgpd") or {})}


async def expurgar() -> dict:
    cfg = await lgpd_config()
    agora = datetime.now(timezone.utc)
    lim = lambda d: (agora - timedelta(days=d)).isoformat()
    r = {
        "access_log": (await db.access_log.delete_many({"timestamp": {"$lt": lim(cfg["retencao_acessos_dias"])}})).deleted_count,
        "audit_log": (await db.audit_log.delete_many({"timestamp": {"$lt": lim(cfg["retencao_auditoria_dias"])}})).deleted_count,
        "command_log": (await db.command_log.delete_many({"timestamp": {"$lt": lim(cfg["retencao_comandos_dias"])}})).deleted_count,
    }
    await db.settings.update_one({"_id": "global"}, {"$set": {"lgpd_ultimo_expurgo": {"em": now_iso(), **r}}}, upsert=True)
    if any(r.values()):
        logger.info("LGPD expurgo: %s", r)
    return r


async def ciclo_expurgo():
    while True:
        try:
            await expurgar()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("expurgo LGPD")
        await asyncio.sleep(24 * 3600)


@router.get("/lgpd")
async def ler_lgpd(_: dict = Depends(require_admin)):
    s = await db.settings.find_one({"_id": "global"}) or {}
    inv = []
    for col, nome, dados in (("access_log", "Log de acesso", "nome/e-mail, IP, data/hora de login e logout"),
                             ("audit_log", "Auditoria de alterações", "nome, e-mail, perfil, IP, ação realizada"),
                             ("command_log", "Log de comandos", "usuário (id/e-mail) que enviou o comando"),
                             ("users", "Cadastro de usuários", "nome, e-mail, perfil, último login, senha (hash bcrypt)")):
        mais_antigo = await db[col].find_one({}, {"timestamp": 1, "created_at": 1}, sort=[("timestamp", 1)])
        inv.append({"colecao": col, "nome": nome, "dados": dados, "registros": await db[col].count_documents({}),
                    "mais_antigo": (mais_antigo or {}).get("timestamp") or (mais_antigo or {}).get("created_at")})
    return {"config": await lgpd_config(), "ultimo_expurgo": s.get("lgpd_ultimo_expurgo"), "inventario": inv}


@router.put("/lgpd")
async def gravar_lgpd(req: LgpdIn, _: dict = Depends(require_admin)):
    if not 180 <= req.retencao_acessos_dias <= 3650:
        raise HTTPException(400, "Log de acesso: mínimo 180 dias (Marco Civil da Internet, art. 15) e máximo 3650")
    for v, nome in ((req.retencao_auditoria_dias, "Auditoria"), (req.retencao_comandos_dias, "Comandos")):
        if not 90 <= v <= 3650:
            raise HTTPException(400, f"{nome}: use de 90 a 3650 dias")
    await db.settings.update_one({"_id": "global"}, {"$set": {"lgpd": req.dict()}}, upsert=True)
    return await ler_lgpd(_)


@router.post("/lgpd/expurgar")
async def expurgar_agora(_: dict = Depends(require_admin)):
    return await expurgar()
