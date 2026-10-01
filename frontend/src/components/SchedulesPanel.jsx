import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { toast } from "sonner";
import { Clock, Plus, Trash2 } from "lucide-react";

const DAYS = [
  { v: 0, lbl: "Dom" }, { v: 1, lbl: "Seg" }, { v: 2, lbl: "Ter" },
  { v: 3, lbl: "Qua" }, { v: 4, lbl: "Qui" }, { v: 5, lbl: "Sex" }, { v: 6, lbl: "Sáb" },
];

export default function SchedulesPanel({ fancoilId, canEdit }) {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ["schedules", fancoilId],
    queryFn: async () => (await api.get(`/schedules/${fancoilId}`)).data,
    refetchInterval: 60000,
  });
  const [form, setForm] = useState({
    hour: 7, minute: 0, action: "cmd", value: "true", days: [1, 2, 3, 4, 5],
  });

  const toggleDay = (d) =>
    setForm((p) => ({
      ...p,
      days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d],
    }));

  const create = async () => {
    try {
      await api.post("/schedules", { fancoil_id: fancoilId, ...form, value: String(form.value) });
      toast.success("Agendamento criado");
      qc.invalidateQueries({ queryKey: ["schedules", fancoilId] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/schedules/${id}`);
      qc.invalidateQueries({ queryKey: ["schedules", fancoilId] });
      toast.success("Agendamento removido");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const toggle = async (s) => {
    try {
      await api.patch(`/schedules/${s.id}`, { enabled: !s.enabled });
      qc.invalidateQueries({ queryKey: ["schedules", fancoilId] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const describeAction = (a) => {
    if (a === "estado") return "ESTADO";
    if (a === "cmd") return "CMD";
    return "SETPOINT";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Clock className="w-4 h-4" /> Agendamentos
        </h2>
      </div>

      {items.length === 0 && (
        <div className="text-xs text-muted-foreground font-mono italic p-3 border border-dashed border-border rounded">
          Nenhum agendamento. Use o formulário abaixo para programar comandos recorrentes.
        </div>
      )}

      <div className="space-y-2">
        {items.map((s) => (
          <div
            key={s.id}
            data-testid={`schedule-row-${s.id}`}
            className="flex items-center gap-3 p-3 rounded border border-border bg-card/60"
          >
            <div className="font-display text-xl font-black w-16 text-sky-400">
              {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono uppercase tracking-wider">
                {describeAction(s.action)} = <b>{s.value}</b>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {s.days.length === 0 || s.days.length === 7
                  ? "Todos os dias"
                  : DAYS.filter((d) => s.days.includes(d.v)).map((d) => d.lbl).join(" · ")}
                {s.last_run && ` · últ.: ${new Date(s.last_run).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
              </div>
            </div>
            {canEdit && (
              <>
                <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} data-testid={`schedule-toggle-${s.id}`} />
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
                        Esta ação remove o agendamento {String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")} ({s.action}={s.value}).
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction data-testid={`schedule-remove-confirm-${s.id}`} onClick={() => remove(s.id)}>
                        Remover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="pt-4 mt-4 border-t border-border space-y-3">
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Novo agendamento</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px] uppercase">Hora</Label>
              <Input type="number" min={0} max={23} value={form.hour}
                     onChange={(e) => setForm({ ...form, hour: parseInt(e.target.value || 0) })}
                     data-testid="schedule-hour" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Minuto</Label>
              <Input type="number" min={0} max={59} value={form.minute}
                     onChange={(e) => setForm({ ...form, minute: parseInt(e.target.value || 0) })}
                     data-testid="schedule-minute" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Ação</Label>
              <Select value={form.action}
                      onValueChange={(v) => setForm({ ...form, action: v, value: v === "setpoint" ? "22" : "true" })}>
                <SelectTrigger data-testid="schedule-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="estado">ESTADO (AUTO/Forçado)</SelectItem>
                  <SelectItem value="cmd">CMD (Ligar/Desligar)</SelectItem>
                  <SelectItem value="setpoint">SETPOINT (°C)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase">Valor</Label>
              {form.action === "setpoint" ? (
                <Input type="number" step="0.5" value={form.value}
                       onChange={(e) => setForm({ ...form, value: e.target.value })}
                       data-testid="schedule-value-number" />
              ) : (
                <Select value={form.value} onValueChange={(v) => setForm({ ...form, value: v })}>
                  <SelectTrigger data-testid="schedule-value-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{form.action === "estado" ? "AUTOMÁTICO" : "LIGAR"}</SelectItem>
                    <SelectItem value="false">{form.action === "estado" ? "FORÇADO" : "DESLIGAR"}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase">Dias</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {DAYS.map((d) => (
                <button
                  key={d.v}
                  type="button"
                  onClick={() => toggleDay(d.v)}
                  data-testid={`schedule-day-${d.v}`}
                  className={`px-3 py-1 rounded text-xs font-mono uppercase border ${
                    form.days.includes(d.v)
                      ? "bg-sky-600 text-white border-sky-500"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {d.lbl}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={create} data-testid="schedule-create-button" className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Adicionar agendamento
          </Button>
        </div>
      )}
    </div>
  );
}
