import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Clock, Wind, ChevronDown, ChevronRight, Globe2,
  Power, PowerOff, Hand, Cog, Thermometer, Plus,
  AlertTriangle, CheckCircle2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { toast } from "sonner";
import SchedulesPanel from "../components/SchedulesPanel";

const DAYS = [
  { v: 1, short: "Seg" },
  { v: 2, short: "Ter" },
  { v: 3, short: "Qua" },
  { v: 4, short: "Qui" },
  { v: 5, short: "Sex" },
  { v: 6, short: "Sáb" },
  { v: 0, short: "Dom" },
];

const PRESETS = [
  { id: "weekdays", label: "Dias úteis", days: [1, 2, 3, 4, 5] },
  { id: "weekend", label: "Fim de semana", days: [0, 6] },
  { id: "all", label: "Todos os dias", days: [0, 1, 2, 3, 4, 5, 6] },
];

const TABS = [
  { key: "onoff", label: "Ligar / Desligar", icon: Power, color: "emerald", defaultValue: "true" },
  { key: "mode", label: "Modo (Auto / Forçado)", icon: Cog, color: "sky", defaultValue: "true" },
  { key: "temp", label: "Temperatura (Setpoint)", icon: Thermometer, color: "amber", defaultValue: "22" },
];

function friendlySummary(tabKey, value) {
  const v = String(value).toLowerCase();
  if (tabKey === "onoff") return v === "true" ? "Ligar o ar-condicionado" : "Desligar o ar-condicionado";
  if (tabKey === "mode") return v === "true" ? "Modo Automático" : "Modo Forçado (manual)";
  return `Temperatura ${value}°C`;
}

/* --------- Programação Geral (todas as controladoras) --------- */
function BulkScheduleCard({ visibleFancoils, onCreated }) {
  const [activeTab, setActiveTab] = useState("onoff");
  const [form, setForm] = useState({ hour: 7, minute: 0, value: "true", days: [1, 2, 3, 4, 5] });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const switchTab = (key) => {
    const t = TABS.find((x) => x.key === key);
    setActiveTab(key);
    setForm((p) => ({ ...p, value: t.defaultValue, hour: key === "onoff" && p.value === "true" ? 7 : p.hour }));
  };

  const toggleDay = (d) =>
    setForm((p) => ({
      ...p,
      days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort(),
    }));

  const applyPreset = (preset) => setForm((p) => ({ ...p, days: [...preset.days] }));

  const submit = async () => {
    setSending(true);
    const action = activeTab === "onoff" ? "cmd" : activeTab === "mode" ? "estado" : "setpoint";
    try {
      const res = await api.post("/schedules/bulk", {
        hour: form.hour,
        minute: form.minute,
        action,
        value: String(form.value),
        days: form.days,
        enabled: true,
      });
      toast.success(`Agendamento aplicado em ${res.data.created_count} fancoil(s)`);
      if (res.data.skipped_count > 0) {
        toast.warning(`${res.data.skipped_count} fancoil(s) ignorado(s) — veja o console`);
        console.warn("[prog geral] skipped:", res.data.skipped);
      }
      setConfirmOpen(false);
      onCreated?.();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSending(false);
    }
  };

  const currentTab = TABS.find((t) => t.key === activeTab);
  const CurrentIcon = currentTab.icon;
  const summary = friendlySummary(activeTab, form.value);

  return (
    <Card
      data-testid="bulk-schedule-card"
      className="p-5 border-2 border-sky-500/40 bg-gradient-to-br from-sky-500/5 to-cyan-500/5"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-sky-500/20 text-sky-300">
          <Globe2 className="w-6 h-6" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="font-display text-lg font-black uppercase tracking-wider text-sky-200">
            Programação Geral
          </h2>
          <div className="text-xs text-muted-foreground">
            Aplica o mesmo agendamento a <b>todos os {visibleFancoils.length} fancoil(s)</b> que você tem acesso.
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          const ring = {
            emerald: active ? "border-emerald-400 bg-emerald-500/10 text-emerald-200" : "border-border hover:border-emerald-400/40",
            sky: active ? "border-sky-400 bg-sky-500/10 text-sky-200" : "border-border hover:border-sky-400/40",
            amber: active ? "border-amber-400 bg-amber-500/10 text-amber-200" : "border-border hover:border-amber-400/40",
          }[t.color];
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              data-testid={`bulk-tab-${t.key}`}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left ${ring}`}
            >
              <Icon className="w-5 h-5" strokeWidth={1.75} />
              <div className="font-display font-bold text-sm">{t.label}</div>
            </button>
          );
        })}
      </div>

      {/* Form row */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_auto_1fr] gap-3 items-end mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Horário</div>
          <div className="flex items-center gap-1">
            <Input
              type="number" min={0} max={23}
              value={form.hour}
              onChange={(e) => setForm({ ...form, hour: Math.min(23, Math.max(0, parseInt(e.target.value || 0))) })}
              className="w-16 text-center font-display text-lg font-black tabular-nums"
              data-testid="bulk-hour"
            />
            <span className="font-display text-2xl font-black text-sky-400">:</span>
            <Input
              type="number" min={0} max={59}
              value={form.minute}
              onChange={(e) => setForm({ ...form, minute: Math.min(59, Math.max(0, parseInt(e.target.value || 0))) })}
              className="w-16 text-center font-display text-lg font-black tabular-nums"
              data-testid="bulk-minute"
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
                data-testid="bulk-value-ligar"
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold border-2 ${
                  form.value === "true" ? "bg-emerald-600 text-white border-emerald-500" : "bg-muted text-muted-foreground border-border"
                }`}
              >
                <Power className="w-4 h-4" /> Ligar
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, value: "false" })}
                data-testid="bulk-value-desligar"
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
                data-testid="bulk-value-auto"
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold border-2 ${
                  form.value === "true" ? "bg-sky-600 text-white border-sky-500" : "bg-muted text-muted-foreground border-border"
                }`}
              >
                <Cog className="w-4 h-4" /> Automático
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, value: "false" })}
                data-testid="bulk-value-forcado"
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
                data-testid="bulk-value-temp"
              />
              <span className="font-display text-xl font-black text-amber-400">°C</span>
            </div>
          )}
        </div>

        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={visibleFancoils.length === 0 || form.days.length === 0}
          data-testid="bulk-submit-button"
          className="w-full lg:w-auto bg-sky-600 hover:bg-sky-500 font-bold"
        >
          <Plus className="w-4 h-4 mr-2" /> Aplicar em todos
        </Button>
      </div>

      {/* Dias */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dias da semana</div>
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                data-testid={`bulk-preset-${p.id}`}
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
                data-testid={`bulk-day-${d.v}`}
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

      {/* Diálogo de confirmação */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" /> Aplicar programação em todos?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  Será criado o agendamento abaixo em <b>{visibleFancoils.length} fancoil(s)</b>:
                </div>
                <div className="p-3 rounded bg-slate-800/60 border border-border font-mono text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <CurrentIcon className="w-4 h-4" />
                    <span className="font-bold">{summary}</span>
                  </div>
                  <div>
                    Horário: <b>{String(form.hour).padStart(2, "0")}:{String(form.minute).padStart(2, "0")}</b>
                  </div>
                  <div>
                    Dias:{" "}
                    <b>
                      {form.days.length === 7
                        ? "Todos"
                        : DAYS.filter((d) => form.days.includes(d.v)).map((d) => d.short).join(", ")}
                    </b>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Os agendamentos individuais existentes serão <b>mantidos</b>. Este agendamento será adicionado em cada fancoil.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              data-testid="bulk-confirm-button"
              onClick={submit}
              disabled={sending}
              className="bg-sky-600 hover:bg-sky-500"
            >
              {sending ? "Enviando..." : <><CheckCircle2 className="w-4 h-4 mr-2" /> Confirmar</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* --------- Página --------- */
export default function ProgramacaoHoraria() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
    refetchInterval: 60000,
  });
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState({});

  const canCommand = user?.role !== "viewer";

  const visibleFancoils = useMemo(() => {
    const act = fancoils.filter((f) => f.active !== false && f.authorized !== false);
    if (!filter) return act;
    const q = filter.toLowerCase();
    return act.filter((f) => f.name.toLowerCase().includes(q) || String(f.floor).includes(q));
  }, [fancoils, filter]);

  const onBulkCreated = () => {
    // invalida todas as queries de schedules
    qc.invalidateQueries({ queryKey: ["schedules"] });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="programacao-horaria-page">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
          <Clock className="w-8 h-8 text-sky-400" /> Programação Horária
        </h1>
        <div className="text-muted-foreground text-sm mt-1">
          A programação é <b>enviada à controladora via MQTT</b> (tópico <code className="font-mono text-xs">SCHEDULE/SET</code>, retained).
          O ESP32 armazena e executa internamente.
        </div>
      </div>

      {canCommand && <BulkScheduleCard visibleFancoils={visibleFancoils} onCreated={onBulkCreated} />}

      <div className="flex items-center gap-3">
        <Input
          placeholder="Buscar fancoil (ex.: CJ171, 17)..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="prog-horaria-search"
          className="max-w-sm"
        />
        <div className="text-xs text-muted-foreground">
          {visibleFancoils.length} fancoil(s) acessível(is)
        </div>
      </div>

      <div className="space-y-3">
        {visibleFancoils.map((fc) => {
          const open = !!expanded[fc.id];
          return (
            <Card key={fc.id} data-testid={`prog-fc-${fc.name.toLowerCase()}`} className="overflow-hidden">
              <button
                onClick={() => setExpanded((p) => ({ ...p, [fc.id]: !p[fc.id] }))}
                className="w-full flex items-center gap-3 p-4 hover:bg-accent/10 text-left"
                data-testid={`prog-fc-toggle-${fc.name.toLowerCase()}`}
              >
                <Wind className={`w-5 h-5 ${fc.online ? "text-sky-400" : "text-slate-600"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-base">{fc.name}</div>
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    {fc.floor}º andar • Lado {fc.side} • {fc.device_id}
                  </div>
                </div>
                {open ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
              </button>
              {open && (
                <div className="px-4 pb-4 pt-2 border-t border-border/60">
                  <SchedulesPanel fancoilId={fc.id} canEdit={canCommand} />
                </div>
              )}
            </Card>
          );
        })}
        {visibleFancoils.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            Nenhum fancoil disponível para programação.
          </Card>
        )}
      </div>
    </div>
  );
}
