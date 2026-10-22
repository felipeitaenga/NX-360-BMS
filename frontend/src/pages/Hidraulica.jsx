import React, { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";
import { Droplets, Bot, Hand, Wifi, WifiOff, Power, PowerOff, Lock, AlertTriangle, FlaskConical, History, ChevronRight, Waves, CloudRain } from "lucide-react";
import HidSinotico, { NIVEL, corNivel, nomesBoias } from "../components/hid/HidSinotico";
import { COR, corEq, estadoTxt } from "../components/cag/CagSinotico";

/* Hidráulica: visão geral + uma tela por sistema (submenus).
   Nível dos reservatórios apenas por boias (baixa / média / alta). */

export const SIS_ROTA = { agua: "POT", esgoto: "ESG", pluvial: "PLU" };
const ROTA_SIS = { POT: "agua", ESG: "esgoto", PLU: "pluvial" };
const ICONE = { POT: Droplets, ESG: Waves, PLU: CloudRain };
const fmtH = (h) => (h == null ? "—" : `${Math.round(h).toLocaleString("pt-BR")} h`);

function useHid() {
  return useQuery({ queryKey: ["hid"], queryFn: async () => (await api.get("/hidraulica")).data, refetchInterval: 2000 });
}

/* 3 segmentos (baixa/média/alta) + texto */
function NivelBoias({ t, compact, detalhe }) {
  const n = NIVEL[t.nivel];
  const cor = corNivel(t);
  const nb = nomesBoias(t.tipo);
  return (
    <div className="flex items-center gap-3" data-testid={`hid-nivel-${t.nome}`}>
      <div className="flex flex-col-reverse gap-0.5 w-6">
        {[["baixa", "1"], ["media", "2"], ["alta", "3"]].map(([k, l]) => (
          <div key={k} title={`Boia ${l}: ${nb[k]} — ${t[k] ? "acionada" : "desacionada"}`} className="h-3 rounded-sm text-[8px] font-black flex items-center justify-center"
            style={{ background: t[k] ? cor : "#1e293b", color: t[k] ? "#020617" : "#475569" }}>{l}</div>
        ))}
      </div>
      <div>
        {!compact && <div className="text-[11px] text-muted-foreground">{t.nome}</div>}
        <div className={`font-display font-black ${compact ? "text-sm" : "text-lg"} ${t.alarme ? "animate-pulse" : ""}`} style={{ color: cor }}>{n.txt}</div>
        {detalhe && <div className="text-[10px] text-muted-foreground">{t.tipo_txt}</div>}
        {t.motivo && <div className="text-[11px] text-red-400 leading-snug mt-0.5">{t.motivo}</div>}
      </div>
    </div>
  );
}

function Header({ titulo, sub, icon: Icon, s, extra }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toggleSim = async (v) => {
    if (!v && !window.confirm("Desligar a simulação? A tela passa a mostrar só os dados reais (TJS/HID/...).")) return;
    try { await api.put("/hidraulica/simulacao", { ativo: v }); qc.invalidateQueries({ queryKey: ["hid"] }); } catch (e) { toast.error(formatApiError(e)); }
  };
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-3"><Icon className="w-7 h-7 text-sky-400" />{titulo}</h1>
        {sub && <div className="text-sm text-muted-foreground mt-1">{sub}</div>}
      </div>
      {s && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {extra}
          {s.simulacao && <span className="px-2 py-1 rounded border border-violet-400/50 text-violet-300 font-bold tracking-widest">SIMULAÇÃO</span>}
          <span className={`flex items-center gap-1 ${s.online ? "text-emerald-400" : "text-red-400"}`}>{s.online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}{s.online ? "online" : "sem comunicação"}</span>
          {user?.role === "admin" && <label className="flex items-center gap-2 text-muted-foreground">Dados simulados <Switch checked={s.simulacao} onCheckedChange={toggleSim} /></label>}
        </div>
      )}
    </div>
  );
}

/* ---------- Visão geral ---------- */
function VisaoGeral({ s }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5" data-testid="hid-geral">
      <Header titulo="Hidráulica" sub="Água potável · esgoto · águas pluviais e reúso — 3 boias por reservatório: baixa (alarme/proteção) · controle · alta (alarme)" icon={Droplets} s={s} />
      {!s ? <Card className="p-10 text-center text-muted-foreground">Carregando…</Card> : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Object.entries(s.sistemas).map(([k, sis]) => {
            const Icon = ICONE[k];
            const alarme = Object.values(sis.tanques).some((t) => t.alarme) || Object.values(sis.bombas).some((b) => b.falha);
            return (
              <Link key={k} to={`/hidraulica/${ROTA_SIS[k]}`} className="block group" data-testid={`hid-card-${k}`}>
                <Card className={`p-4 space-y-4 h-full transition-colors group-hover:border-sky-500/50 ${alarme ? "border-red-500/60" : ""}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-display font-black uppercase tracking-wide flex items-center gap-2"><Icon className="w-5 h-5 text-sky-400" />{sis.nome}</div>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${sis.modo === "AUTO" ? "text-sky-300 border-sky-500/40" : "text-amber-300 border-amber-500/40"}`}>{sis.modo === "AUTO" ? "AUTOMÁTICO" : "MANUAL"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">{Object.entries(sis.tanques).map(([tk, t]) => <NivelBoias key={tk} t={t} />)}</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(sis.bombas).map(([b, e]) => (
                      <span key={b} className="text-[11px] font-bold px-2 py-1 rounded border flex items-center gap-1.5" style={{ color: corEq(e), borderColor: corEq(e) + "66" }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: corEq(e) }} />{b} · {estadoTxt(e)}
                      </span>
                    ))}
                  </div>
                  <div className="text-xs text-sky-300 flex items-center gap-1">Abrir tela <ChevronRight className="w-3.5 h-3.5" /></div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Faceplate da bomba ---------- */
function BombaCard({ id, e, auto, pode, isAdmin, sim, onDone, semVazaoMin = 20 }) {
  const [busy, setBusy] = useState(false);
  const bloqueio = auto ? "Sistema em automático (boias)" : !e.remoto ? "Bomba em LOCAL" : null;
  const cmd = async (ligar) => {
    if (!ligar && !window.confirm(`Desligar ${e.nome}?`)) return;
    setBusy(true);
    try { await api.post("/hidraulica/comando", { bomba: id, ligar }); toast.success(`${e.nome}: ${ligar ? "LIGAR" : "DESLIGAR"} enviado`); onDone(); }
    catch (err) { toast.error(formatApiError(err)); }
    setBusy(false);
  };
  const falha = async (v) => { try { await api.post("/hidraulica/simular-falha", { bomba: id, falha: v }); onDone(); } catch (err) { toast.error(formatApiError(err)); } };
  const c = corEq(e);
  return (
    <Card className="p-3 space-y-2 border-l-4" style={{ borderLeftColor: c }} data-testid={`hid-face-${id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-display font-black text-sm flex items-center gap-1.5">{id}{auto && e.lider && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">PRÓXIMA</span>}</div><div className="text-[11px] text-muted-foreground">{e.nome}</div></div>
        <span className="text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: c, borderColor: c + "88", background: c + "1a" }}>{estadoTxt(e)}</span>
      </div>
      <div className="text-xs divide-y divide-border/50">
        <div className="flex justify-between py-1"><span className="text-muted-foreground">Comando</span><span className="font-mono">{e.remoto ? "Remoto" : <span className="text-amber-400">Local</span>}</span></div>
        <div className="flex justify-between py-1"><span className="text-muted-foreground">Horímetro</span><span className="font-mono">{fmtH(e.horas)}</span></div>
      </div>
      {e.falha && <div className="text-[11px] text-red-400 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />Em falha — verificar no quadro</div>}
      {e.sem_vazao && <div className="text-[11px] text-red-400 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />Ligada há mais de {semVazaoMin} min sem mudar o nível — sem vazão? (rotor, escorva, registro)</div>}
      {pode && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-500" disabled={busy || !!bloqueio || e.falha || (e.status && !e.pendente)} onClick={() => cmd(true)} data-testid={`hid-on-${id}`}><Power className="w-3.5 h-3.5 mr-1" />Ligar</Button>
            <Button size="sm" variant="outline" className="h-8" disabled={busy || !!bloqueio || (!e.status && !e.pendente)} onClick={() => cmd(false)} data-testid={`hid-off-${id}`}><PowerOff className="w-3.5 h-3.5 mr-1" />Desligar</Button>
          </div>
          {bloqueio && <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" />{bloqueio}</div>}
        </>
      )}
      {isAdmin && sim && (
        <label className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border pt-1.5">
          <span className="flex items-center gap-1"><FlaskConical className="w-3 h-3" />Simular falha</span>
          <Switch checked={!!e.falha} onCheckedChange={falha} className="scale-75" />
        </label>
      )}
    </Card>
  );
}

const LOGICA = {
  POT: "Automático: a boia 2 (controle) do superior liga a bomba quando o nível desce e desliga quando enche. Boia 1 do superior = alarme de nível baixo (bomba não está repondo); boia 3 = alarme de nível alto (bomba não desligou). Na cisterna, a boia 1 bloqueia as bombas (proteção a seco) e a boia 3 indica extravasamento. Rodízio a cada partida.",
  ESG: "Automático (lógica invertida): a boia 2 liga uma bomba quando o poço enche e desliga quando esvazia. Boia 3 = nível alto: entra a 2ª bomba e alarma (bomba não está esgotando). Boia 1 = proteção: a bomba desliga para continuar submersa. Rodízio a cada partida.",
  PLU: "Automático: a boia 2 do reúso liga a bomba quando o nível desce e desliga quando enche. Boia 1 do reúso = alarme de nível baixo (bomba não está repondo); boia 3 = nível alto (bomba não desligou). Na captação, a boia 1 bloqueia as bombas (proteção a seco) e a boia 3 indica extravasamento. Rodízio a cada partida.",
};

function Historico({ sistema }) {
  const { data = [] } = useQuery({ queryKey: ["hid-log", sistema], queryFn: async () => (await api.get("/hidraulica/log", { params: { sistema, limit: 15 } })).data, refetchInterval: 5000 });
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b border-border font-display text-sm uppercase tracking-widest flex items-center gap-2"><History className="w-4 h-4" />Últimos comandos</div>
      <div className="overflow-x-auto max-h-64">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left"><tr><th className="p-2">Data/hora</th><th className="p-2">Usuário</th><th className="p-2">Alvo</th><th className="p-2">Ação</th></tr></thead>
          <tbody>
            {data.map((l, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="p-2 font-mono whitespace-nowrap">{new Date(l.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className="p-2">{l.user_id}</td><td className="p-2 font-mono">{(l.device_id || "").replace("HID/", "")}</td>
                <td className="p-2 font-bold">{l.acao}{l.simulacao && <span className="ml-1 text-violet-300 font-normal">(sim.)</span>}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Nenhum comando ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Tela de um sistema ---------- */
function Sistema({ k, s }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const pode = user?.role !== "viewer";
  const isAdmin = user?.role === "admin";
  const [sel, setSel] = useState(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["hid"] }); qc.invalidateQueries({ queryKey: ["hid-log"] }); };
  const sis = s?.sistemas?.[k];
  const auto = sis?.modo === "AUTO";
  const mudarModo = async (m) => {
    if (m === sis.modo) return;
    if (!window.confirm(m === "MANUAL" ? "Passar para MANUAL? As boias deixam de comandar as bombas — elas passam a ser ligadas/desligadas aqui." : "Passar para AUTOMÁTICO? As boias voltam a comandar as bombas.")) return;
    try { await api.post("/hidraulica/modo", { sistema: k, modo: m }); toast.success(`${sis.nome}: ${m === "AUTO" ? "AUTOMÁTICO" : "MANUAL"}`); refresh(); } catch (e) { toast.error(formatApiError(e)); }
  };
  const seg = (a) => `flex-1 px-3 py-2 text-sm font-bold flex items-center justify-center gap-1.5 ${a ? "bg-sky-600 text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"} disabled:opacity-60`;
  const Icon = ICONE[k];
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5" data-testid={`hid-sistema-${k}`}>
      <Header titulo={sis?.nome || "Hidráulica"} sub="Boia 1 baixa (alarme/proteção) · boia 2 controle da bomba · boia 3 alta (alarme)" icon={Icon} s={s}
        extra={sis && <span className={`px-2 py-1 rounded border font-bold tracking-widest flex items-center gap-1 ${auto ? "border-sky-500/50 text-sky-300" : "border-amber-500/50 text-amber-300"}`}>{auto ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}{auto ? "AUTOMÁTICO" : "MANUAL"}</span>} />
      {!sis ? <Card className="p-10 text-center text-muted-foreground">Carregando…</Card> : (
        <>
          <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <Card className="p-2 sm:p-3 overflow-hidden">
              <div className="overflow-x-auto"><HidSinotico sistema={k} s={sis} sel={sel} onSel={setSel} /></div>
              <div className="flex flex-wrap gap-4 justify-center text-[11px] text-muted-foreground mt-1">
                {[["Ligada / boia acionada", COR.on], ["Desligada", COR.off], ["Partindo/parando", COR.pend], ["Falha / alarme", COR.falha]].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{l}</span>
                ))}
              </div>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-1 gap-4 content-start">
              <Card className="p-4 space-y-3">
                <div className="font-display text-sm uppercase tracking-widest">Modo</div>
                <div className="flex rounded-md overflow-hidden border border-border">
                  <button className={seg(auto)} disabled={!pode} onClick={() => mudarModo("AUTO")} data-testid="hid-modo-auto"><Bot className="w-4 h-4" />Automático</button>
                  <button className={seg(!auto)} disabled={!pode} onClick={() => mudarModo("MANUAL")} data-testid="hid-modo-manual"><Hand className="w-4 h-4" />Manual</button>
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed">{auto ? LOGICA[k] : "Manual: ligue e desligue as bombas abaixo. A proteção contra funcionamento a seco continua ativa."}</div>
              </Card>
              <Card className="p-4 space-y-3">
                <div className="font-display text-sm uppercase tracking-widest">Reservatórios</div>
                {Object.entries(sis.tanques).map(([tk, t]) => <NivelBoias key={tk} t={t} detalhe />)}
                <div className="text-[10px] text-muted-foreground border-t border-border pt-2">Boia 1 = baixa · Boia 2 = controle da bomba · Boia 3 = alta</div>
              </Card>
            </div>
          </div>
          <section className="space-y-2">
            <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">Bombas</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {Object.entries(sis.bombas).map(([b, e]) => <BombaCard key={b} id={b} e={e} auto={auto} pode={pode} isAdmin={isAdmin} sim={s.simulacao} onDone={refresh} semVazaoMin={s.sem_vazao_min} />)}
            </div>
          </section>
          <Historico sistema={k} />
        </>
      )}
    </div>
  );
}

export default function Hidraulica() {
  const { sistema } = useParams();
  const { data: s } = useHid();
  if (!sistema) return <VisaoGeral s={s} />;
  const k = SIS_ROTA[sistema];
  if (!k) return <Navigate to="/hidraulica" replace />;
  return <Sistema k={k} s={s} />;
}
