"""CAG — Central de Água Gelada (v1.15).

Equipamentos
  CH1, CH2        chillers parafuso
  VCH1, VCH2      válvulas atuadas (on/off) na entrada de água de cada chiller
  BAP1..BAP3      bombas primárias (CH1↔BAP1, CH2↔BAP2, BAP3 reserva)
  BAS1..BAS3      bombas secundárias com inversor (BAS3 reserva)

Modo da central (decidido no CLP/controladora)
  AUTO    a controladora faz a sequência: abre a válvula, parte a primária, parte o chiller,
          mantém as secundárias pela pressão diferencial. O BMS só manda partir/parar a central,
          o chiller líder e os setpoints.
  MANUAL  o BMS comanda cada equipamento individualmente.

Contrato MQTT completo: docs/CAG_MQTT.md. Sem controladora real, o backend simula a central
(settings.cag_simulacao, padrão ligado).
"""
from __future__ import annotations
import asyncio
import logging
import math
import random
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_admin
from db import db

logger = logging.getLogger("cag")
router = APIRouter(prefix="/api")

CHILLERS = ["CH1", "CH2"]
VALVULAS = ["VCH1", "VCH2"]
PRIMARIAS = ["BAP1", "BAP2", "BAP3"]
SECUNDARIAS = ["BAS1", "BAS2", "BAS3"]
MOTORES = CHILLERS + PRIMARIAS + SECUNDARIAS
EQUIPS = CHILLERS + VALVULAS + PRIMARIAS + SECUNDARIAS
NOMES = {"CH1": "Chiller 1", "CH2": "Chiller 2",
         "VCH1": "Válvula entrada CH1", "VCH2": "Válvula entrada CH2",
         "BAP1": "Bomba primária 1", "BAP2": "Bomba primária 2", "BAP3": "Bomba primária 3",
         "BAS1": "Bomba secundária 1", "BAS2": "Bomba secundária 2", "BAS3": "Bomba secundária 3"}
SP_AGUA = (5.0, 12.0)
SP_DP = (20.0, 300.0)
CURSO_VALVULA_S = 6


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b(p: str) -> bool:
    return p.strip().lower() in ("1", "true", "on", "ligado", "aberta")


def _f(p: str) -> Optional[float]:
    try:
        return float(p)
    except ValueError:
        return None


def _par(ch: str) -> tuple[str, str]:
    """(válvula, primária dedicada) do chiller."""
    n = ch[-1]
    return f"VCH{n}", f"BAP{n}"


class CagService:
    def __init__(self):
        self.simulacao = True
        self.online = False
        self.atualizado_em: Optional[str] = None
        self.geral = {"temp_ida": None, "temp_retorno": None, "dp": None, "setpoint": 7.0, "dp_setpoint": 120.0,
                      "modo": "AUTO", "central": False, "central_cmd": None, "lider": "CH1"}
        self.eq: dict = {}
        for e in EQUIPS:
            base = {"falha": False, "remoto": True, "cmd": None, "cmd_at": None}
            if e in VALVULAS:
                base.update(aberta=False, fechada=True)
            else:
                base.update(status=False, horas=0.0)
            self.eq[e] = base
        for c in CHILLERS:
            self.eq[c].update(temp_saida=None, temp_entrada=None, carga=0.0)
        for b in SECUNDARIAS:
            self.eq[b].update(velocidade=0.0)
        self._task: Optional[asyncio.Task] = None
        self._sim_t = time.time()
        self._mov: dict = {}  # equip -> instante do comando (atraso de partida/curso na simulação)

    # ---------- ciclo de vida ----------
    async def start(self):
        s = await db.settings.find_one({"_id": "global"}) or {}
        self.simulacao = s.get("cag_simulacao", True)
        if self.simulacao:
            self._seed_sim()
        if not self._task:
            self._task = asyncio.create_task(self._loop())

    def _seed_sim(self):
        self.online = True
        rnd = random.Random(42)
        for e in MOTORES:
            self.eq[e]["horas"] = float(rnd.randint(4000, 18000))
            self.eq[e].update(status=False, cmd=None, falha=False, remoto=True)
        for v in VALVULAS:
            self.eq[v].update(aberta=False, fechada=True, cmd=None, falha=False, remoto=True)
        self.geral.update(modo="AUTO", central=True, central_cmd=True, lider="CH1",
                          temp_ida=7.2, temp_retorno=12.1, dp=118.0)
        for e in ("CH1", "BAP1", "BAS1", "BAS2"):
            self.eq[e].update(status=True, cmd=True)
        self.eq["VCH1"].update(aberta=True, fechada=False, cmd=True)
        for k in MOTORES:
            self.eq[k]["cmd"] = self.eq[k]["status"]
        for v in VALVULAS:
            self.eq[v]["cmd"] = self.eq[v]["aberta"]
        self.eq["CH1"].update(temp_saida=7.1, temp_entrada=12.0, carga=62.0)
        self.eq["CH2"].update(temp_saida=13.5, temp_entrada=13.6, carga=0.0)
        self._mov.clear()

    async def _loop(self):
        while True:
            try:
                await asyncio.sleep(2)
                if self.simulacao:
                    self._tick_sim()
                await self._alarmes()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("CAG loop")

    # ---------- MQTT (controladora real) ----------
    async def handle(self, var: str, payload: str):
        if self.simulacao:
            return  # em simulação ignora a planta real (evita mistura)
        p = payload.strip()
        self.atualizado_em = now_iso()
        if var == "ONLINE":
            self.online = _b(p)
            return
        self.online = True
        parts = var.split("/")
        if len(parts) != 2:
            return
        alvo, campo = parts[0].upper(), parts[1].upper()
        if alvo == "GERAL":
            if campo == "MODO":
                self.geral["modo"] = "MANUAL" if p.upper().startswith("MAN") else "AUTO"
            elif campo == "CENTRAL":
                self.geral["central"] = _b(p)
            elif campo == "LIDER" and p.upper() in CHILLERS:
                self.geral["lider"] = p.upper()
            else:
                chave = {"TEMP_IDA": "temp_ida", "TEMP_RETORNO": "temp_retorno", "DP": "dp",
                         "SETPOINT": "setpoint", "DP_SETPOINT": "dp_setpoint"}.get(campo)
                if chave and _f(p) is not None:
                    self.geral[chave] = _f(p)
            return
        if alvo not in self.eq:
            return
        e = self.eq[alvo]
        if campo in ("STATUS", "FALHA", "REMOTO", "ABERTA", "FECHADA"):
            e[campo.lower()] = _b(p)
        elif campo in ("HORAS", "TEMP_SAIDA", "TEMP_ENTRADA", "CARGA", "VELOCIDADE") and _f(p) is not None:
            e[campo.lower()] = _f(p)

    def _publish(self, sub: str, valor: str) -> bool:
        from mqtt_service import svc
        if svc._client and svc.connected:
            svc._client.publish(f"{svc.topic_prefix}/CAG/{sub}", valor, qos=1, retain=True)
            return True
        return False

    async def _log(self, user: dict, alvo: str, acao: str, valor: str):
        await db.command_log.insert_one({"device_id": f"CAG/{alvo}" if alvo else "CAG", "user_id": user.get("email"),
                                         "kind": "CAG", "acao": acao, "value": valor, "timestamp": now_iso(),
                                         "simulacao": self.simulacao})

    # ---------- comandos ----------
    async def comandar(self, equip: str, ligar: bool, user: dict):
        e = self.eq[equip]
        if self.geral["modo"] == "AUTO":
            raise HTTPException(400, "Central em AUTOMÁTICO — passe para MANUAL para comandar equipamentos individualmente")
        if not e["remoto"]:
            raise HTTPException(400, f"{NOMES[equip]} está em LOCAL — comando só no painel do equipamento")
        if ligar and e["falha"]:
            raise HTTPException(400, f"{NOMES[equip]} está em falha — reconheça no equipamento antes")
        if equip in CHILLERS and ligar:
            v, b = _par(equip)
            if not self.eq[v]["aberta"]:
                raise HTTPException(400, f"Abra antes a {NOMES[v]}")
            if not (self.eq[b]["status"] or self.eq["BAP3"]["status"]):
                raise HTTPException(400, f"Ligue antes a {NOMES[b]} (ou a reserva BAP3)")
        if equip in VALVULAS and not ligar:
            ch = "CH" + equip[-1]
            if self.eq[ch]["status"]:
                raise HTTPException(400, f"Desligue o {NOMES[ch]} antes de fechar a válvula")
        e["cmd"], e["cmd_at"] = ligar, now_iso()
        if self.simulacao:
            self._mov[equip] = time.time()
        elif not self._publish(f"{equip}/CMD/SET", "true" if ligar else "false"):
            raise HTTPException(503, "Sem conexão com o broker MQTT")
        acao = ("ABRIR" if ligar else "FECHAR") if equip in VALVULAS else ("LIGAR" if ligar else "DESLIGAR")
        await self._log(user, equip, acao, "true" if ligar else "false")

    async def central(self, user: dict, modo: Optional[str] = None, ligar: Optional[bool] = None,
                      lider: Optional[str] = None):
        if modo is not None:
            modo = modo.upper()
            if modo not in ("AUTO", "MANUAL"):
                raise HTTPException(400, "Modo inválido")
            if not self.simulacao and not self._publish("GERAL/MODO/SET", modo):
                raise HTTPException(503, "Sem conexão com o broker MQTT")
            self.geral["modo"] = modo
            if modo == "MANUAL":  # mantém o que está rodando; comandos passam a ser individuais
                for k in MOTORES + VALVULAS:
                    self.eq[k]["cmd"] = self.eq[k].get("status", self.eq[k].get("aberta"))
            await self._log(user, None, "MODO", modo)
        if lider is not None:
            lider = lider.upper()
            if lider not in CHILLERS:
                raise HTTPException(400, "Chiller líder inválido")
            if not self.simulacao and not self._publish("GERAL/LIDER/SET", lider):
                raise HTTPException(503, "Sem conexão com o broker MQTT")
            self.geral["lider"] = lider
            await self._log(user, None, "LIDER", lider)
        if ligar is not None:
            if self.geral["modo"] != "AUTO":
                raise HTTPException(400, "Partir/parar a central só em AUTOMÁTICO")
            if not self.simulacao and not self._publish("GERAL/CMD/SET", "true" if ligar else "false"):
                raise HTTPException(503, "Sem conexão com o broker MQTT")
            self.geral["central_cmd"] = ligar
            if self.simulacao:
                self.geral["central"] = ligar
            await self._log(user, None, "PARTIR" if ligar else "PARAR", "true" if ligar else "false")

    async def setpoint(self, tipo: str, valor: float, user: dict):
        lo, hi = SP_AGUA if tipo == "agua" else SP_DP
        if not lo <= valor <= hi:
            raise HTTPException(400, f"Valor fora da faixa ({lo:g}–{hi:g})")
        chave, topico = ("setpoint", "GERAL/SETPOINT/SET") if tipo == "agua" else ("dp_setpoint", "GERAL/DP_SETPOINT/SET")
        if self.simulacao:
            self.geral[chave] = round(valor, 1)
        elif not self._publish(topico, f"{valor:.1f}"):
            raise HTTPException(503, "Sem conexão com o broker MQTT")
        await self._log(user, None, "SETPOINT" if tipo == "agua" else "DP_SETPOINT", f"{valor:.1f}")

    # ---------- simulação ----------
    def _sequencia_auto(self):
        """Na simulação faz o papel do CLP em AUTOMÁTICO."""
        g = self.geral
        lider = g["lider"] if not self.eq[g["lider"]]["falha"] else next(c for c in CHILLERS if c != g["lider"])
        alvo = {k: False for k in MOTORES + VALVULAS}
        if g["central"]:
            v, b = _par(lider)
            if self.eq[b]["falha"]:
                b = "BAP3"
            alvo[v] = True
            alvo[b] = self.eq[v]["aberta"]
            alvo[lider] = self.eq[v]["aberta"] and self.eq[b]["status"]
            secs = [s for s in SECUNDARIAS if not self.eq[s]["falha"]][:2]
            for s in secs:
                alvo[s] = True
            # outro chiller (troca de líder): para primeiro, depois válvula e bomba
            for c in CHILLERS:
                if c == lider:
                    continue
                vo, bo = _par(c)
                alvo[vo] = alvo[vo] or (self.eq[c]["status"] and self.eq[vo]["aberta"])
                alvo[bo] = alvo[bo] or self.eq[c]["status"]
        else:
            # parada: chiller primeiro; válvula e bomba depois que o chiller parou
            for c in CHILLERS:
                v, b = _par(c)
                alvo[v] = self.eq[c]["status"] and self.eq[v]["aberta"]
                alvo[b] = self.eq[c]["status"]
            alvo["BAP3"] = any(self.eq[c]["status"] for c in CHILLERS) and self.eq["BAP3"]["status"]
        for k, v in alvo.items():
            if self.eq[k]["falha"]:
                continue
            if self.eq[k]["cmd"] != v:
                self.eq[k]["cmd"], self.eq[k]["cmd_at"] = v, now_iso()
                self._mov[k] = time.time()

    def _tick_sim(self):
        agora = time.time()
        dt = agora - self._sim_t
        self._sim_t = agora
        self.online = True
        self.atualizado_em = now_iso()
        if self.geral["modo"] == "AUTO":
            self._sequencia_auto()
        # válvulas: curso
        for v in VALVULAS:
            e = self.eq[v]
            if v in self._mov and agora - self._mov[v] >= CURSO_VALVULA_S:
                e["aberta"], e["fechada"] = bool(e["cmd"]), not e["cmd"]
                self._mov.pop(v, None)
            elif v in self._mov:
                e["aberta"] = e["fechada"] = False  # em curso
        # motores: atraso de partida (bomba 3 s, chiller 8 s) e intertravamentos
        for k in MOTORES:
            if k not in self._mov:
                continue
            e = self.eq[k]
            if agora - self._mov[k] < (8 if k in CHILLERS else 3):
                continue
            if e["cmd"] and k in CHILLERS:
                v, b = _par(k)
                if not (self.eq[v]["aberta"] and (self.eq[b]["status"] or self.eq["BAP3"]["status"])):
                    continue
            e["status"] = bool(e["cmd"])
            self._mov.pop(k, None)
        for c in CHILLERS:  # chiller sem vazão ou com válvula fechada desarma
            v, b = _par(c)
            if self.eq[c]["status"] and not (self.eq[v]["aberta"] and (self.eq[b]["status"] or self.eq["BAP3"]["status"])):
                self.eq[c]["status"] = False
        for k in MOTORES:
            if self.eq[k]["status"]:
                self.eq[k]["horas"] += dt / 3600
        # carga térmica do prédio (pico ~15h) + ruído
        agora_dt = datetime.now(timezone.utc)
        h = (agora_dt.hour - 3) % 24 + agora_dt.minute / 60
        carga_predio = max(0.15, 0.55 + 0.35 * math.sin((h - 9) / 12 * math.pi)) + random.uniform(-0.02, 0.02)
        rodando = [c for c in CHILLERS if self.eq[c]["status"]]
        sp = self.geral["setpoint"]
        dt_agua = 4.5 + 2.0 * carga_predio
        for c in CHILLERS:
            e = self.eq[c]
            if c in rodando:
                alvo = min(100.0, carga_predio * 100 / len(rodando))
                e["carga"] += (alvo - e["carga"]) * 0.2
                e["temp_saida"] = self._aprox(e["temp_saida"], sp + (0.6 if e["carga"] > 98 else 0.1), 0.15)
                e["temp_entrada"] = self._aprox(e["temp_entrada"], e["temp_saida"] + dt_agua, 0.15)
            else:
                e["carga"] += (0 - e["carga"]) * 0.3
                e["temp_saida"] = self._aprox(e["temp_saida"], 13.5, 0.03)
                e["temp_entrada"] = self._aprox(e["temp_entrada"], 13.6, 0.03)
            for k in ("temp_saida", "temp_entrada", "carga"):
                e[k] = round(e[k], 2)
        ida = (sum(self.eq[c]["temp_saida"] for c in rodando) / len(rodando)) if rodando \
            else self._aprox(self.geral["temp_ida"], 14.0, 0.02)
        self.geral["temp_ida"] = round(ida + random.uniform(-0.05, 0.05), 2)
        self.geral["temp_retorno"] = round(self._aprox(self.geral["temp_retorno"], ida + dt_agua, 0.1), 2)
        sec = [b for b in SECUNDARIAS if self.eq[b]["status"]]
        alvo_vel = min(100.0, (30 + 60 * carga_predio) * (2 / max(1, len(sec)))) if sec else 0
        for b in SECUNDARIAS:
            e = self.eq[b]
            e["velocidade"] = round(e["velocidade"] + ((alvo_vel if b in sec else 0) - e["velocidade"]) * 0.25, 1)
        dp_alvo = self.geral["dp_setpoint"] if sec else 0.0
        self.geral["dp"] = round(self._aprox(self.geral["dp"], dp_alvo, 0.2) + (random.uniform(-1.5, 1.5) if sec else 0), 1)

    @staticmethod
    def _aprox(v, alvo, k):
        return alvo if v is None else v + (alvo - v) * k

    # ---------- alarmes ----------
    async def _alarmes(self):
        from alarms import raise_alarm, clear_alarm
        for eq in EQUIPS:
            did = f"CAG/{eq}"
            if self.eq[eq]["falha"]:
                await raise_alarm(did, "CAG_FALHA", {"equipamento": NOMES[eq]})
            else:
                await clear_alarm(did, "CAG_FALHA")

    # ---------- saída ----------
    def to_dict(self) -> dict:
        eqs = {}
        for k, e in self.eq.items():
            if k in VALVULAS:
                em_curso = not e["aberta"] and not e["fechada"]
                pend = em_curso or (e["cmd"] is not None and e["cmd"] != e["aberta"] and not e["falha"])
                eqs[k] = {**e, "nome": NOMES[k], "tipo": "valvula", "em_curso": em_curso, "pendente": pend}
            else:
                pend = e["cmd"] is not None and e["cmd"] != e["status"] and not e["falha"]
                tipo = "chiller" if k in CHILLERS else "bomba"
                eqs[k] = {**e, "nome": NOMES[k], "tipo": tipo, "horas": round(e["horas"], 1), "pendente": pend}
        g = dict(self.geral)
        if g["temp_ida"] is not None and g["temp_retorno"] is not None:
            g["delta_t"] = round(g["temp_retorno"] - g["temp_ida"], 1)
        return {"simulacao": self.simulacao, "online": self.online, "atualizado_em": self.atualizado_em,
                "geral": g, "equipamentos": eqs,
                "resumo": {"chillers": sum(self.eq[c]["status"] for c in CHILLERS),
                           "primarias": sum(self.eq[b]["status"] for b in PRIMARIAS),
                           "secundarias": sum(self.eq[b]["status"] for b in SECUNDARIAS),
                           "valvulas_abertas": sum(self.eq[v]["aberta"] for v in VALVULAS)}}


cag_svc = CagService()


# ---------------- API ----------------
class CmdReq(BaseModel):
    equipamento: str
    ligar: bool  # válvula: true = abrir


class CentralReq(BaseModel):
    modo: Optional[str] = None
    ligar: Optional[bool] = None
    lider: Optional[str] = None


class SpReq(BaseModel):
    tipo: str  # agua | dp
    valor: float


class SimReq(BaseModel):
    ativo: bool


class FalhaReq(BaseModel):
    equipamento: str
    falha: bool


def _pode_comandar(user: dict):
    if user.get("role") == "viewer":
        raise HTTPException(403, "Visualizador não pode comandar a CAG")


@router.get("/cag")
async def estado(_: dict = Depends(get_current_user)):
    return cag_svc.to_dict()


@router.post("/cag/comando")
async def comando(req: CmdReq, user: dict = Depends(get_current_user)):
    _pode_comandar(user)
    eq = req.equipamento.upper()
    if eq not in EQUIPS:
        raise HTTPException(400, "Equipamento inválido")
    await cag_svc.comandar(eq, req.ligar, user)
    return cag_svc.to_dict()


@router.post("/cag/central")
async def central(req: CentralReq, user: dict = Depends(get_current_user)):
    _pode_comandar(user)
    await cag_svc.central(user, modo=req.modo, ligar=req.ligar, lider=req.lider)
    return cag_svc.to_dict()


@router.post("/cag/setpoint")
async def setpoint(req: SpReq, user: dict = Depends(get_current_user)):
    _pode_comandar(user)
    if req.tipo not in ("agua", "dp"):
        raise HTTPException(400, "Tipo inválido")
    await cag_svc.setpoint(req.tipo, req.valor, user)
    return cag_svc.to_dict()


@router.get("/cag/log")
async def historico(limit: int = 30, _: dict = Depends(get_current_user)):
    cur = db.command_log.find({"kind": "CAG"}, {"_id": 0}).sort("timestamp", -1).limit(min(limit, 200))
    return [d async for d in cur]


@router.put("/cag/simulacao")
async def simulacao(req: SimReq, _: dict = Depends(require_admin)):
    await db.settings.update_one({"_id": "global"}, {"$set": {"cag_simulacao": req.ativo}}, upsert=True)
    cag_svc.simulacao = req.ativo
    if req.ativo:
        cag_svc._seed_sim()
    else:
        cag_svc.online = False
        cag_svc.atualizado_em = None
    return cag_svc.to_dict()


@router.post("/cag/simular-falha")
async def simular_falha(req: FalhaReq, _: dict = Depends(require_admin)):
    """Só em simulação: liga/desliga uma falha para testar alarmes e a tela."""
    if not cag_svc.simulacao:
        raise HTTPException(400, "Disponível só no modo simulação")
    eq = req.equipamento.upper()
    if eq not in EQUIPS:
        raise HTTPException(400, "Equipamento inválido")
    e = cag_svc.eq[eq]
    e["falha"] = req.falha
    if req.falha:
        e["cmd"] = False
        if eq in VALVULAS:
            pass  # válvula em falha fica onde está
        else:
            e["status"] = False
    return cag_svc.to_dict()
