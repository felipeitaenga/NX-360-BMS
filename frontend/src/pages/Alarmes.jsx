import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Siren, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const PRIORITY_COLORS = {
  alta: "text-red-400 border-red-500/40 bg-red-500/10",
  media: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  baixa: "text-sky-400 border-sky-500/40 bg-sky-500/10",
};

export default function Alarmes() {
  const qc = useQueryClient();
  const { alarmsBump } = useTelemetry();
  const [onlyActive, setOnlyActive] = useState(true);
  const { data: alarms = [] } = useQuery({
    queryKey: ["alarms", onlyActive, alarmsBump],
    queryFn: async () =>
      (await api.get(`/alarms${onlyActive ? "?active_only=true" : ""}`)).data,
    refetchInterval: 10000,
  });
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
  });
  const nameByDevice = useMemo(() => {
    const m = {};
    fancoils.forEach((f) => { m[f.device_id] = f.name; });
    return m;
  }, [fancoils]);

  const ack = async (id) => {
    try {
      await api.post("/alarms/ack", { alarm_id: id });
      toast.success("Alarme reconhecido");
      qc.invalidateQueries({ queryKey: ["alarms"] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="alarms-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
            <Siren className="w-8 h-8 text-red-400" /> Alarmes
          </h1>
          <div className="text-muted-foreground text-sm mt-1">
            {alarms.filter((a) => a.active).length} ativos
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-mono uppercase text-xs text-muted-foreground">Apenas ativos</span>
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} data-testid="toggle-active-alarms" />
        </label>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Prioridade</th>
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Conjunto</th>
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Tipo</th>
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Início</th>
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Fim</th>
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Status</th>
                <th className="px-4 py-3 font-mono uppercase text-xs tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {alarms.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center p-8 text-muted-foreground">
                    Nenhum alarme encontrado.
                  </td>
                </tr>
              )}
              {alarms.map((a) => (
                <tr key={a.id} className={`border-t border-border ${a.active ? "" : "opacity-70"}`} data-testid={`alarm-row-${a.id}`}>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-[10px] font-mono uppercase px-2 py-1 rounded border ${PRIORITY_COLORS[a.priority] || ""}`}>
                      {a.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-display font-bold">{nameByDevice[a.device_id] || a.device_id}</span>
                    <span className="ml-2 text-[10px] font-mono text-muted-foreground">{a.device_id}</span>
                  </td>
                  <td className="px-4 py-3">{a.label}</td>
                  <td className="px-4 py-3 text-xs font-mono">{new Date(a.started_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  <td className="px-4 py-3 text-xs font-mono">{a.cleared_at ? new Date(a.cleared_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td>
                  <td className="px-4 py-3">
                    {a.active ? (
                      <span className="text-red-400 font-mono text-xs uppercase pulse-red inline-flex items-center gap-1">● Ativo</span>
                    ) : (
                      <span className="text-emerald-400 font-mono text-xs uppercase">Normalizado</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!a.acknowledged ? (
                      <Button size="sm" variant="outline" onClick={() => ack(a.id)} data-testid={`alarm-ack-${a.id}`}>
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Reconhecer
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Reconhecido</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
