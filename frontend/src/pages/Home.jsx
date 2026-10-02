import React, { useMemo } from "react";
import { Card } from "../components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTelemetry } from "../context/TelemetryContext";
import { Wind, Power, Hand, WifiOff, Siren, Thermometer } from "lucide-react";

function Metric({ icon: Icon, label, value, accent, testid }) {
  return (
    <Card data-testid={testid} className="p-5 bg-card/80 backdrop-blur border-border">
      <div className="flex items-center gap-3">
        <div className={`w-11 h-11 rounded-md flex items-center justify-center ${accent}`}>
          <Icon className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider truncate">{label}</div>
          <div className="font-display text-2xl font-black text-foreground">{value}</div>
        </div>
      </div>
    </Card>
  );
}

export default function Home() {
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
    refetchInterval: 30000,
  });
  const { data: activeAlarms = [] } = useQuery({
    queryKey: ["active-alarms-home"],
    queryFn: async () => (await api.get("/alarms?active_only=true")).data,
    refetchInterval: 15000,
  });
  const { data: settings } = useQuery({
    queryKey: ["settings-public"],
    queryFn: async () => {
      try { return (await api.get("/admin/settings")).data; } catch { return null; }
    },
  });
  const { states } = useTelemetry();

  const stats = useMemo(() => {
    let on = 0, forced = 0, offline = 0, tempSum = 0, tempCount = 0;
    const active = fancoils.filter((fc) => fc.active !== false);
    active.forEach((fc) => {
      const st = states[fc.device_id] || {};
      const status = st.status ?? fc.status;
      const estado = st.estado ?? fc.estado;
      const online = st.online ?? fc.online;
      const temp = st.temperature ?? fc.temperature;
      if (online === false) offline++;
      if (status === true) on++;
      if (estado === false) forced++;
      if (online && typeof temp === "number") {
        tempSum += temp;
        tempCount++;
      }
    });
    return {
      on, forced, offline,
      total: active.length,
      avgTemp: tempCount ? (tempSum / tempCount).toFixed(1) : "--",
    };
  }, [fancoils, states]);

  const buildingImg = settings?.building_image_url
    || "https://images.unsplash.com/photo-1528810289438-283f885c31ef?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="home-page">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase text-foreground">
          Painel Geral
        </h1>
        <div className="text-muted-foreground text-sm mt-1">Visão consolidada do edifício</div>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-border">
        <img src={buildingImg} alt="Edifício" className="w-full h-56 lg:h-72 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/50 to-transparent" />
        <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
          <div>
            <div className="text-xs text-sky-300 font-mono uppercase tracking-widest">Edifício Monitorado</div>
            <div className="font-display text-xl lg:text-2xl font-bold text-white">NX-360 BMS — Automação Predial em Tempo Real</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Metric testid="metric-on" icon={Power} label="Ligados / Total" value={`${stats.on}/${stats.total}`} accent="bg-emerald-500/20 text-emerald-400" />
        <Metric testid="metric-forced" icon={Hand} label="Em Forçado" value={stats.forced} accent="bg-amber-500/20 text-amber-400" />
        <Metric testid="metric-offline" icon={WifiOff} label="Offline" value={stats.offline} accent="bg-slate-500/20 text-slate-400" />
        <Metric testid="metric-alarms" icon={Siren} label="Alarmes" value={activeAlarms.length} accent="bg-red-500/20 text-red-400" />
        <Metric testid="metric-avg-temp" icon={Thermometer} label="Temp. Média" value={`${stats.avgTemp} °C`} accent="bg-sky-500/20 text-sky-400" />
      </div>
    </div>
  );
}
