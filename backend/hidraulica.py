"""Hidráulica (v1.16.1): água potável, esgoto e águas pluviais/reúso.

Nível só por 3 BOIAS por reservatório:
  boia 1 (baixa)  → ALARME / proteção (ponta de baixo)
  boia 2 (média)  → CONTROLE da bomba (boia pendular, com faixa liga/desliga própria)
  boia 3 (alta)   → ALARME (ponta de cima)

A lógica depende do TIPO do reservatório:
  ABASTECIDO   (enchido pela bomba: SUP, REU)
      boia 2 abaixo → liga · acima → desliga
      boia 1 desacionada → alarme NÍVEL BAIXO: bomba não está repondo (falha provável da bomba)
      boia 3 acionada    → alarme NÍVEL ALTO: bomba não desligou (contator/boia 2)
  FONTE        (de onde a bomba tira: CIS, CAP)
      boia 1 desacionada → proteção a seco: bloqueia as bombas + alarme
      boia 3 acionada    → alarme EXTRAVASANDO (boia de entrada / ladrão)
  ESGOTAMENTO  (esvaziado pela bomba: POCO) — lógica invertida
      boia 2 acima → liga · abaixo → desliga
      boia 3 acionada    → liga a 2ª bomba + alarme NÍVEL ALTO (bomba não está esgotando)
      boia 1 desacionada → desliga (submersa precisa ficar coberta); bomba ainda ligada → alarme
Extras: FALHA DE BOIA (combinação impossível) e BOMBA SEM VAZÃO (ligada há mais de
SEM_VAZAO_MIN minutos sem a boia 2 mudar) → alarme e troca para a bomba reserva.

Contrato MQTT (prefixo TJS, "device" HID) — docs/HIDRAULICA_MQTT.md
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

logger = logging.getLogger("hidraulica")
router = APIRouter(prefix="/api")

# controle: reservatório cuja boia 2 comanda as bombas · fonte: reservatório de onde elas tiram
SISTEMAS = {
    "POT": {"nome": "Água potável", "tanques": ["CIS", "SUP"], "bombas": ["BR1", "BR2"], "controle": "SUP", "fonte": "CIS"},
    "ESG": {"nome": "Esgoto", "tanques": ["POCO"], "bombas": ["BE1", "BE2"], "controle": "POCO", "fonte": None},
    "PLU": {"nome": "Águas pluviais / reúso", "tanques": ["CAP", "REU"], "bombas": ["BP1", "BP2"], "controle": "REU", "fonte": "CAP"},
}
TIPO = {"CIS": "fonte", "SUP": "abastecido", "POCO": "esgotamento", "CAP": "fonte", "REU": "abastecido"}
TIPO_TXT = {"fonte": "Fonte das bombas", "abastecido": "Abastecido pela bomba", "esgotamento": "Esgotado pela bomba"}
NOMES = {"CIS": "Reservatório inferior (cisterna)", "SUP": "Reservatório superior", "POCO": "Poço de esgoto",
         "CAP": "Reservatório de captação", "REU": "Reservatório de reúso",
         "BR1": "Bomba de recalque 1", "BR2": "Bomba de recalque 2",
         "BE1": "Bomba de esgoto 1", "BE2": "Bomba de esgoto 2",
         "BP1": "Bomba de reúso 1", "BP2": "Bomba de reúso 2"}
TANQUES = [t for s in SISTEMAS.values() for t in s["tanques"]]
BOMBAS = [b for s in SISTEMAS.values() for b in s["bombas"]]
SIS_DE = {x: k for k, s in SISTEMAS.items() for x in s["tanques"] + s["bombas"]}
SEM_VAZAO_MIN = 20  # min com a bomba ligada sem a boia 2 mudar → "bomba sem vazão"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _b(p: str) -> bool:
    return p.strip().lower() in ("1", "true", "on", "ligado")


def nivel_de(t: dict) -> str:
    """baixo · normal_inf (entre boia 1 e 2) · normal_sup (entre 2 e 3) · alto · falha_boia"""
    b, m, a = t["baixa"], t["media"], t["alta"]
    if (a and not m) or (a and not b) or (m and not b):
        return "falha_boia"
    if a:
        return "alto"
    if m:
        return "normal_sup"
    if b:
        return "normal_inf"
    return "baixo"


class HidService:
    def __init__(self):
        self.simulacao = True
        self.online = False
        self.atualizado_em: Optional[str] = None
        self.modo = {k: "AUTO" for k in SISTEMAS}
        self.tq = {t: {"baixa": False, "media": False, "alta": False} for t in TANQUES}
        self.bb = {b: {"status": False, "falha": False, "remoto": True, "horas": 0.0, "cmd": None, "cmd_at": None,
                       "sem_vazao": False} for b in BOMBAS}
        self._lider = {k: SISTEMAS[k]["bombas"][0] for k in SISTEMAS}
        self._ligou_em: dict = {}          # bomba -> instante em que começou a rodar
        self._b2_mudou: dict = {}          # tanque -> instante da última mudança da boia 2
        self._sim_nivel: dict = {}
        self._mov: dict = {}
        self._task: Optional[asyncio.Task] = None
        self._t = time.time()

    async def start(self):
        s = await db.settings.find_one({"_id": "global"}) or {}
        self.simulacao = s.get("hid_simulacao", True)
        if self.simulacao:
            self._seed_sim()
        if not self._task:
            self._task = asyncio.create_task(self._loop())

    def _seed_sim(self):
        self.online = True
        rnd = random.Random(7)
        self._sim_nivel = {"CIS": 70.0, "SUP": 50.0, "POCO": 40.0, "CAP": 55.0, "REU": 35.0}
        for b in BOMBAS:
            self.bb[b].update(status=False, falha=False, remoto=True, cmd=False, sem_vazao=False,
                              horas=float(rnd.randint(800, 9000)))
        self.modo = {k: "AUTO" for k in SISTEMAS}
        self._mov.clear()
        self._ligou_em.clear()
        for t in TANQUES:
            self.tq[t] = {"baixa": False, "media": False, "alta": False}
        self._boias_sim()

    async def _loop(self):
        while True:
            try:
                await asyncio.sleep(2)
                if self.simulacao:
                    self._tick_sim()
                self._vigiar_vazao()
                await self._alarmes()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("HID loop")

    # ---------- MQTT ----------
    async def handle(self, var: str, payload: str):
        if self.simulacao:
            return
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
        if alvo in SISTEMAS and campo == "MODO":
            self.modo[alvo] = "MANUAL" if p.upper().startswith("MAN") else "AUTO"
        elif alvo in self.tq and campo in ("BOIA_BAIXA", "BOIA_MEDIA", "BOIA_ALTA"):
            k = campo.split("_")[1].lower()
            if k == "media" and self.tq[alvo]["media"] != _b(p):
                self._b2_mudou[alvo] = time.time()
            self.tq[alvo][k] = _b(p)
        elif alvo in self.bb:
            if campo == "STATUS":
                novo = _b(p)
                if novo and not self.bb[alvo]["status"]:
                    self._ligou_em[alvo] = time.time()
                self.bb[alvo]["status"] = novo
            elif campo in ("FALHA", "REMOTO"):
                self.bb[alvo][campo.lower()] = _b(p)
            elif campo == "HORAS":
                try:
                    self.bb[alvo]["horas"] = float(p)
                except ValueError:
                    pass

    def _publish(self, sub: str, valor: str) -> bool:
        from mqtt_service import svc
        if svc._client and svc.connected:
            svc._client.publish(f"{svc.topic_prefix}/HID/{sub}", valor, qos=1, retain=True)
            return True
        return False

    async def _log(self, user: dict, alvo: str, acao: str):
        await db.command_log.insert_one({"device_id": f"HID/{alvo}", "user_id": user.get("email"), "kind": "HID",
                                         "acao": acao, "timestamp": now_iso(), "simulacao": self.simulacao})

    # ---------- comandos ----------
    async def comandar(self, bomba: str, ligar: bool, user: dict):
        sis = SIS_DE[bomba]
        e = self.bb[bomba]
        if self.modo[sis] == "AUTO":
            raise HTTPException(400, "Sistema em AUTOMÁTICO (comandado pelas boias) — passe para MANUAL para comandar a bomba")
        if not e["remoto"]:
            raise HTTPException(400, f"{NOMES[bomba]} está em LOCAL — comando só no quadro")
        if ligar and e["falha"]:
            raise HTTPException(400, f"{NOMES[bomba]} está em falha — reconheça no quadro antes")
        if ligar:
            fonte = SISTEMAS[sis]["fonte"]
            if fonte and not self.tq[fonte]["baixa"]:
                raise HTTPException(400, f"{NOMES[fonte]} em nível BAIXO — bomba protegida contra funcionamento a seco")
            if TIPO[SISTEMAS[sis]["controle"]] == "esgotamento" and not self.tq[SISTEMAS[sis]["controle"]]["baixa"]:
                raise HTTPException(400, "Poço abaixo da boia baixa — a bomba submersa precisa ficar coberta")
        e["cmd"], e["cmd_at"] = ligar, now_iso()
        if self.simulacao:
            self._mov[bomba] = time.time()
        elif not self._publish(f"{bomba}/CMD/SET", "true" if ligar else "false"):
            raise HTTPException(503, "Sem conexão com o broker MQTT")
        await self._log(user, bomba, "LIGAR" if ligar else "DESLIGAR")

    async def set_modo(self, sis: str, modo: str, user: dict):
        if not self.simulacao and not self._publish(f"{sis}/MODO/SET", modo):
            raise HTTPException(503, "Sem conexão com o broker MQTT")
        self.modo[sis] = modo
        if modo == "MANUAL":
            for b in SISTEMAS[sis]["bombas"]:
                self.bb[b]["cmd"] = self.bb[b]["status"]
        await self._log(user, sis, f"MODO {modo}")

    # ---------- bomba sem vazão (vale para dados reais e simulados) ----------
    def _vigiar_vazao(self):
        agora = time.time()
        for sis, cfg in SISTEMAS.items():
            ctl = cfg["controle"]
            for b in cfg["bombas"]:
                e = self.bb[b]
                if not e["status"]:
                    self._ligou_em.pop(b, None)
                    continue
                t0 = self._ligou_em.setdefault(b, agora)
                desde = max(t0, self._b2_mudou.get(ctl, 0))
                e["sem_vazao"] = (agora - desde) > SEM_VAZAO_MIN * 60
                if e["sem_vazao"] and self.modo[sis] == "AUTO":
                    outros = [x for x in cfg["bombas"] if x != b and not self.bb[x]["falha"] and not self.bb[x]["sem_vazao"]]
                    if outros:
                        self._lider[sis] = outros[0]

    # ---------- simulação ----------
    def _boias_sim(self):
        """boia 1 e 3 em ponto fixo; boia 2 pendular com faixa 45–55 %."""
        for t, n in self._sim_nivel.items():
            q = self.tq[t]
            media = q["media"]
            if n >= 55:
                media = True
            elif n <= 45:
                media = False
            if media != q["media"]:
                self._b2_mudou[t] = time.time()
            self.tq[t] = {"baixa": n >= 20, "media": media, "alta": n >= 85}

    def _auto(self, sis: str, ligar_n: int):
        bombas = [b for b in SISTEMAS[sis]["bombas"] if not self.bb[b]["falha"]]
        lider = self._lider[sis] if self._lider[sis] in bombas else (bombas[0] if bombas else None)
        ordem = ([lider] if lider else []) + [b for b in bombas if b != lider]
        desejo = {b: (i < ligar_n) for i, b in enumerate(ordem)}
        for b in SISTEMAS[sis]["bombas"]:
            alvo = desejo.get(b, False)
            if self.bb[b]["cmd"] != alvo:
                if not alvo and self.bb[b]["status"] and b == lider:  # rodízio a cada parada
                    outros = [x for x in bombas if x != lider]
                    if outros:
                        self._lider[sis] = outros[0]
                self.bb[b]["cmd"], self.bb[b]["cmd_at"] = alvo, now_iso()
                self._mov[b] = time.time()

    def _logica_auto(self):
        """Papel da controladora em AUTOMÁTICO (usado na simulação)."""
        for sis, cfg in SISTEMAS.items():
            if self.modo[sis] != "AUTO":
                continue
            ctl, fonte = self.tq[cfg["controle"]], cfg["fonte"]
            rodando = sum(self.bb[b]["status"] for b in cfg["bombas"])
            if TIPO[cfg["controle"]] == "esgotamento":
                if not ctl["baixa"]:
                    self._auto(sis, 0)                       # proteção: submersa coberta
                elif ctl["alta"]:
                    self._auto(sis, 2)                       # reserva entra junto
                elif ctl["media"]:
                    self._auto(sis, max(1, rodando))
                else:
                    self._auto(sis, 0)
            else:                                            # abastecido
                if fonte and not self.tq[fonte]["baixa"]:
                    self._auto(sis, 0)                       # proteção a seco
                elif ctl["alta"] or ctl["media"]:
                    self._auto(sis, 0)
                else:
                    self._auto(sis, 1)

    def _tick_sim(self):
        agora = time.time()
        dt = agora - self._t
        self._t = agora
        self.online = True
        self.atualizado_em = now_iso()
        self._logica_auto()
        for b in BOMBAS:
            if b in self._mov and agora - self._mov[b] >= 3:
                novo = bool(self.bb[b]["cmd"]) and not self.bb[b]["falha"]
                if novo and not self.bb[b]["status"]:
                    self._ligou_em[b] = agora
                self.bb[b]["status"] = novo
                self._mov.pop(b, None)
        for sis, cfg in SISTEMAS.items():  # proteção a seco também em MANUAL
            fonte = cfg["fonte"]
            if fonte and self._sim_nivel[fonte] < 3:
                for b in cfg["bombas"]:
                    self.bb[b]["status"] = False
        for b in BOMBAS:
            if self.bb[b]["status"]:
                self.bb[b]["horas"] += dt / 3600
        N = self._sim_nivel
        rod = lambda s: sum(self.bb[b]["status"] for b in SISTEMAS[s]["bombas"])  # noqa: E731
        h = (datetime.now(timezone.utc).hour - 3) % 24
        uso = 0.5 + 0.5 * max(0, math.sin((h - 6) / 16 * math.pi))
        N["CIS"] += (0.7 if N["CIS"] < 78 else 0) - 1.4 * rod("POT")   # boia de entrada fecha ~78 %
        N["SUP"] += 2.0 * rod("POT") - uso
        N["POCO"] += 0.9 + random.uniform(-.2, .3) - 2.0 * rod("ESG")
        chuva = 0.6 if (int(time.time() / 600) % 3 == 0) else 0.05
        N["CAP"] += (chuva if N["CAP"] < 82 else 0) - 1.0 * rod("PLU")
        N["REU"] += 1.8 * rod("PLU") - 0.4 * uso
        for t in N:
            N[t] = max(0.0, min(100.0, N[t]))
        self._boias_sim()

    # ---------- alarmes ----------
    def _motivos(self) -> dict:
        """tanque -> (tipo_alarme, mensagem) ou None"""
        out = {}
        for t in TANQUES:
            q, tipo, n = self.tq[t], TIPO[t], nivel_de(self.tq[t])
            sis = SIS_DE[t]
            rodando = any(self.bb[b]["status"] for b in SISTEMAS[sis]["bombas"])
            m = None
            if n == "falha_boia":
                m = ("HID_BOIA", "Combinação de boias impossível — verificar boias e fiação")
            elif tipo == "abastecido":
                if not q["baixa"]:
                    m = ("HID_NIVEL_BAIXO", "Nível baixo — a bomba não está repondo (verificar bomba)")
                elif q["alta"]:
                    m = ("HID_NIVEL_ALTO", "Nível alto — a bomba não desligou (contator ou boia de controle)")
            elif tipo == "fonte":
                if not q["baixa"]:
                    m = ("HID_NIVEL_BAIXO", "Nível baixo — bombas bloqueadas (proteção a seco)")
                elif q["alta"]:
                    m = ("HID_NIVEL_ALTO", "Extravasando — verificar boia de entrada / ladrão")
            elif tipo == "esgotamento":
                if q["alta"]:
                    m = ("HID_NIVEL_ALTO", "Nível alto — bomba não está esgotando (risco de transbordo)")
                elif not q["baixa"] and rodando:
                    m = ("HID_NIVEL_BAIXO", "Bomba ligada abaixo da boia baixa — verificar contator")
            out[t] = m
        return out

    async def _alarmes(self):
        from alarms import raise_alarm, clear_alarm
        mot = self._motivos() if self.online else {t: None for t in TANQUES}
        for t, m in mot.items():
            did = f"HID/{t}"
            for tipo in ("HID_BOIA", "HID_NIVEL_BAIXO", "HID_NIVEL_ALTO", "HID_NIVEL"):
                if m and m[0] == tipo:
                    await raise_alarm(did, tipo, {"reservatorio": NOMES[t], "motivo": m[1]})
                else:
                    await clear_alarm(did, tipo)
        for b in BOMBAS:
            did = f"HID/{b}"
            if self.bb[b]["falha"]:
                await raise_alarm(did, "HID_FALHA", {"bomba": NOMES[b]})
            else:
                await clear_alarm(did, "HID_FALHA")
            if self.bb[b]["sem_vazao"]:
                await raise_alarm(did, "HID_SEM_VAZAO", {"bomba": NOMES[b], "minutos": SEM_VAZAO_MIN})
            else:
                await clear_alarm(did, "HID_SEM_VAZAO")

    # ---------- saída ----------
    def to_dict(self) -> dict:
        mot = self._motivos() if self.online else {}
        sis = {}
        for k, s in SISTEMAS.items():
            ok = [b for b in s["bombas"] if not self.bb[b]["falha"]]
            lider = self._lider[k] if self._lider[k] in ok else (ok[0] if ok else None)
            sis[k] = {
                "nome": s["nome"], "modo": self.modo[k], "controle": s["controle"], "fonte": s["fonte"],
                "tanques": {t: {**self.tq[t], "nome": NOMES[t], "tipo": TIPO[t], "tipo_txt": TIPO_TXT[TIPO[t]],
                                "nivel": nivel_de(self.tq[t]), "alarme": bool(mot.get(t)),
                                "motivo": mot[t][1] if mot.get(t) else None}
                            for t in s["tanques"]},
                "bombas": {b: {**self.bb[b], "nome": NOMES[b], "horas": round(self.bb[b]["horas"], 1),
                               "pendente": self.bb[b]["cmd"] is not None and self.bb[b]["cmd"] != self.bb[b]["status"] and not self.bb[b]["falha"],
                               "lider": lider == b}
                           for b in s["bombas"]},
            }
        return {"simulacao": self.simulacao, "online": self.online, "atualizado_em": self.atualizado_em,
                "sem_vazao_min": SEM_VAZAO_MIN, "sistemas": sis}


hid_svc = HidService()


class CmdReq(BaseModel):
    bomba: str
    ligar: bool


class ModoReq(BaseModel):
    sistema: str
    modo: str


class SimReq(BaseModel):
    ativo: bool


class FalhaReq(BaseModel):
    bomba: str
    falha: bool


def _pode(user: dict):
    if user.get("role") == "viewer":
        raise HTTPException(403, "Visualizador não pode comandar a hidráulica")


@router.get("/hidraulica")
async def estado(_: dict = Depends(get_current_user)):
    return hid_svc.to_dict()


@router.post("/hidraulica/comando")
async def comando(req: CmdReq, user: dict = Depends(get_current_user)):
    _pode(user)
    b = req.bomba.upper()
    if b not in BOMBAS:
        raise HTTPException(400, "Bomba inválida")
    await hid_svc.comandar(b, req.ligar, user)
    return hid_svc.to_dict()


@router.post("/hidraulica/modo")
async def modo(req: ModoReq, user: dict = Depends(get_current_user)):
    _pode(user)
    s, m = req.sistema.upper(), req.modo.upper()
    if s not in SISTEMAS or m not in ("AUTO", "MANUAL"):
        raise HTTPException(400, "Sistema ou modo inválido")
    await hid_svc.set_modo(s, m, user)
    return hid_svc.to_dict()


@router.get("/hidraulica/log")
async def historico(sistema: str = "", limit: int = 20, _: dict = Depends(get_current_user)):
    q = {"kind": "HID"}
    if sistema.upper() in SISTEMAS:
        alvos = [f"HID/{x}" for x in [sistema.upper()] + SISTEMAS[sistema.upper()]["bombas"]]
        q["device_id"] = {"$in": alvos}
    cur = db.command_log.find(q, {"_id": 0}).sort("timestamp", -1).limit(min(limit, 200))
    return [d async for d in cur]


@router.put("/hidraulica/simulacao")
async def simulacao(req: SimReq, _: dict = Depends(require_admin)):
    await db.settings.update_one({"_id": "global"}, {"$set": {"hid_simulacao": req.ativo}}, upsert=True)
    hid_svc.simulacao = req.ativo
    if req.ativo:
        hid_svc._seed_sim()
    else:
        hid_svc.online = False
    return hid_svc.to_dict()


@router.post("/hidraulica/simular-falha")
async def simular_falha(req: FalhaReq, _: dict = Depends(require_admin)):
    if not hid_svc.simulacao:
        raise HTTPException(400, "Disponível só no modo simulação")
    b = req.bomba.upper()
    if b not in BOMBAS:
        raise HTTPException(400, "Bomba inválida")
    hid_svc.bb[b]["falha"] = req.falha
    if req.falha:
        hid_svc.bb[b].update(status=False, cmd=False)
    return hid_svc.to_dict()
