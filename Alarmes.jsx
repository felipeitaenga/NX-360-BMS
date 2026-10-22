import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Siren, CheckCircle2, CheckCheck, Wind, Snowflake, Droplets, Server, BellRing, BellOff, Clock, Search, ExternalLink, Layers,
} from "lucide-react";

const TZ = { timeZone: "America/Sao_Paulo" };
const CATS = [
  { k: "", l: "Todos", icon: Layers },
  { k: "fancoil", l: "Fancoils", icon: Wind },
  { k: "cag", l: "CAG", icon: Snowflake },
  { k: "hidraulica", l: "Hidráulica", icon: Droplets },
  { k: "sistema", l: "Sistema", icon: Server },
];
const CAT_ICON = Object.fromEntries(CATS.map((c) => [c.k, c.icon]));
const PRI = {
  alta: { l: "Alta", c: "#ef4444" },
  media: { l: "Média", c: "#f59e0b" },
  baixa: { l: "Baixa", c: "#38bdf8" },
};
const PERIODOS = [
  { v: "ativos", l: "Ativos" },
  { v: 1, l: "24 h" },
  { v: 7, l: "7 dias" },
  { v: 30, l: "30 dias" },
];

const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { ...TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
function duracao(ini, fim) {
  if (!ini) return "—";
  const s = Math.max(0, (new Date(fim || Date.now()) - new Date(ini)) / 1000);
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}
function detalheExtra(e = {}) {
  const p = [];
  if (e.motivo) p.push(e.motivo);
  if (e.rssi != null) p.push(`RSSI ${e.rssi} dBm`);
  if (e.reset) p.push(`reset: ${e.reset}`);
  if (e.versao) p.push(`versão ${e.versao}`);
  if (e.minutos) p.push(`${e.minutos} min sem efeito`);
  return p.join(" · ");
}

function Kpi({ icon: Icon, label, value, sub, color = "text-foreground", ativo, onClick }) {
  return (
    <Card onClick={onClick} className={`p-3 ${onClick ? "cursor-pointer hover:border-sky-500/50" : ""} ${ativo ? "border-sky-500/60 bg-sky-500/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className={`font-mono font-black text-2xl ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function Status({ a }) {
  if (a.active && !a.acknowledged) return <span className="text-[10px] font-black px-2 py-0.5 rounded-full border text-red-300 border-red-500/50 bg-red-500/15 pulse-red whitespace-nowrap">ATIVO</span>;
  if (a.active) return <span className="text-[10px] font-black px-2 py-0.5 rounded-full border text-amber-300 border-amber-500/50 bg-amber-500/10 whitespace-nowrap">ATIVO · RECONHECIDO</span>;
  return <span className="text-[10px] font-black px-2 py-0.5 rounded-full border text-emerald-300 border-emerald-500/40 bg-emerald-500/10 whitespace-nowrap">NORMALIZADO</span>;
}

function Reconhecido({ a }) {
  if (!a.acknowledged) return null;
  return (
    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
      {a.acknowledged_by_nome || "reconhecido"}{a.acknowledged_at ? ` · ${dataHora(a.acknowledged_at)}` : ""}
    </div>
  );
}

export default function Alarmes() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { alarmsBump } = useTelemetry();
  const podeReconhecer = user?.role !== "viewer";
  const [periodo, setPeriodo] = useState("ativos");
  const [cat, setCat] = useState("");
  const [pri, setPri] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);
  const [busca, setBusca] = useState("");

  const { data: alarms = [], isLoading } = useQuery({
    queryKey: ["alarms", periodo, alarmsBump],
    queryFn: async () => (await api.get("/alarms", { params: periodo === "ativos" ? { active_only: true } : { days: periodo } })).data,
    refetchInterval: 10000,
  });

  const contagem = useMemo(() => {
    const c = { "": alarms.length };
    alarms.forEach((a) => { c[a.categoria] = (c[a.categoria] || 0) + 1; });
    return c;
  }, [alarms]);
  const ativos = alarms.filter((a) => a.active);
  const pendentes = alarms.filter((a) => !a.acknowledged);
  const altas = ativos.filter((a) => a.priority === "alta");

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return alarms
      .filter((a) => (!cat || a.categoria === cat) && (!pri || a.priority === pri) && (!soPendentes || !a.acknowledged))
      .filter((a) => !t || [a.equipamento, a.local, a.label, a.device_id, detalheExtra(a.extra)].join(" ").toLowerCase().includes(t))
      .sort((x, y) => (y.active - x.active) || (x.acknowledged - y.acknowledged) || (y.started_at || "").localeCompare(x.started_at || ""));
  }, [alarms, cat, pri, soPendentes, busca]);

  const atualizar = () => { qc.invalidateQueries({ queryKey: ["alarms"] }); qc.invalidateQueries({ queryKey: ["active-alarms"] }); };
  const ack = async (id) => {
    try { await api.post("/alarms/ack", { alarm_id: id }); toast.success("Alarme reconhecido"); atualizar(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const ackTodos = async () => {
    if (!window.confirm(`Reconhecer ${pendentes.length} alarme(s) pendente(s)?`)) return;
    try { const r = await api.post("/alarms/ack-todos"); toast.success(`${r.data.reconhecidos} alarme(s) reconhecido(s)`); atualizar(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const chip = (on) => `px-3 py-1.5 rounded-md text-xs font-bold border flex items-center gap-1.5 transition-colors ${on ? "bg-sky-500/15 border-sky-500/50 text-sky-200" : "border-border text-muted-foreground hover:bg-muted/40"}`;
  const seg = (on) => `px-3 py-1.5 text-xs font-bold flex items-center gap-1 ${on ? "bg-sky-600 text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5" data-testid="alarms-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-3">
            <Siren className="w-7 h-7 text-red-400" /> Alarmes
          </h1>
          <div className="text-sm text-muted-foreground mt-1">Fancoils, CAG, hidráulica e sistema · atualiza a cada 10 s</div>
        </div>
        {podeReconhecer && (
          <Button variant="outline" disabled={!pendentes.length} onClick={ackTodos} data-testid="alarm-ack-all">
            <CheckCheck className="w-4 h-4 mr-1" /> Reconhecer todos ({pendentes.length})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={BellRing} label="Ativos" value={ativos.length} color={ativos.length ? "text-red-400" : "text-emerald-400"} sub={ativos.length ? "em andamento agora" : "nenhum alarme ativo"} />
        <Kpi icon={BellOff} label="Não reconhecidos" value={pendentes.length} color={pendentes.length ? "text-amber-400" : "text-foreground"}
          sub="clique para filtrar" ativo={soPendentes} onClick={() => setSoPendentes((v) => !v)} />
        <Kpi icon={Siren} label="Prioridade alta" value={altas.length} color={altas.length ? "text-red-400" : "text-foreground"}
          sub="ativos · clique para filtrar" ativo={pri === "alta"} onClick={() => setPri((p) => (p === "alta" ? "" : "alta"))} />
        <Kpi icon={Clock} label="Mais antigo ativo" value={ativos.length ? duracao(ativos.reduce((m, a) => (a.started_at < m ? a.started_at : m), ativos[0].started_at)) : "—"} sub="tempo em alarme" />
      </div>

      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {CATS.map((c) => {
            const Icon = c.icon;
            return (
              <button key={c.k || "todos"} className={chip(cat === c.k)} onClick={() => setCat(c.k)} data-testid={`alarm-cat-${c.k || "todos"}`}>
                <Icon className="w-3.5 h-3.5" />{c.l}
                <span className="font-mono text-[10px] opacity-70">{contagem[c.k] || 0}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <div className="flex rounded-md overflow-hidden border border-border shrink-0 self-start">
            {PERIODOS.map((p) => (
              <button key={p.v} onClick={() => setPeriodo(p.v)} data-testid={`alarm-per-${p.v}`} className={seg(periodo === p.v)}>{p.l}</button>
            ))}
          </div>
          <div className="flex rounded-md overflow-hidden border border-border shrink-0 self-start">
            {["", "alta", "media", "baixa"].map((p) => (
              <button key={p || "todas"} onClick={() => setPri(p)} className={seg(pri === p)}>
                {p && <span className="w-2 h-2 rounded-full" style={{ background: PRI[p].c }} />}{p ? PRI[p].l : "Todas"}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar equipamento, local ou tipo…" className="pl-9 h-9" data-testid="alarm-busca" />
          </div>
        </div>
      </Card>

      {/* tabela no desktop, cartões no celular */}
      <Card className="overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 w-1"></th><th className="px-3 py-2.5">Equipamento</th><th className="px-3 py-2.5">Alarme</th>
                <th className="px-3 py-2.5">Início</th><th className="px-3 py-2.5">Duração</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => {
                const Icon = CAT_ICON[a.categoria] || Layers;
                const p = PRI[a.priority] || PRI.baixa;
                return (
                  <tr key={a.id} className={`border-t border-border ${a.active ? "" : "opacity-70"}`} data-testid={`alarm-row-${a.id}`}>
                    <td className="pl-3 py-2.5"><div className="w-1.5 h-9 rounded-full" style={{ background: p.c }} title={`Prioridade ${p.l}`} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-sky-300" /></div>
                        <div className="min-w-0">
                          <div className="font-display font-bold truncate">{a.equipamento}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{a.local}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div>{a.label}</div>
                      <div className="text-[11px] text-muted-foreground">{[`prioridade ${p.l.toLowerCase()}`, detalheExtra(a.extra)].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{dataHora(a.started_at)}{a.cleared_at && <div className="text-muted-foreground">fim {dataHora(a.cleared_at)}</div>}</td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{duracao(a.started_at, a.cleared_at)}</td>
                    <td className="px-3 py-2.5"><div className="space-y-1"><Status a={a} /><Reconhecido a={a} /></div></td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-2">
                        {a.link && <Button asChild size="sm" variant="ghost" className="h-8"><Link to={a.link} title="Abrir a tela do equipamento"><ExternalLink className="w-4 h-4" /></Link></Button>}
                        {!a.acknowledged && podeReconhecer && (
                          <Button size="sm" variant="outline" className="h-8" onClick={() => ack(a.id)} data-testid={`alarm-ack-${a.id}`}><CheckCircle2 className="w-4 h-4 mr-1" />Reconhecer</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="lg:hidden divide-y divide-border">
          {lista.map((a) => {
            const Icon = CAT_ICON[a.categoria] || Layers;
            const p = PRI[a.priority] || PRI.baixa;
            return (
              <div key={a.id} className={`p-3 space-y-2 border-l-4 ${a.active ? "" : "opacity-75"}`} style={{ borderLeftColor: p.c }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 text-sky-300 shrink-0" />
                    <div className="min-w-0"><div className="font-display font-bold truncate">{a.equipamento}</div><div className="text-[11px] text-muted-foreground truncate">{a.local}</div></div>
                  </div>
                  <Status a={a} />
                </div>
                <div className="text-sm">{a.label}{detalheExtra(a.extra) && <span className="text-muted-foreground text-xs"> · {detalheExtra(a.extra)}</span>}</div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                  <span>{dataHora(a.started_at)} · {duracao(a.started_at, a.cleared_at)}</span>
                  <span>prioridade {p.l.toLowerCase()}</span>
                </div>
                <Reconhecido a={a} />
                <div className="flex gap-2">
                  {!a.acknowledged && podeReconhecer && <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => ack(a.id)}><CheckCircle2 className="w-4 h-4 mr-1" />Reconhecer</Button>}
                  {a.link && <Button asChild size="sm" variant="ghost" className="h-8"><Link to={a.link}><ExternalLink className="w-4 h-4 mr-1" />Abrir</Link></Button>}
                </div>
              </div>
            );
          })}
        </div>

        {!lista.length && (
          <div className="p-10 text-center text-muted-foreground flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            {isLoading ? "Carregando…" : periodo === "ativos" ? "Nenhum alarme ativo." : "Nenhum alarme no período e filtros escolhidos."}
          </div>
        )}
      </Card>
    </div>
  );
}
