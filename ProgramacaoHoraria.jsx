import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import {
  Clock, Plus, Trash2, Star, Save, CheckCircle2, AlertTriangle, WifiOff, Send, Pencil, CalendarClock, Info,
} from "lucide-react";

// Dias: 0=Dom..6=Sáb (padrão do firmware). Exibição começa na segunda.
const DAYS = [
  { v: 1, s: "Seg" }, { v: 2, s: "Ter" }, { v: 3, s: "Qua" }, { v: 4, s: "Qui" },
  { v: 5, s: "Sex" }, { v: 6, s: "Sáb" }, { v: 0, s: "Dom" },
];
const PRESETS = [
  { l: "Dias úteis", d: [1, 2, 3, 4, 5] },
  { l: "Fim de semana", d: [0, 6] },
  { l: "Todos", d: [0, 1, 2, 3, 4, 5, 6] },
];
const MAX_EVENTOS = 10;
const novoPeriodo = () => ({ dias: [1, 2, 3, 4, 5], liga: "07:00", desliga: "20:00", setpoint: null });
const toMin = (h) => { const [a, b] = String(h || "0:0").split(":").map(Number); return a * 60 + b; };

/* ---------- Linha do tempo da semana ---------- */
export function WeekTimeline({ periodos }) {
  return (
    <div className="space-y-1" data-testid="agenda-timeline">
      {DAYS.map((d) => (
        <div key={d.v} className="flex items-center gap-2">
          <div className="w-9 text-[11px] font-mono text-muted-foreground">{d.s}</div>
          <div className="relative flex-1 h-4 rounded bg-muted/50 overflow-hidden">
            {[6, 12, 18].map((h) => <div key={h} className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `${(h / 24) * 100}%` }} />)}
            {periodos.filter((p) => p.dias.includes(d.v)).map((p, i) => {
              const a = toMin(p.liga), b = p.desliga ? toMin(p.desliga) : 1440;
              return (
                <div key={i} className="absolute top-0 bottom-0 bg-emerald-500/60 rounded" title={`${p.liga}–${p.desliga || "24h"}`}
                  style={{ left: `${(a / 1440) * 100}%`, width: `${(Math.max(b - a, 5) / 1440) * 100}%` }} />
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex justify-between pl-11 text-[10px] font-mono text-muted-foreground"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
    </div>
  );
}

/* ---------- Editor de períodos (agenda ou individual) ---------- */
export function PeriodsEditor({ value, onChange, readOnly, semSetpoint, vazio, novo = novoPeriodo }) {
  const upd = (i, patch) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const toggleDay = (i, d) => {
    const dias = value[i].dias.includes(d) ? value[i].dias.filter((x) => x !== d) : [...value[i].dias, d];
    upd(i, { dias });
  };
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="rounded-md border border-border bg-background/40 p-3 flex flex-col xl:flex-row xl:items-end gap-3" data-testid={`periodo-${i}`}>
          <div className="text-xs font-mono text-muted-foreground xl:w-6 xl:pb-2">{i + 1}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex flex-wrap items-center gap-2">
              Dias
              {!readOnly && PRESETS.map((pr) => (
                <button key={pr.l} type="button" className="normal-case tracking-normal hover:underline text-sky-300/80" onClick={() => upd(i, { dias: pr.d })}>{pr.l}</button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((d) => (
                <button key={d.v} type="button" disabled={readOnly} onClick={() => toggleDay(i, d.v)}
                  className={`py-1.5 rounded text-[11px] font-mono border transition-colors ${p.dias.includes(d.v) ? "bg-sky-600 text-white border-sky-500" : "bg-muted/40 text-muted-foreground border-border"} disabled:cursor-default`}>
                  {d.s}
                </button>
              ))}
            </div>
          </div>
          <div className={`grid ${semSetpoint ? "grid-cols-2 xl:w-[240px]" : "grid-cols-3 xl:w-[360px]"} gap-2`}>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Liga</div>
              <Input type="time" value={p.liga} disabled={readOnly} onChange={(e) => upd(i, { liga: e.target.value })} data-testid={`periodo-liga-${i}`} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 flex items-center justify-between">
                Desliga
                {!readOnly && (
                  <label className="normal-case tracking-normal flex items-center gap-1 cursor-pointer" title="Fica ligado até o fim do dia">
                    <input type="checkbox" checked={!p.desliga} onChange={(e) => upd(i, { desliga: e.target.checked ? null : "20:00" })} /> 24h
                  </label>
                )}
              </div>
              {p.desliga
                ? <Input type="time" value={p.desliga} disabled={readOnly} onChange={(e) => upd(i, { desliga: e.target.value })} data-testid={`periodo-desliga-${i}`} />
                : <div className="h-10 flex items-center text-xs text-muted-foreground">não desliga</div>}
            </div>
            {!semSetpoint && <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Setpoint °C</div>
              <Input type="number" step="0.5" min="10" max="35" placeholder="—" title="Vazio = mantém o setpoint atual" disabled={readOnly}
                value={p.setpoint ?? ""} onChange={(e) => upd(i, { setpoint: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>}
          </div>
          {!readOnly && (
            <Button variant="outline" size="sm" className="self-end" onClick={() => onChange(value.filter((_, j) => j !== i))} title="Remover período">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      ))}
      {!value.length && <div className="text-sm text-muted-foreground px-1">{vazio || "Nenhum período — quem seguir esta agenda não liga nem desliga sozinho."}</div>}
      {!readOnly && (
        <Button variant="outline" size="sm" onClick={() => onChange([...value, novo()])} data-testid="periodo-add">
          <Plus className="w-4 h-4 mr-1" /> Adicionar período
        </Button>
      )}
    </div>
  );
}

/* Validação no servidor (mesma regra usada ao enviar para a controladora) */
function usePreview(periodos) {
  const [res, setRes] = useState(null);
  const key = JSON.stringify(periodos);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try { const r = await api.post("/agendas/preview", { periodos: JSON.parse(key) }); if (alive) setRes(r.data); } catch { /* ignora */ }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [key]);
  return res;
}

function PreviewBadge({ prev }) {
  if (!prev) return null;
  if (!prev.ok) return <div className="text-xs text-red-400 flex items-start gap-1" data-testid="agenda-erro"><AlertTriangle className="w-4 h-4 shrink-0" /> {prev.erro}</div>;
  return <div className="text-xs text-muted-foreground font-mono">{prev.n_eventos}/{MAX_EVENTOS} eventos na controladora</div>;
}

/* ---------- Agendas (modelos) ---------- */
function AgendasCard({ agendas, isAdmin }) {
  const qc = useQueryClient();
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const nova = selId === "nova";
  const sel = nova ? null : agendas.find((a) => a.id === selId) || agendas[0];
  useEffect(() => {
    if (nova) setDraft({ nome: "", periodos: [novoPeriodo()] });
    else if (sel) setDraft({ nome: sel.nome, periodos: sel.periodos });
  }, [nova, sel?.id, sel?.atualizado_em]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = usePreview(draft?.periodos || []);
  const dirty = nova || (draft && sel && (draft.nome !== sel.nome || JSON.stringify(draft.periodos) !== JSON.stringify(sel.periodos)));
  const refresh = () => { qc.invalidateQueries({ queryKey: ["agendas"] }); qc.invalidateQueries({ queryKey: ["prog-fancoils"] }); };

  const salvar = async () => {
    setBusy(true);
    try {
      if (nova) {
        const r = await api.post("/agendas", draft);
        toast.success(`Agenda "${r.data.nome}" criada`);
        setSelId(r.data.id);
      } else {
        const r = await api.put(`/agendas/${sel.id}`, draft);
        toast.success(r.data.publicados ? `Agenda salva e enviada para ${r.data.publicados} fancoil(s)` : "Agenda salva");
      }
      refresh();
    } catch (e) { toast.error(formatApiError(e)); }
    setBusy(false);
  };
  const excluir = async () => {
    if (!window.confirm(`Excluir a agenda "${sel.nome}"?`)) return;
    try { await api.delete(`/agendas/${sel.id}`); setSelId(null); refresh(); } catch (e) { toast.error(formatApiError(e)); }
  };
  const padrao = async () => {
    try { await api.post(`/agendas/${sel.id}/padrao`); toast.success(`"${sel.nome}" agora é a padrão`); refresh(); } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Card className="p-4 sm:p-5 space-y-4" data-testid="agendas-card">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="w-5 h-5 text-sky-400" />
        <h2 className="font-display text-sm uppercase tracking-widest mr-2">Agendas</h2>
        {agendas.map((a) => (
          <button key={a.id} type="button" onClick={() => setSelId(a.id)} data-testid={`agenda-tab-${a.nome}`}
            className={`px-3 py-1.5 rounded-md border text-sm flex items-center gap-1.5 ${sel?.id === a.id ? "bg-sky-500/15 border-sky-500/50 text-sky-200" : "border-border hover:bg-muted/40"}`}>
            {a.padrao && <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />}{a.nome}
            <span className="text-[10px] font-mono text-muted-foreground">({a.n_fancoils})</span>
          </button>
        ))}
        {isAdmin && (
          <button type="button" onClick={() => setSelId("nova")} data-testid="agenda-nova"
            className={`px-3 py-1.5 rounded-md border border-dashed text-sm flex items-center gap-1 ${nova ? "border-sky-500/60 text-sky-200" : "border-border text-muted-foreground hover:bg-muted/40"}`}>
            <Plus className="w-3.5 h-3.5" /> Nova agenda
          </button>
        )}
      </div>

      {draft && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin
                ? <Input className="max-w-xs font-bold" placeholder="Nome da agenda" value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} data-testid="agenda-nome" />
                : <div className="font-bold">{draft.nome}</div>}
              {sel?.padrao && <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-400/40 text-amber-300">padrão</span>}
              {sel && <span className="text-xs text-muted-foreground">{sel.n_fancoils} fancoil(s) seguem</span>}
            </div>
            <PeriodsEditor value={draft.periodos} onChange={(periodos) => setDraft({ ...draft, periodos })} readOnly={!isAdmin} />
          </div>
          <div className="space-y-3">
            <WeekTimeline periodos={draft.periodos} />
            <PreviewBadge prev={prev} />
            <div className="text-xs text-muted-foreground flex gap-1.5"><Info className="w-4 h-4 shrink-0" />
              No horário de desligar a controladora volta para Automático e desliga — nenhuma fica ligada esquecida em Forçado.
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={salvar} disabled={busy || !dirty || (prev && !prev.ok)} data-testid="agenda-salvar">
                  <Save className="w-4 h-4 mr-1" />{nova ? "Criar agenda" : sel?.n_fancoils ? `Salvar e enviar (${sel.n_fancoils})` : "Salvar"}
                </Button>
                {sel && !sel.padrao && <Button variant="outline" onClick={padrao}><Star className="w-4 h-4 mr-1" />Tornar padrão</Button>}
                {sel && !sel.padrao && <Button variant="outline" onClick={excluir} title="Excluir agenda"><Trash2 className="w-4 h-4" /></Button>}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Status da controladora ---------- */
function SyncCell({ f }) {
  if (f.sync === "ok") return <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> sincronizada</span>;
  if (!f.online) return <span className="text-amber-300 flex items-center gap-1"><WifiOff className="w-4 h-4" /> pendente (offline)</span>;
  if (f.sync === "pendente") return <span className="text-sky-300">enviando…</span>;
  return <span className="text-amber-300 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> não enviada</span>;
}

const valorModo = (f, padraoId) => (f.modo === "agenda" ? `ag:${f.agenda_id || padraoId}` : f.modo);

function OpcoesAgenda({ agendas }) {
  return (
    <>
      {agendas.map((a) => <SelectItem key={a.id} value={`ag:${a.id}`}>{a.nome}{a.padrao ? " ★" : ""}</SelectItem>)}
      <SelectSeparator />
      <SelectItem value="individual">Individual</SelectItem>
      <SelectItem value="nenhuma">Sem agenda (manual)</SelectItem>
    </>
  );
}

/* ---------- Fancoils ---------- */
function FancoilsCard({ fancoils, agendas, canEdit }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set());
  const [bulk, setBulk] = useState("");
  const [editInd, setEditInd] = useState(null);
  const padraoId = agendas.find((a) => a.padrao)?.id;
  const lista = useMemo(() => fancoils.filter((f) => !q || `${f.name} ${f.floor}`.toLowerCase().includes(q.toLowerCase())), [fancoils, q]);
  const pend = fancoils.filter((f) => f.sync !== "ok" && f.online);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["prog-fancoils"] }); qc.invalidateQueries({ queryKey: ["agendas"] }); };

  const aplicar = async (ids, v, periodos) => {
    const body = { fancoil_ids: ids, modo: v.startsWith("ag:") ? "agenda" : v };
    if (v.startsWith("ag:")) body.agenda_id = v.slice(3);
    if (periodos) body.periodos = periodos;
    try {
      const r = await api.put("/programacao/fancoils", body);
      toast.success(`Programação enviada para ${r.data.atualizados} fancoil(s)`);
      refresh();
      return true;
    } catch (e) { toast.error(formatApiError(e)); return false; }
  };
  const publicarPendentes = async () => {
    try { const r = await api.post("/programacao/publicar", { fancoil_ids: pend.map((f) => f.id) }); toast.success(`${r.data.publicados} fancoil(s) reenviados`); refresh(); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = lista.length > 0 && lista.every((f) => sel.has(f.id));

  return (
    <Card className="p-0 overflow-hidden" data-testid="prog-fancoils-card">
      <div className="p-4 flex flex-wrap items-center gap-2 border-b border-border">
        <h2 className="font-display text-sm uppercase tracking-widest mr-2">Fancoils</h2>
        <Input className="max-w-[220px] h-9" placeholder="Buscar (ex.: CJ171, 17)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="prog-busca" />
        {canEdit && sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 ml-auto" data-testid="prog-bulk">
            <span className="text-xs text-muted-foreground">{sel.size} selecionado(s) →</span>
            <Select value={bulk} onValueChange={setBulk}>
              <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Escolha a programação…" /></SelectTrigger>
              <SelectContent><OpcoesAgenda agendas={agendas} /></SelectContent>
            </Select>
            <Button size="sm" disabled={!bulk} onClick={async () => { if (await aplicar([...sel], bulk)) { setSel(new Set()); setBulk(""); } }} data-testid="prog-bulk-aplicar">Aplicar</Button>
          </div>
        )}
        {canEdit && !sel.size && pend.length > 0 && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={publicarPendentes} data-testid="prog-publicar">
            <Send className="w-4 h-4 mr-1" /> Enviar não sincronizadas ({pend.length})
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr>
              {canEdit && <th className="p-2 w-8"><Checkbox checked={allSel} onCheckedChange={() => setSel(allSel ? new Set() : new Set(lista.map((f) => f.id)))} /></th>}
              <th className="p-2">Fancoil</th><th className="p-2">Programação</th><th className="p-2">Hoje</th><th className="p-2">Controladora</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className="border-t border-border/60" data-testid={`prog-row-${f.name}`}>
                {canEdit && <td className="p-2"><Checkbox checked={sel.has(f.id)} onCheckedChange={() => toggle(f.id)} /></td>}
                <td className="p-2 whitespace-nowrap">
                  <b>{f.name}</b> <span className="text-xs text-muted-foreground font-mono">{f.floor}º · L{f.side}</span>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <Select value={valorModo(f, padraoId)} disabled={!canEdit} onValueChange={(v) => aplicar([f.id], v)}>
                      <SelectTrigger className="h-8 w-[210px]" data-testid={`prog-modo-${f.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent><OpcoesAgenda agendas={agendas} /></SelectContent>
                    </Select>
                    {f.modo === "individual" && canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditInd(f)} data-testid={`prog-editar-${f.name}`}><Pencil className="w-4 h-4 mr-1" />editar</Button>
                    )}
                  </div>
                </td>
                <td className="p-2 font-mono text-xs whitespace-nowrap">{f.hoje || <span className="text-muted-foreground">manual</span>}</td>
                <td className="p-2 text-xs whitespace-nowrap"><SyncCell f={f} /></td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhum fancoil.</td></tr>}
          </tbody>
        </table>
      </div>
      <IndividualDialog f={editInd} onClose={() => setEditInd(null)} onSave={async (ps) => { if (await aplicar([editInd.id], "individual", ps)) setEditInd(null); }} />
    </Card>
  );
}

function IndividualDialog({ f, onClose, onSave }) {
  const [ps, setPs] = useState([]);
  useEffect(() => { if (f) setPs(f.periodos?.length ? f.periodos : [novoPeriodo()]); }, [f]);
  const prev = usePreview(ps);
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Programação individual — {f?.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-4">
          <PeriodsEditor value={ps} onChange={setPs} />
          <div className="space-y-2"><WeekTimeline periodos={ps} /><PreviewBadge prev={prev} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(ps)} disabled={prev && !prev.ok} data-testid="individual-salvar"><Save className="w-4 h-4 mr-1" />Salvar e enviar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProgramacaoHoraria() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canEdit = user?.role !== "viewer";
  const { data: agendas = [] } = useQuery({ queryKey: ["agendas"], queryFn: async () => (await api.get("/agendas")).data });
  const { data: fancoils = [] } = useQuery({ queryKey: ["prog-fancoils"], queryFn: async () => (await api.get("/programacao/fancoils")).data, refetchInterval: 10000 });
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6" data-testid="programacao-page">
      <div>
        <h1 className="font-display text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-3">
          <Clock className="w-7 h-7 text-sky-400" /> Programação horária
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-4xl">
          Crie agendas com períodos de funcionamento e escolha qual cada fancoil segue. A controladora executa sozinha, mesmo sem internet.
          Para controle 100% manual, use “Sem agenda” e ligue/desligue em modo Forçado.
        </p>
      </div>
      <AgendasCard agendas={agendas} isAdmin={isAdmin} />
      <FancoilsCard fancoils={fancoils} agendas={agendas} canEdit={canEdit} />
    </div>
  );
}
