import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Power, PowerOff, Hand, Cog, Thermometer, Plus, Trash2, Clock,
  CheckCircle2, AlertCircle, CircleDashed, Info,
} from "lucide-react";

const DAYS = [
  { v: 1, short: "Seg", full: "Segunda" },
  { v: 2, short: "Ter", full: "Terça" },
  { v: 3, short: "Qua", full: "Quarta" },
  { v: 4, short: "Qui", full: "Quinta" },
  { v: 5, short: "Sex", full: "Sexta" },
  { v: 6, short: "Sáb", full: "Sábado" },
  { v: 0, short: "Dom", full: "Domingo" },
];

const PRESETS = [
  { id: "weekdays", label: "Dias úteis", days: [1, 2, 3, 4, 5] },
  { id: "weekend", label: "Fim de semana", days: [0, 6] },
  { id: "all", label: "Todos os dias", days: [0, 1, 2, 3, 4, 5, 6] },
];

const MAX_SLOTS = 10;

/* --------- Tabs (tipos de agendamento) ---------- */
const TABS = [
  {
    key: "onoff",
    label: "Ligar / Desligar",
    icon: Power,
    color: "emerald",
    description: "Programa o fancoil para ligar ou desligar automaticamente.",
    defaultValue: "true",
  },
  {
    key: "mode",
    label: "Modo (Auto / Forçado)",
    icon: Cog,
    color: "sky",
    description: "Alterna o modo entre Automático (segue setpoint) e Forçado (segue comando manual).",
    defaultValue: "true",
  },
  {
    key: "temp",
    label: "Temperatura (Setpoint)",
    icon: Thermometer,
    color: "amber",
    description: "Agenda a mudança do setpoint de temperatura (10 a 35 °C).",
    defaultValue: "22",
  },
];

function tabOf(action) {
  if (action === "cmd") return "onoff";
  if (action === "estado") return "mode";
  return "temp";
}

function friendlyAction(action, value) {
  const v = String(value).toLowerCase();
  if (action === "cmd") return v === "true" ? { label: "Ligar o ar-condicionado", Icon: Power, color: "text-emerald-400" }
                                             : { label: "Desligar o ar-condicionado", Icon: PowerOff, color: "text-rose-400" };
  if (action === "estado") return v === "true" ? { label: "Modo Automático", Icon: Cog, color: "text-sky-400" }
                                                : { label: "Modo Forçado (manual)", Icon: Hand, color: "text-orange-400" };
  return { label: `Temperatura ${value}°C`, Icon: Thermometer, color: "text-amber-400" };
}

function describeDays(days) {
  if (!days || days.length === 0 || days.length === 7) return "Todos os dias";
  const preset = PRESETS.find((p) => p.days.length === days.length && p.days.every((d) => days.includes(d)));
  if (preset) return preset.label;
  return DAYS.filter((d) => days.includes(d.v)).map((d) => d.short).join(" · ");
}

/* ---------- Sync badge ---------- */
function SyncBadge({ fancoilState }) {
  if (!fancoilState?.schedule_sent_at) {
    return (
      <span
        data-testid="sync-badge-never"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-wider border border-slate-600 text-slate-400"
        title="Nenhuma agenda publicada ainda neste ID"
      >
        <CircleDashed className="w-3 h-3" /> Sem agenda publicada
      </span>
    );
  }
  if (fancoilState.schedule_in_sync) {
    return (
      <span
        data-testid="sync-badge-synced"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-wider border border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
        title={`Confirmado pela controladora em ${new Date(fancoilState.schedule_applied_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
      >
        <CheckCircle2 className="w-3 h-3" /> Sincronizado
      </span>
    );
  }
  return (
    <span
      data-testid="sync-badge-pending"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] uppercase tracking-wider border border-amber-500/60 bg-amber-500/10 text-amber-200"
      title="Enviamos a agenda, mas a controladora ainda não confirmou a aplicação (SCHEDULE/STATE)"
    >
      <AlertCircle className="w-3 h-3" /> Aguardando confirmação
    </span>
  );
}

/* ---------- Component ---------- */
export default function SchedulesPanel({ fancoilId, canEdit }) {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["schedules", fancoilId],
    queryFn: async () => (await api.get(`/schedules/${fancoilId}`)).data,
    refetchInterval: 60000,
  });
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
    refetchInterval: 30000,
  });
  const fancoil = fancoils.find((f) => f.id === fancoilId);

  const [activeTab, setActiveTab] = useState("onoff");
  const [form, setForm] = useState({ hour: 7, minute: 0, value: "true", days: [1, 2, 3, 4, 5] });

  const switchTab = (key) => {
    const t = TABS.find((x) => x.key === key);
    setActiveTab(key);
    setForm((p) => ({ ...p, value: t.defaultValue, hour: key === "onoff" ? (p.value === "false" ? 18 : 7) : p.hour }));
  };

  const toggleDay = (d) =>
    setForm((p) => ({
      ...p,
      days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort(),
    }));

  const applyPreset = (preset) => setForm((p) => ({ ...p, days: [...preset.days] }));

  const totalSlots = items.length;
  const atLimit = totalSlots >= MAX_SLOTS;

  const notifyImmediate = () => {
    toast.message("Atenção", {
      description:
        "A controladora pode aplicar imediatamente o estado do horário atual (ex.: criar 'liga 07:00 / desliga 18:00' às 10:00 liga agora).",
      icon: <Info className="w-4 h-4" />,
    });
  };

  const create = async () => {
    if (atLimit) {
      toast.error(`Limite de ${MAX_SLOTS} agendamentos por controladora atingido.`);
      return;
    }
    const action = activeTab === "onoff" ? "cmd" : activeTab === "mode" ? "estado" : "setpoint";
    try {
      await api.post("/schedules", {
        fancoil_id: fancoilId,
        hour: form.hour,
        minute: form.minute,
        action,
        value: String(form.value),
        days: form.days,
        enabled: true,
      });
      toast.success("Agendamento criado");
      notifyImmediate();
      qc.invalidateQueries({ queryKey: ["schedules", fancoilId] });
      qc.invalidateQueries({ queryKey: ["fancoils"] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/schedules/${id}`);
      qc.invalidateQueries({ queryKey: ["schedules", fancoilId] });
      qc.invalidateQueries({ queryKey: ["fancoils"] });
      toast.success("Agendamento removido");
      notifyImmediate();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const toggle = async (s) => {
    try {
      await api.patch(`/schedules/${s.id}`, { enabled: !s.enabled });
      qc.invalidateQueries({ queryKey: ["schedules", fancoilId] });
      qc.invalidateQueries({ queryKey: ["fancoils"] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const grouped = useMemo(() => {
    const g = { onoff: [], mode: [], temp: [] };
    items.forEach((s) => g[tabOf(s.action)].push(s));
    Object.keys(g).forEach((k) =>
      g[k].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
    );
    return g;
  }, [items]);

  const currentTab = TABS.find((t) => t.key === activeTab);
  const CurrentIcon = currentTab.icon;

  return (
    <div className="space-y-5" data-testid="schedules-panel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Clock className="w-4 h-4" /> Agendamentos
          <span className={`font-mono text-xs ${atLimit ? "text-rose-400" : "text-slate-500"}`}>
            ({totalSlots}/{MAX_SLOTS})
          </span>
        </h2>
        <SyncBadge fancoilState={fancoil} />
      </div>

      {/* Tab bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          const count = grouped[t.key].length;
          const ring = {
            emerald: active ? "border-emerald-400 bg-emerald-500/10 text-emerald-200" : "border-border hover:border-emerald-400/40",
            sky: active ? "border-sky-400 bg-sky-500/10 text-sky-200" : "border-border hover:border-sky-400/40",
            amber: active ? "border-amber-400 bg-amber-500/10 text-amber-200" : "border-border hover:border-amber-400/40",
          }[t.color];
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              data-testid={`sched-tab-${t.key}`}
              className={`flex items-center justify-between gap-2 p-3 rounded-lg border-2 transition-all text-left ${ring}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-5 h-5" strokeWidth={1.75} />
                <div>
                  <div className="font-display font-bold text-sm">{t.label}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {count} agendamento{count === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Lista do tab atual */}
      <div className="space-y-2">
        {grouped[activeTab].length === 0 && (
          <div className="text-xs text-muted-foreground italic p-4 border border-dashed border-border rounded-lg text-center">
            Nenhum agendamento de <b>{currentTab.label}</b> configurado. Use o formulário abaixo para criar.
          </div>
        )}
        {grouped[activeTab].map((s) => {
          const f = friendlyAction(s.action, s.value);
          const Ico = f.Icon;
          return (
            <div
              key={s.id}
              data-testid={`schedule-row-${s.id}`}
              className={`flex items-center gap-3 p-3 lg:p-4 rounded-lg border bg-card/50 ${
                s.enabled ? "border-border" : "border-border/40 opacity-60"
              }`}
            >
              <div className="font-display text-2xl font-black w-20 text-sky-400 tabular-nums">
                {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`flex items-center gap-2 font-semibold text-sm ${f.color}`}>
                  <Ico className="w-4 h-4" strokeWidth={2} />
                  <span>{f.label}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {describeDays(s.days)}
                  {s.last_run && (
                    <> · últ.: {new Date(s.last_run).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</>
                  )}
                </div>
              </div>
              {canEdit && (
                <>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={() => toggle(s)}
                    data-testid={`schedule-toggle-${s.id}`}
                  />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="outline" data-testid={`schedule-remove-${s.id}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remover agendamento?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação remove o agendamento das {String(s.hour).padStart(2, "0")}:
                          {String(s.minute).padStart(2, "0")} — {f.label}.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          data-testid={`schedule-remove-confirm-${s.id}`}
                          onClick={() => remove(s.id)}
                        >
                          Remover
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Formulário */}
      {canEdit && (
        <div className="pt-4 mt-2 border-t border-border space-y-4">
          <div className="flex items-center gap-2">
            <CurrentIcon className={`w-5 h-5 text-${currentTab.color}-400`} />
            <div className="flex-1">
              <div className="font-display text-sm font-bold uppercase tracking-wider">
                Novo agendamento — {currentTab.label}
              </div>
              <div className="text-xs text-muted-foreground">{currentTab.description}</div>
            </div>
            {atLimit && (
              <span className="text-xs text-rose-400 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Limite atingido
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[auto_auto_1fr] gap-3 items-end">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Horário</div>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} max={23}
                  value={form.hour}
                  onChange={(e) => setForm({ ...form, hour: Math.min(23, Math.max(0, parseInt(e.target.value || 0))) })}
                  className="w-16 text-center font-display text-lg font-black tabular-nums"
                  data-testid="schedule-hour"
                />
                <span className="font-display text-2xl font-black text-sky-400">:</span>
                <Input
                  type="number" min={0} max={59}
                  value={form.minute}
                  onChange={(e) => setForm({ ...form, minute: Math.min(59, Math.max(0, parseInt(e.target.value || 0))) })}
                  className="w-16 text-center font-display text-lg font-black tabular-nums"
                  data-testid="schedule-minute"
                />
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {activeTab === "temp" ? "Temperatura (°C)" : "Ação"}
              </div>
              {activeTab === "onoff" && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, value: "true" })}
                    data-testid="schedule-value-ligar"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold border-2 ${
                      form.value === "true" ? "bg-emerald-600 text-white border-emerald-500" : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    <Power className="w-4 h-4" /> Ligar
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, value: "false" })}
                    data-testid="schedule-value-desligar"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold border-2 ${
                      form.value === "false" ? "bg-rose-600 text-white border-rose-500" : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    <PowerOff className="w-4 h-4" /> Desligar
                  </button>
                </div>
              )}
              {activeTab === "mode" && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, value: "true" })}
                    data-testid="schedule-value-auto"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold border-2 ${
                      form.value === "true" ? "bg-sky-600 text-white border-sky-500" : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    <Cog className="w-4 h-4" /> Automático
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, value: "false" })}
                    data-testid="schedule-value-forcado"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold border-2 ${
                      form.value === "false" ? "bg-orange-600 text-white border-orange-500" : "bg-muted text-muted-foreground border-border"
                    }`}
                  >
                    <Hand className="w-4 h-4" /> Forçado
                  </button>
                </div>
              )}
              {activeTab === "temp" && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number" min={10} max={35} step="0.5"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    className="w-24 text-center font-display text-lg font-black tabular-nums"
                    data-testid="schedule-value-temp"
                  />
                  <span className="font-display text-xl font-black text-amber-400">°C</span>
                </div>
              )}
            </div>

            <Button
              onClick={create}
              disabled={atLimit || form.days.length === 0}
              data-testid="schedule-create-button"
              className="w-full lg:w-auto bg-sky-600 hover:bg-sky-500"
            >
              <Plus className="w-4 h-4 mr-2" /> Adicionar
            </Button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dias da semana</div>
              <div className="flex gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    data-testid={`schedule-preset-${p.id}`}
                    className="text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-border hover:border-sky-400 text-muted-foreground hover:text-sky-300"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((d) => {
                const sel = form.days.includes(d.v);
                const weekend = d.v === 0 || d.v === 6;
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    data-testid={`schedule-day-${d.v}`}
                    className={`py-2 rounded font-mono text-xs uppercase tracking-wider border-2 transition-all ${
                      sel
                        ? "bg-sky-600 text-white border-sky-500 font-bold"
                        : weekend
                        ? "bg-muted/40 text-muted-foreground/70 border-border"
                        : "bg-muted text-muted-foreground border-border hover:border-sky-400/40"
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
