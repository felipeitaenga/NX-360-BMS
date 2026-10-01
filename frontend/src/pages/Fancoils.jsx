import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { Wind, Hand, WifiOff, Search } from "lucide-react";

function statusColor(st, fc) {
  const online = st.online ?? fc.online;
  const status = st.status ?? fc.status;
  if (!online) return "offline";
  if (status === true) return "on";
  return "off";
}

function Dot({ kind, hasAlarm }) {
  const base = "inline-block w-3 h-3 rounded-full";
  if (hasAlarm) return <span className={`${base} bg-red-500 pulse-red`} />;
  if (kind === "on") return <span className={`${base} bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]`} />;
  if (kind === "off") return <span className={`${base} bg-slate-500`} />;
  return <span className={`${base} bg-slate-700 border border-slate-600`} />;
}

function FancoilItem({ fc, state, hasAlarm, side }) {
  const kind = statusColor(state, fc);
  const forced = (state.estado ?? fc.estado) === false;
  const authorized = fc.authorized !== false;
  const online = state.online ?? fc.online;
  const content = (
    <div
      data-testid={`fancoil-card-${fc.name.toLowerCase()}`}
      className={`flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-card hover:bg-accent/10 transition-all ${
        !authorized ? "opacity-40 pointer-events-none" : ""
      } ${side === 2 ? "flex-row-reverse text-right" : ""}`}
    >
      <Wind className={`w-5 h-5 shrink-0 ${online ? "text-sky-400" : "text-slate-600"}`} strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-sm text-foreground truncate">{fc.name}</div>
        <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">
          {state.temperature != null ? `${state.temperature.toFixed(1)}°` : "--"}
        </div>
      </div>
      {forced && <Hand className="w-4 h-4 text-amber-400" strokeWidth={2} />}
      {!online && <WifiOff className="w-4 h-4 text-slate-500" />}
      <Dot kind={kind} hasAlarm={hasAlarm} />
    </div>
  );

  if (!authorized) return content;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={`/ar-condicionado/${fc.id}`} className="block">
            {content}
          </Link>
        </TooltipTrigger>
        <TooltipContent side={side === 1 ? "right" : "left"}>
          <div className="text-xs space-y-1">
            <div><b>{fc.name}</b> — {fc.description || `${fc.floor}º andar`}</div>
            <div>Temperatura: {state.temperature != null ? `${state.temperature.toFixed(1)} °C` : "--"}</div>
            <div>Setpoint: {state.setpoint != null ? `${state.setpoint.toFixed(1)} °C` : "--"}</div>
            <div>VAG: {state.vag != null ? `${state.vag.toFixed(0)}%` : "--"}</div>
            <div>Modo: {forced ? "FORÇADO" : "AUTOMÁTICO"}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function Fancoils() {
  const [q, setQ] = useState("");
  const { states } = useTelemetry();
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
    refetchInterval: 60000,
  });
  const { data: activeAlarms = [] } = useQuery({
    queryKey: ["active-alarms-general"],
    queryFn: async () => (await api.get("/alarms?active_only=true")).data,
    refetchInterval: 15000,
  });
  const alarmDevices = useMemo(
    () => new Set(activeAlarms.map((a) => a.device_id)),
    [activeAlarms]
  );

  const { leftByFloor, rightByFloor, floors, summary } = useMemo(() => {
    const left = {}, right = {};
    const floors = new Set();
    let on = 0, off = 0, forced = 0, alarm = 0, offline = 0;
    const filtered = fancoils.filter(
      (fc) => !q || fc.name.toLowerCase().includes(q.toLowerCase()) || String(fc.floor).includes(q)
    );
    filtered.forEach((fc) => {
      const st = states[fc.device_id] || {};
      floors.add(fc.floor);
      const bucket = fc.side === 1 ? left : right;
      bucket[fc.floor] = fc;
      const online = st.online ?? fc.online;
      const status = st.status ?? fc.status;
      const estado = st.estado ?? fc.estado;
      if (!online) offline++;
      else if (status) on++;
      else off++;
      if (estado === false) forced++;
      if (alarmDevices.has(fc.device_id)) alarm++;
    });
    const sortedFloors = [...floors].sort((a, b) => b - a);
    return { leftByFloor: left, rightByFloor: right, floors: sortedFloors,
             summary: { on, off, forced, alarm, offline, total: filtered.length } };
  }, [fancoils, states, alarmDevices, q]);

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="fancoils-page">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase">Ar Condicionado</h1>
          <div className="text-muted-foreground text-sm mt-1">Visão geral dos conjuntos do edifício</div>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar CJ171, 17..." value={q} onChange={(e) => setQ(e.target.value)}
                 data-testid="fancoil-search" className="pl-9" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          ["Total", summary.total, "bg-slate-500/15 text-slate-300"],
          ["Ligados", summary.on, "bg-emerald-500/15 text-emerald-400"],
          ["Desligados", summary.off, "bg-slate-500/15 text-slate-300"],
          ["Forçados", summary.forced, "bg-amber-500/15 text-amber-400"],
          ["Alarme", summary.alarm, "bg-red-500/15 text-red-400"],
          ["Offline", summary.offline, "bg-slate-500/15 text-slate-500"],
        ].map(([label, val, cls]) => (
          <Card key={label} className={`p-3 ${cls}`}>
            <div className="text-[10px] font-mono uppercase tracking-widest">{label}</div>
            <div className="font-display text-xl font-black">{val}</div>
          </Card>
        ))}
      </div>

      {/* Building grid */}
      <Card className="p-4 lg:p-6">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 lg:gap-6 items-start">
          <div className="flex flex-col gap-2">
            {floors.map((f) => {
              const fc = leftByFloor[f];
              if (!fc) return <div key={`l-${f}`} className="h-10" />;
              const st = states[fc.device_id] || {};
              return <FancoilItem key={fc.id} fc={fc} state={st} hasAlarm={alarmDevices.has(fc.device_id)} side={1} />;
            })}
          </div>
          <div className="flex flex-col items-center justify-start">
            <div className="w-6 lg:w-10 bg-gradient-to-b from-sky-500/20 via-sky-500/40 to-sky-500/20 rounded-sm border border-sky-500/30"
                 style={{ minHeight: `${Math.max(floors.length, 1) * 48}px` }} />
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2">Prédio</div>
          </div>
          <div className="flex flex-col gap-2">
            {floors.map((f) => {
              const fc = rightByFloor[f];
              if (!fc) return <div key={`r-${f}`} className="h-10" />;
              const st = states[fc.device_id] || {};
              return <FancoilItem key={fc.id} fc={fc} state={st} hasAlarm={alarmDevices.has(fc.device_id)} side={2} />;
            })}
          </div>
        </div>
      </Card>

      {/* Floor labels aside */}
      <div className="text-center text-xs text-muted-foreground font-mono">
        Esquerda = Lado 1 • Direita = Lado 2 • Andares ordenados do topo ao térreo
      </div>
    </div>
  );
}
