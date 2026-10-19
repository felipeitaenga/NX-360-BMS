import React, { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

const TZ = "America/Sao_Paulo";
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? "--" : Number(v).toFixed(d));
const Y_WIDTH = 44;

function tickFormatter(range) {
  return (t) => {
    const d = new Date(t);
    return range <= 1
      ? d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
}

function SharedTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card/95 backdrop-blur px-3 py-2 text-xs font-mono shadow-lg" data-testid="history-tooltip">
      <div className="text-muted-foreground mb-1">
        {new Date(p.t).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="text-orange-400">Temperatura: {fmt(p.temperatura)} °C</div>
      <div className="text-emerald-400">Setpoint: {fmt(p.setpoint)} °C</div>
      <div className="text-sky-400">VAG: {fmt(p.vag, 0)}% ({fmt(p.vag_min, 0)}–{fmt(p.vag_max, 0)}%)</div>
      {p.pid != null && <div className="text-violet-400">Saída PID: {fmt(p.pid, 0)}%</div>}
    </div>
  );
}

function tempDomain(rows) {
  const vals = rows.flatMap((r) => [r.temperatura, r.setpoint]).filter((v) => typeof v === "number");
  if (!vals.length) return [18, 26];
  const lo = Math.floor(Math.min(...vals) - 1);
  const hi = Math.ceil(Math.max(...vals) + 1);
  return [lo, hi === lo ? lo + 2 : hi];
}

export function HistoryCharts({ history, range }) {
  const rows = useMemo(
    () => history.map((h) => ({
      t: new Date(h.timestamp).getTime(),
      temperatura: h.temperature,
      setpoint: h.setpoint,
      vag: h.vag,
      vag_min: h.vag_min ?? h.vag,
      vag_max: h.vag_max ?? h.vag,
      vag_range: h.vag == null ? null : [h.vag_min ?? h.vag, h.vag_max ?? h.vag],
      pid: h.pid ?? null,
    })),
    [history]
  );
  const xProps = {
    dataKey: "t", type: "number", scale: "time", domain: ["dataMin", "dataMax"],
    tickFormatter: tickFormatter(range), fontSize: 10, tick: { fill: "currentColor" }, minTickGap: 40,
  };
  const grid = <CartesianGrid strokeOpacity={0.12} vertical={false} />;
  const tip = <Tooltip content={<SharedTooltip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }} />;

  if (!rows.length) {
    return <div className="h-48 grid place-items-center text-sm text-muted-foreground" data-testid="history-empty">Sem dados no período.</div>;
  }

  return (
    <div className="space-y-1" data-testid="history-charts">
      <div className="flex gap-4 text-xs font-mono text-muted-foreground pl-12">
        <span className="text-orange-400">— Temperatura (°C)</span>
        <span className="text-emerald-400">— Setpoint (°C)</span>
      </div>
      <div style={{ width: "100%", height: 240 }} data-testid="history-chart-temp">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} syncId="fc-history" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            {grid}
            <XAxis {...xProps} hide />
            <YAxis width={Y_WIDTH} domain={tempDomain(rows)} allowDecimals={false} fontSize={10} tick={{ fill: "currentColor" }} unit="°" />
            {tip}
            <Line type="monotone" dataKey="temperatura" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="setpoint" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 text-xs font-mono text-muted-foreground pl-12 pt-2">
        <span className="text-sky-400">— VAG média (%)</span>
        <span className="text-sky-300/70">▒ mín–máx</span>
        {rows.some((r) => r.pid != null) && <span className="text-violet-400">- - Saída PID (%)</span>}
      </div>
      <div style={{ width: "100%", height: 110 }} data-testid="history-chart-vag">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId="fc-history" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            {grid}
            <XAxis {...xProps} />
            <YAxis width={Y_WIDTH} domain={[0, 100]} ticks={[0, 50, 100]} fontSize={10} tick={{ fill: "currentColor" }} unit="%" />
            {tip}
            <Area type="monotone" dataKey="vag_range" stroke="none" fill="#38bdf8" fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
            <Line type="monotone" dataKey="vag" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="pid" name="Saída PID (%)" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
