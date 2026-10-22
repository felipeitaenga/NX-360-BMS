"""CAG — Central de Água Gelada (v1.15).

Equipamentos
  CH1, CH2        chillers parafuso
  VCH1, VCH2      válvulas atuadas (on/off) na entrada de água de cada chiller
  BAP1..BAP3      bombas primárias (CH1↔BAP1, CH2↔BAP2, BAP3 reserva)
  BAS1..BAS3      bombas secundárias com inversor (BAS3 reserva)

Linhas: cada chiller tem a sua válvula, primária e secundária (CH1 = VCH1+BAP1+BAS1,
CH2 = VCH2+BAP2+BAS2). BAP3/BAS3 são reservas e entram no lugar da bomba dedicada em falha.

Modo da central
  AUTO    o NX-360 faz a sequência (v1.17), linha por linha, com espera entre etapas:
            partida: válvula → espera → primária → espera → secundária → espera → chiller
            parada:  chiller → espera → secundária → espera → primária → espera → válvula
          Partir/parar vem da programação horária da CAG (ou dos botões Partir/Parar).
          Programação: período geral liga o chiller líder (alternância diária CH1/CH2 opcional)
          e o horário de pico liga o 2º chiller junto. Troca de líder sem parar a central:
          o novo parte primeiro e o antigo só para quando o novo está rodando.
  MANUAL  o operador comanda cada equipamento individualmente (com intertravamentos).

Contrato MQTT completo: docs/CAG_MQTT.md. Sem controladora real, o backend simula a central
(settings.cag_simulacao, padrão ligado).
"""
from __future__ import annotations
import asyncio
import logging
import math
import random
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

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
TZ = ZoneInfo("America/Sao_Paulo")
ETAPAS = ["valvula", "primaria", "secundaria", "chiller"]
ETAPA_NOME = {"valvula": "válvula", "primaria": "bomba primária", "secundaria": "bomba secundária", "chiller": "chiller"}
TEMPOS_PADRAO = {"valvula": 60, "primaria": 60, "secundaria": 60}
TEMPO_FAIXA = (5, 900)
TIMEOUT_CONFIRMACAO_S = 120  # equipamento que não confirma depois da espera → falha da linha
DIAS_NOME = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]


def prog_padrao() -> dict:
    return {"ativo": False,
            "periodos": [{"dias": [1, 2, 3, 4, 5], "liga": "07:00", "desliga": "19:00", "setpoint": None}],
            "alternancia": True,
            "pico": {"ativo": False,
                     "periodos": [{"dias": [1, 2, 3, 4, 5], "liga": "13:00", "desliga": "17:00", "setpoint": None}]},
            "tempos": dict(TEMPOS_PADRAO)}


def _hm(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def na_janela(periodos: list, quando: datetime) -> bool:
    d = (quando.weekday() + 1) % 7  # 0=Dom
    agora = quando.hour * 60 + quando.minute
    return any(d in p["dias"] and _hm(p["liga"]) <= agora < (_hm(p["desliga"]) if p.get("desliga") else 1440)
               for p in periodos)


def lider_do_dia(dia) -> str:
    """Alternância diária: dias pares (ordinal) CH1, ímpares CH2."""
    return "CH1" if dia.toordinal() % 2 == 0 else "CH2"


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
                      "sp_cmd": None, "dp_sp_cmd": None,
                      "modo": "AUTO", "central": False, "central_cmd": False, "segundo_cmd": False, "lider": "CH1"}
        self.eq: dict = {}
        for e in EQUIPS:
            base = {"falha": False, "remoto": True, "cmd": None, "cmd_at": None}
            if e in VALVULAS:
                base.update(aberta=False, fechada=True)
            else:
                base.update(status=False, horas=0.0)
            self.eq[e] = base
        for c in CHILLERS:
            self.eq[c].update(temp_saida=None, temp_entrada=None, carga=0.0, setpoint=7.0, sp_cmd=None)
        for b in SECUNDARIAS:
            self.eq[b].update(velocidade=0.0)
        self._task: Optional[asyncio.Task] = None
        self._sim_t = time.time()
        self._mov: dict = {}  # equip -> instante do comando (atraso de partida/curso na simulação)
        self.prog: dict = prog_padrao()
        self._prog_estado: Optional[tuple] = None  # (geral, pico) da última avaliação
        self.linhas: dict = {c: self._linha_vazia() for c in CHILLERS}

    @staticmethod
    def _linha_vazia() -> dict:
        # n = etapas ligadas (0..4); ultimo = ("on"|"off", etapa, instante)
        return {"n": 0, "alvo": False, "bap": None, "bas": None, "ultimo": None, "falha": None}

    # ---------- ciclo de vida ----------
    async def start(self):
        s = await db.settings.find_one({"_id": "global"}) or {}
        self.simulacao = s.get("cag_simulacao", True)
        doc = await db.cag_programacao.find_one({"_id": "default"}, {"_id": 0}) or {}
        self.prog = {**prog_padrao(), **doc}
        self.prog["tempos"] = {**TEMPOS_PADRAO, **(doc.get("tempos") or {})}
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
        self.geral.update(modo="AUTO", central=True, central_cmd=True, segundo_cmd=False, lider="CH1",
                          temp_ida=7.2, temp_retorno=12.1, dp=118.0)
        for e in ("CH1", "BAP1", "BAS1"):
            self.eq[e].update(status=True, cmd=True)
        self.eq["VCH1"].update(aberta=True, fechada=False, cmd=True)
        for k in MOTORES:
            self.eq[k]["cmd"] = self.eq[k]["status"]
        for v in VALVULAS:
            self.eq[v]["cmd"] = self.eq[v]["aberta"]
        self.eq["CH1"].update(temp_saida=7.1, temp_entrada=12.0, carga=62.0)
        self.eq["CH2"].update(temp_saida=13.5, temp_entrada=13.6, carga=0.0)
        self._mov.clear()
        self._sync_linhas()
        self._prog_estado = None

    async def _loop(self):
        while True:
            try:
                await asyncio.sleep(2)
                await self._prog_tick()
                await self._sequenciar()
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
                    ck = {"setpoint": "sp_cmd", "dp_setpoint": "dp_sp_cmd"}.get(chave)
                    if ck and self.geral.get(ck) is not None and abs(self.geral[ck] - _f(p)) < 0.05:
                        self.geral[ck] = None
            return
        if alvo not in self.eq:
            return
        e = self.eq[alvo]
        if campo in ("STATUS", "FALHA", "REMOTO", "ABERTA", "FECHADA"):
            e[campo.lower()] = _b(p)
        elif campo in ("HORAS", "TEMP_SAIDA", "TEMP_ENTRADA", "CARGA", "VELOCIDADE") and _f(p) is not None:
            e[campo.lower()] = _f(p)
        elif campo == "SETPOINT" and alvo in CHILLERS and _f(p) is not None:
            e["setpoint"] = _f(p)
            if e.get("sp_cmd") is not None and abs(e["sp_cmd"] - e["setpoint"]) < 0.05:
                e["sp_cmd"] = None

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
        if not self._cmd(equip, ligar):
            raise HTTPException(503, "Sem conexão com o broker MQTT")
        await self._log(user, equip, self._acao(equip, ligar), "true" if ligar else "false")

    @staticmethod
    def _acao(equip: str, ligar: bool) -> str:
        return ("ABRIR" if ligar else "FECHAR") if equip in VALVULAS else ("LIGAR" if ligar else "DESLIGAR")

    def _cmd(self, equip: str, ligar: bool) -> bool:
        e = self.eq[equip]
        e["cmd"], e["cmd_at"] = ligar, now_iso()
        if self.simulacao:
            self._mov[equip] = time.time()
            return True
        return self._publish(f"{equip}/CMD/SET", "true" if ligar else "false")

    async def central(self, user: dict, modo: Optional[str] = None, ligar: Optional[bool] = None,
                      lider: Optional[str] = None, segundo: Optional[bool] = None):
        if modo is not None:
            modo = modo.upper()
            if modo not in ("AUTO", "MANUAL"):
                raise HTTPException(400, "Modo inválido")
            if not self.simulacao and not self._publish("GERAL/MODO/SET", modo):
                raise HTTPException(503, "Sem conexão com o broker MQTT")
            if modo != self.geral["modo"]:
                self.geral["modo"] = modo
                self._sync_linhas()
                if modo == "MANUAL":  # mantém o que está rodando; comandos passam a ser individuais
                    for k in MOTORES + VALVULAS:
                        self.eq[k]["cmd"] = self.eq[k].get("status", self.eq[k].get("aberta"))
                else:  # assume o que já está rodando; a programação (se ativa) reavalia
                    rodando = [c for c in CHILLERS if self.linhas[c]["n"] == 4]
                    self.geral["central_cmd"] = bool(rodando)
                    self.geral["segundo_cmd"] = len(rodando) > 1
                    self._prog_estado = None
            await self._log(user, None, "MODO", modo)
        if lider is not None:
            lider = lider.upper()
            if lider not in CHILLERS:
                raise HTTPException(400, "Chiller líder inválido")
            if self.prog.get("alternancia"):
                raise HTTPException(400, "Alternância diária ativa — o líder é escolhido pela programação da CAG")
            if not self.simulacao:
                self._publish("GERAL/LIDER/SET", lider)
            self.geral["lider"] = lider
            await self._log(user, None, "LIDER", lider)
        if ligar is not None:
            if self.geral["modo"] != "AUTO":
                raise HTTPException(400, "Partir/parar a central só em AUTOMÁTICO")
            self.geral["central_cmd"] = ligar
            if not ligar:
                self.geral["segundo_cmd"] = False
            await self._log(user, None, "PARTIR" if ligar else "PARAR", "true" if ligar else "false")
        if segundo is not None:
            if self.geral["modo"] != "AUTO":
                raise HTTPException(400, "2º chiller pelo sequenciador só em AUTOMÁTICO")
            if segundo and not self.geral["central_cmd"]:
                raise HTTPException(400, "Parta a central antes de ligar o 2º chiller")
            self.geral["segundo_cmd"] = segundo
            await self._log(user, None, "2CH_LIGAR" if segundo else "2CH_DESLIGAR", "true" if segundo else "false")

    async def rearmar(self, chiller: str, user: dict):
        L = self.linhas[chiller]
        if L["n"] > 0 and L["falha"]:
            raise HTTPException(400, "Aguarde a linha terminar de parar antes de rearmar")
        L["falha"] = None
        await self._log(user, chiller, "REARMAR", "true")

    async def setpoint(self, tipo: str, valor: float, user: dict, equipamento: Optional[str] = None):
        """tipo: agua (central → vale para os dois chillers) | dp | chiller (só o equipamento informado)."""
        lo, hi = SP_DP if tipo == "dp" else SP_AGUA
        if not lo <= valor <= hi:
            raise HTTPException(400, f"Valor fora da faixa ({lo:g}–{hi:g})")
        v = round(valor, 1)
        if tipo == "chiller":
            if equipamento not in CHILLERS:
                raise HTTPException(400, "Chiller inválido")
            alvos = [(f"{equipamento}/SETPOINT/SET", self.eq[equipamento], "setpoint", "sp_cmd")]
            acao, alvo_log = "SETPOINT", equipamento
        elif tipo == "agua":
            alvos = [("GERAL/SETPOINT/SET", self.geral, "setpoint", "sp_cmd")] + \
                    [(f"{c}/SETPOINT/SET", self.eq[c], "setpoint", "sp_cmd") for c in CHILLERS]
            acao, alvo_log = "SETPOINT", None
        else:
            alvos = [("GERAL/DP_SETPOINT/SET", self.geral, "dp_setpoint", "dp_sp_cmd")]
            acao, alvo_log = "DP_SETPOINT", None
        for topico, d, chave, ck in alvos:
            if self.simulacao:
                d[chave], d[ck] = v, None
            elif self._publish(topico, f"{v:.1f}"):
                d[ck] = v  # aguardando a controladora confirmar no tópico de estado
            else:
                raise HTTPException(503, "Sem conexão com o broker MQTT")
        await self._log(user, alvo_log, acao, f"{v:.1f}")

    # ---------- simulação ----------
    # ---------- programação horária da CAG ----------
    async def salvar_programacao(self, prog: dict):
        await db.cag_programacao.update_one({"_id": "default"}, {"$set": prog}, upsert=True)
        self.prog = {**prog_padrao(), **prog}
        self._prog_estado = None  # reavalia já no próximo ciclo

    async def _prog_tick(self, agora: Optional[datetime] = None):
        agora = agora or datetime.now(TZ)
        p = self.prog
        if p.get("alternancia"):
            self.geral["lider"] = lider_do_dia(agora.date())
        if not p.get("ativo") or self.geral["modo"] != "AUTO":
            self._prog_estado = None
            return
        base = na_janela(p["periodos"], agora)
        pico = base and bool(p["pico"].get("ativo")) and na_janela(p["pico"]["periodos"], agora)
        ant = self._prog_estado
        if ant == (base, pico):
            return
        sistema = {"email": "programação CAG"}
        if ant is None or ant[0] != base:
            self.geral["central_cmd"] = base
            await self._log(sistema, None, "PARTIR" if base else "PARAR", "true" if base else "false")
        if ant is None or ant[1] != pico:
            self.geral["segundo_cmd"] = pico
            await self._log(sistema, None, "2CH_LIGAR" if pico else "2CH_DESLIGAR", "true" if pico else "false")
        self._prog_estado = (base, pico)

    def semana(self, dias: int = 7) -> list:
        hoje = datetime.now(TZ).date()
        out = []
        for i in range(dias):
            d = hoje + timedelta(days=i)
            dw = (d.weekday() + 1) % 7
            faixa = lambda per: [[q["liga"], q.get("desliga") or "24:00"] for q in per if dw in q["dias"]]
            out.append({"data": d.isoformat(), "dia": DIAS_NOME[dw],
                        "lider": lider_do_dia(d) if self.prog.get("alternancia") else self.geral["lider"],
                        "geral": faixa(self.prog["periodos"]),
                        "pico": faixa(self.prog["pico"]["periodos"]) if self.prog["pico"].get("ativo") else []})
        return out

    # ---------- sequenciador (AUTO) ----------
    def _disp(self, eq: Optional[str]) -> bool:
        return bool(eq) and not self.eq[eq]["falha"] and self.eq[eq]["remoto"]

    def _bomba(self, c: str, grupo: list) -> Optional[str]:
        """Bomba dedicada da linha; se indisponível, a reserva (se a outra linha não estiver usando)."""
        n = c[-1]
        ded, res = grupo[int(n) - 1], grupo[2]
        chave = "bap" if grupo is PRIMARIAS else "bas"
        atual = self.linhas[c][chave]
        if atual and self.linhas[c]["n"] > ETAPAS.index("primaria" if chave == "bap" else "secundaria"):
            return atual  # já em uso nesta linha
        if self._disp(ded):
            return ded
        outra = next(x for x in CHILLERS if x != c)
        if self._disp(res) and self.linhas[outra][chave] != res:
            return res
        return None

    def linha_disponivel(self, c: str) -> bool:
        L = self.linhas[c]
        if L["falha"]:
            return False
        v, _ = _par(c)
        return self._disp(c) and self._disp(v) and bool(self._bomba(c, PRIMARIAS)) and bool(self._bomba(c, SECUNDARIAS))

    def _eq_etapa(self, c: str, k: int) -> Optional[str]:
        L = self.linhas[c]
        return [_par(c)[0], L["bap"], L["bas"], c][k]

    def _ok(self, eq: Optional[str], ligar: bool) -> bool:
        if not eq:
            return not ligar
        e = self.eq[eq]
        if eq in VALVULAS:
            return e["aberta"] if ligar else (e["fechada"] or e["falha"])
        return e["status"] if ligar else (not e["status"] or e["falha"])

    def _sync_linhas(self):
        """Reconstrói o estado das linhas a partir do campo (ao trocar de modo / iniciar simulação)."""
        for c in CHILLERS:
            v, _ = _par(c)
            n = c[-1]
            bap = next((b for b in (f"BAP{n}", "BAP3") if self.eq[b]["status"]), None)
            bas = next((b for b in (f"BAS{n}", "BAS3") if self.eq[b]["status"]), None)
            k = 0
            for ok in (self.eq[v]["aberta"], bap, bas, self.eq[c]["status"]):
                if not ok:
                    break
                k += 1
            falha = self.linhas[c]["falha"] if c in self.linhas else None
            self.linhas[c] = {**self._linha_vazia(), "n": k, "alvo": k == 4, "bap": bap, "bas": bas, "falha": falha,
                              "ultimo": ("on", k - 1, time.time()) if k else None}

    def _alvos(self) -> set:
        g = self.geral
        if not g["central_cmd"]:
            return set()
        ordem = [g["lider"]] + [c for c in CHILLERS if c != g["lider"]]
        disp = [c for c in ordem if self.linha_disponivel(c) or (self.linhas[c]["n"] == 4 and not self.linhas[c]["falha"])]
        alvos = set(disp[:2 if g.get("segundo_cmd") else 1])
        rodando = {c for c in CHILLERS if self.linhas[c]["n"] == 4 and self.eq[c]["status"] and not self.linhas[c]["falha"]}
        if alvos and not (alvos & rodando):
            alvos |= rodando  # troca de líder / failover: o antigo só para quando o novo estiver rodando
        return alvos

    async def _falha_linha(self, c: str, motivo: str):
        L = self.linhas[c]
        if not L["falha"]:
            L["falha"] = motivo
            logger.warning("CAG %s: %s", c, motivo)
            await self._log({"email": "sequenciador"}, c, "FALHA_LINHA", motivo)
        L["alvo"] = False

    async def _sequenciar(self):
        if self.geral["modo"] != "AUTO":
            self.geral["central"] = any(self.eq[c]["status"] for c in CHILLERS)
            return
        agora = time.time()
        T = self.prog["tempos"]
        alvos = self._alvos()
        for c in CHILLERS:
            L = self.linhas[c]
            # falha de equipamento numa linha em uso
            if L["n"] > 0 and not L["falha"]:
                em_uso = [self._eq_etapa(c, k) for k in range(L["n"])]
                caiu = next((e for e in em_uso if e and self.eq[e]["falha"]), None)
                if caiu:
                    await self._falha_linha(c, f"{NOMES[caiu]} em falha")
                elif L["n"] == 4 and L["ultimo"] and L["ultimo"][0] == "on" and self.eq[c]["status"] is False \
                        and agora - L["ultimo"][2] > T["secundaria"] + TIMEOUT_CONFIRMACAO_S:
                    await self._falha_linha(c, f"{NOMES[c]} desarmou")
            L["alvo"] = c in alvos and not L["falha"]
            ult = L["ultimo"]
            if L["alvo"] and L["n"] < 4:
                k = L["n"]
                if k > 0:
                    ant = self._eq_etapa(c, k - 1)
                    espera = T[ETAPAS[k - 1]] if ult and ult[0] == "on" else 0
                    decorrido = agora - ult[2] if ult else 1e9
                    if not self._ok(ant, True):
                        if decorrido > espera + TIMEOUT_CONFIRMACAO_S:
                            await self._falha_linha(c, f"{NOMES[ant]} não confirmou")
                        continue
                    if decorrido < espera:
                        continue
                if k == 1:
                    L["bap"] = self._bomba(c, PRIMARIAS)
                elif k == 2:
                    L["bas"] = self._bomba(c, SECUNDARIAS)
                eq = self._eq_etapa(c, k)
                if not self._disp(eq):
                    await self._falha_linha(c, f"{NOMES[eq] if eq else ETAPA_NOME[ETAPAS[k]]} indisponível")
                    continue
                self._cmd(eq, True)
                L["n"], L["ultimo"] = k + 1, ("on", k, agora)
                await self._log({"email": "sequenciador"}, eq, self._acao(eq, True), "true")
            elif not L["alvo"] and L["n"] > 0:
                k = L["n"] - 1  # próxima a desligar
                if ult and ult[0] == "off":
                    anterior = self._eq_etapa(c, k + 1)
                    if not self._ok(anterior, False):
                        continue
                    if agora - ult[2] < T[ETAPAS[k]]:
                        continue
                eq = self._eq_etapa(c, k)
                if eq:
                    self._cmd(eq, False)
                    await self._log({"email": "sequenciador"}, eq, self._acao(eq, False), "false")
                L["n"], L["ultimo"] = k, ("off", k, agora)
                if k == 0:
                    L["bap"] = L["bas"] = None
        self.geral["central"] = any(self.linhas[c]["n"] > 0 for c in CHILLERS)

    def sequencia_dict(self) -> dict:
        agora = time.time()
        T = self.prog["tempos"]
        out = {}
        for c in CHILLERS:
            L = self.linhas[c]
            n, ult = L["n"], L["ultimo"]
            restante = 0
            if L["alvo"] and n < 4:
                fase = "partindo"
                if ult and ult[0] == "on" and n > 0:
                    restante = max(0, int(T[ETAPAS[n - 1]] - (agora - ult[2])))
                prox = ETAPA_NOME[ETAPAS[n]]
                txt = f"Partindo: {n}/4 — próximo: {prox}" + (f" em {restante}s" if restante else "")
            elif not L["alvo"] and n > 0:
                fase = "parando"
                if ult and ult[0] == "off" and n < 4:
                    restante = max(0, int(T[ETAPAS[n - 1]] - (agora - ult[2])))
                prox = ETAPA_NOME[ETAPAS[n - 1]]
                txt = f"Parando: desligar {prox}" + (f" em {restante}s" if restante else "")
            elif n == 4:
                fase, txt = "rodando", "Em operação"
            else:
                fase, txt = "parado", "Parado"
            out[c] = {"n": n, "alvo": L["alvo"], "fase": fase, "texto": txt, "restante": restante,
                      "falha": L["falha"], "bap": L["bap"], "bas": L["bas"], "disponivel": self.linha_disponivel(c)}
        return out

    def _tick_sim(self):
        agora = time.time()
        dt = agora - self._sim_t
        self._sim_t = agora
        self.online = True
        self.atualizado_em = now_iso()
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
        dt_agua = 4.5 + 2.0 * carga_predio
        for c in CHILLERS:
            e = self.eq[c]
            sp = e.get("setpoint") or self.geral["setpoint"]
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
                "geral": g, "equipamentos": eqs, "sequencia": self.sequencia_dict(),
                "programacao": {"ativo": bool(self.prog.get("ativo")), "alternancia": bool(self.prog.get("alternancia")),
                                "pico": bool(self.prog["pico"].get("ativo")), "tempos": self.prog["tempos"]},
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
    segundo: Optional[bool] = None


class ProgPeriodo(BaseModel):
    dias: List[int]
    liga: str
    desliga: Optional[str] = None


class ProgPico(BaseModel):
    ativo: bool = False
    periodos: List[ProgPeriodo] = []


class ProgIn(BaseModel):
    ativo: bool
    periodos: List[ProgPeriodo] = []
    alternancia: bool = True
    pico: ProgPico = ProgPico()
    tempos: dict = {}


class RearmarReq(BaseModel):
    chiller: str


class SpReq(BaseModel):
    tipo: str  # agua | dp | chiller
    valor: float
    equipamento: Optional[str] = None


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
    await cag_svc.central(user, modo=req.modo, ligar=req.ligar, lider=req.lider, segundo=req.segundo)
    return cag_svc.to_dict()


@router.post("/cag/sequencia/rearmar")
async def rearmar(req: RearmarReq, user: dict = Depends(get_current_user)):
    _pode_comandar(user)
    c = req.chiller.upper()
    if c not in CHILLERS:
        raise HTTPException(400, "Chiller inválido")
    await cag_svc.rearmar(c, user)
    return cag_svc.to_dict()


def _prog_out() -> dict:
    return {**cag_svc.prog, "semana": cag_svc.semana(), "lider_hoje": cag_svc.geral["lider"]}


@router.get("/cag/programacao")
async def ler_programacao(_: dict = Depends(get_current_user)):
    return _prog_out()


@router.put("/cag/programacao")
async def gravar_programacao(req: ProgIn, user: dict = Depends(require_admin)):
    from agendas import normalizar
    periodos = [{k: v for k, v in p.items() if k != "setpoint"} for p in normalizar(req.periodos)]
    try:
        pico = [{k: v for k, v in p.items() if k != "setpoint"} for p in normalizar(req.pico.periodos)]
    except HTTPException as e:
        raise HTTPException(400, f"Horário de pico — {e.detail}")
    if req.ativo and not periodos:
        raise HTTPException(400, "Programação ativa precisa de pelo menos um período")
    if req.pico.ativo and not pico:
        raise HTTPException(400, "Horário de pico ativo precisa de pelo menos um período")
    tempos = {}
    for k, padrao in TEMPOS_PADRAO.items():
        v = int(req.tempos.get(k, padrao))
        if not TEMPO_FAIXA[0] <= v <= TEMPO_FAIXA[1]:
            raise HTTPException(400, f"Espera após {ETAPA_NOME[k]}: use {TEMPO_FAIXA[0]} a {TEMPO_FAIXA[1]} s")
        tempos[k] = v
    prog = {"ativo": req.ativo, "periodos": periodos, "alternancia": req.alternancia,
            "pico": {"ativo": req.pico.ativo, "periodos": pico}, "tempos": tempos,
            "atualizado_em": now_iso(), "atualizado_por": user.get("email")}
    await cag_svc.salvar_programacao(prog)
    await cag_svc._log(user, None, "PROGRAMACAO", "ativa" if req.ativo else "desativada")
    return _prog_out()


@router.post("/cag/setpoint")
async def setpoint(req: SpReq, user: dict = Depends(get_current_user)):
    _pode_comandar(user)
    if req.tipo not in ("agua", "dp", "chiller"):
        raise HTTPException(400, "Tipo inválido")
    await cag_svc.setpoint(req.tipo, req.valor, user, (req.equipamento or "").upper() or None)
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
