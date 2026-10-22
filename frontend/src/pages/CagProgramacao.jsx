import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";
import { Clock, Save, Repeat, Zap, ListOrdered, CalendarDays, Info, Snowflake } from "lucide-react";
import { PeriodsEditor } from "./ProgramacaoHoraria";

const toMin = (h) => { const [a, b] = String(h || "0:0").split(":").map(Number); return a * 60 + b; };
const novoGeral = () => ({ dias: [1, 2, 3, 4, 5], liga: "07:00", desliga: "19:00", setpoint: null });
const novoPico = () => ({ dias: [1, 2, 3, 4, 5], liga: "13:00", desliga: "17:00", setpoint: null });
const COR_CH = { CH1: "#38bdf8", CH2: "#a78bfa" };
const ETAPAS = [
  { k: "valvula", l: "Abre a válvula do chiller", d: "espera" },
  { k: "primaria", l: "Liga a bomba primária", d: "espera" },
  { k: "secundaria", l: "Liga a bomba secundária", d: "espera" },
];

function Secao({ icon: Icon, titulo, sub, direita, children }) {
  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
          <div>
            <div className="font-display text-sm uppercase tracking-widest">{titulo}</div>
            {sub && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{sub}</div>}
          </div>
        </div>
        {direita}
      </div>
      {children}
    </Card>
  );
}

/* Próximos 7 dias: barra do período geral com a cor do líder + faixa do pico (2 chillers) */
function Semana({ semana }) {
  return (
    <div className="space-y-1.5" data-testid="cag-prog-semana">
      {semana.map((d, i) => (
        <div key={d.data} className="flex items-center gap-2">
          <div className="w-16 shrink-0 text-[11px] font-mono text-muted-foreground">{i === 0 ? "Hoje" : d.dia} <span className="opacity-60">{d.data.slice(8, 10)}/{d.data.slice(5, 7)}</span></div>
          <div className="w-10 shrink-0 text-[11px] font-black text-center rounded" style={{ color: COR_CH[d.lider], background: COR_CH[d.lider] + "1f" }}>{d.lider}</div>
          <div className="relative flex-1 h-6 rounded bg-muted/50 overflow-hidden">
            {[6, 12, 18].map((h) => <div key={h} className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `${(h / 24) * 100}%` }} />)}
            {d.geral.map(([a, b], j) => (
              <div key={`g${j}`} className="absolute top-0 bottom-0 rounded" title={`${d.lider}: ${a}–${b}`}
                style={{ left: `${(toMin(a) / 1440) * 100}%`, width: `${((toMin(b) - toMin(a)) / 1440) * 100}%`, background: COR_CH[d.lider] + "99" }} />
            ))}
            {d.pico.map(([a, b], j) => {
              // pico só vale dentro do período geral
              return d.geral.map(([ga, gb], k) => {
                const ini = Math.max(toMin(a), toMin(ga)), fim = Math.min(toMin(b), toMin(gb));
                if (fim <= ini) return null;
                return (
                  <div key={`p${j}${k}`} className="absolute bottom-0 h-2.5 rounded-sm bg-amber-400" title={`Pico (2 chillers): ${a}–${b}`}
                    style={{ left: `${(ini / 1440) * 100}%`, width: `${((fim - ini) / 1440) * 100}%` }} />
                );
              });
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-between pl-[6.5rem] text-[10px] font-mono text-muted-foreground"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground pt-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: COR_CH.CH1 + "99" }} />CH1 líder</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: COR_CH.CH2 + "99" }} />CH2 líder</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-sm bg-amber-400" />Pico — os dois chillers</span>
      </div>
    </div>
  );
}

export default function CagProgramacao() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["cag-prog"], queryFn: async () => (await api.get("/cag/programacao")).data, refetchInterval: 60000 });
  const [f, setF] = useState(null);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (data && !sujo) setF({ ativo: data.ativo, periodos: data.periodos, alternancia: data.alternancia, pico: data.pico, tempos: data.tempos });
  }, [data, sujo]);

  if (!f) return <Card className="p-10 text-center text-muted-foreground">Carregando…</Card>;
  const set = (patch) => { setF((p) => ({ ...p, ...patch })); setSujo(true); };
  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await api.put("/cag/programacao", f);
      qc.setQueryData(["cag-prog"], r.data); setSujo(false);
      toast.success("Programação da CAG salva");
    } catch (err) { toast.error(formatApiError(err)); }
    setSalvando(false);
  };
  const total = ETAPAS.reduce((a, e) => a + Number(f.tempos[e.k] || 0), 0);
  const amanha = data?.semana?.[1]?.lider;

  return (
    <div className="space-y-5 max-w-6xl" data-testid="cag-programacao">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Snowflake className="w-3.5 h-3.5" />CAG</div>
          <h1 className="font-display text-2xl font-black">Programação horária</h1>
          <p className="text-sm text-muted-foreground">Partida e parada automática da central, alternância dos chillers e reforço no horário de pico.</p>
        </div>
        {isAdmin && (
          <Button onClick={salvar} disabled={!sujo || salvando} className="bg-sky-600 hover:bg-sky-500" data-testid="cag-prog-salvar">
            <Save className="w-4 h-4 mr-1" />{salvando ? "Salvando…" : sujo ? "Salvar alterações" : "Salvo"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5">
        <div className="space-y-5 min-w-0">
          <Secao icon={Clock} titulo="Programação geral"
            sub="Dentro destes horários a central parte com o chiller líder; fora deles, para. Só atua com a central em AUTOMÁTICO."
            direita={<label className="flex items-center gap-2 text-xs font-bold">{f.ativo ? <span className="text-emerald-400">ATIVA</span> : <span className="text-muted-foreground">DESLIGADA</span>}
              <Switch checked={f.ativo} disabled={!isAdmin} onCheckedChange={(v) => set({ ativo: v })} data-testid="cag-prog-ativo" /></label>}>
            <div className={f.ativo ? "" : "opacity-60"}>
              <PeriodsEditor value={f.periodos} onChange={(v) => set({ periodos: v })} readOnly={!isAdmin} semSetpoint novo={novoGeral}
                vazio="Nenhum período — a central só parte pelos botões Partir/Parar." />
            </div>
          </Secao>

          <Secao icon={Zap} titulo="Horário de pico — 2º chiller"
            sub="Liga o outro chiller junto com o líder (sequência completa: válvula, bombas e chiller). Só vale dentro da programação geral."
            direita={<Switch checked={!!f.pico.ativo} disabled={!isAdmin} onCheckedChange={(v) => set({ pico: { ...f.pico, ativo: v } })} data-testid="cag-prog-pico" />}>
            <div className={f.pico.ativo ? "" : "opacity-60"}>
              <PeriodsEditor value={f.pico.periodos} onChange={(v) => set({ pico: { ...f.pico, periodos: v } })} readOnly={!isAdmin} semSetpoint novo={novoPico}
                vazio="Nenhum horário de pico." />
            </div>
          </Secao>
        </div>

        <div className="space-y-5 min-w-0">
          <Secao icon={Repeat} titulo="Alternância dos chillers"
            sub="Um dia parte o Chiller 1, no outro o Chiller 2 — equaliza as horas de uso. A troca acontece à meia-noite sem parar a central: o novo líder parte e o antigo só para quando o novo estiver rodando."
            direita={<Switch checked={f.alternancia} disabled={!isAdmin} onCheckedChange={(v) => set({ alternancia: v })} data-testid="cag-prog-alt" />}>
            {f.alternancia ? (
              <div className="grid grid-cols-2 gap-2 text-center">
                {[["Hoje", data?.semana?.[0]?.lider], ["Amanhã", amanha]].map(([l, c]) => (
                  <div key={l} className="rounded-md border border-border p-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{l}</div>
                    <div className="font-display text-xl font-black" style={{ color: COR_CH[c] }}>{c || "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />Sem alternância o líder é o escolhido na tela de comandos da CAG (atual: <b className="text-foreground">{data?.lider_hoje}</b>).</div>
            )}
          </Secao>

          <Secao icon={ListOrdered} titulo="Sequência de partida"
            sub="Executada pelo NX-360 em cada linha de chiller. A parada é a ordem inversa, com as mesmas esperas.">
            <ol className="space-y-2">
              {ETAPAS.map((e, i) => (
                <li key={e.k} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-sm flex-1">{e.l}</span>
                  <span className="text-[10px] text-muted-foreground">espera</span>
                  <Input type="number" min="5" max="900" className="w-20 h-8 text-right font-mono" disabled={!isAdmin}
                    value={f.tempos[e.k]} onChange={(ev) => set({ tempos: { ...f.tempos, [e.k]: ev.target.value === "" ? "" : Number(ev.target.value) } })} data-testid={`cag-tempo-${e.k}`} />
                  <span className="text-xs text-muted-foreground w-3">s</span>
                </li>
              ))}
              <li className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-black flex items-center justify-center shrink-0">4</span>
                <span className="text-sm flex-1">Liga o chiller</span>
              </li>
            </ol>
            <div className="text-[11px] text-muted-foreground border-t border-border pt-2 leading-relaxed">
              Partida completa ≈ <b className="text-foreground">{Math.round(total / 60 * 10) / 10} min</b>.
              Parada: chiller → espera → secundária → espera → primária → espera → fecha a válvula.
              Bomba dedicada em falha: entra a reserva (BAP3 / BAS3). Equipamento que não confirma ou entra em falha para a linha e o outro chiller assume.
            </div>
          </Secao>
        </div>
      </div>

      {data?.semana && (
        <Secao icon={CalendarDays} titulo="Próximos 7 dias" sub={!data.ativo ? "Programação geral desligada — a central não parte sozinha. Abaixo, como ficaria se fosse ativada." : sujo ? "Mostra a programação salva — salve para atualizar." : "Como a central vai operar com a programação salva."}>
          <Semana semana={data.semana} />
        </Secao>
      )}
    </div>
  );
}
