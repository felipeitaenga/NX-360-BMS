import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "../components/ui/card";
import { Thermometer } from "lucide-react";

function tempColor(t, min = 15, max = 30) {
  if (t == null) return { bg: "#1e293b", fg: "#64748b" };
  // Blue (cold) -> green (ok) -> red (hot)
  const clamped = Math.max(min, Math.min(max, t));
  const ratio = (clamped - min) / (max - min); // 0..1
  // Blend: 0 => #0ea5e9, 0.5 => #10b981, 1.0 => #ef4444
  let r, g, b;
  if (ratio < 0.5) {
    const k = ratio / 0.5;
    r = Math.round(14 + (16 - 14) * k);
    g = Math.round(165 + (185 - 165) * k);
    b = Math.round(233 + (129 - 233) * k);
  } else {
    const k = (ratio - 0.5) / 0.5;
    r = Math.round(16 + (239 - 16) * k);
    g = Math.round(185 + (68 - 185) * k);
    b = Math.round(129 + (68 - 129) * k);
  }
  return { bg: `rgb(${r} ${g} ${b} / 0.85)`, fg: "#fff" };
}

export default function MapaCalor() {
  const { data: cells = [] } = useQuery({
    queryKey: ["heatmap"],
    queryFn: async () => (await api.get("/heatmap")).data,
    refetchInterval: 15000,
  });
  const { states } = useTelemetry();

  const { floors, byFloorSide, min, max } = useMemo(() => {
    const by = {};
    const floorsSet = new Set();
    let minT = Infinity, maxT = -Infinity;
    cells.forEach((c) => {
      const live = states[c.name] ? {} : {};
      // merge live state by matching device_id to cell.name? We only have cells by id; use states by device_id.
      floorsSet.add(c.floor);
      by[c.floor] = by[c.floor] || {};
      by[c.floor][c.side] = c;
      if (typeof c.temperature === "number") {
        if (c.temperature < minT) minT = c.temperature;
        if (c.temperature > maxT) maxT = c.temperature;
      }
    });
    return {
      floors: [...floorsSet].sort((a, b) => b - a),
      byFloorSide: by,
      min: minT === Infinity ? 18 : Math.floor(minT),
      max: maxT === -Infinity ? 30 : Math.ceil(maxT),
    };
  }, [cells, states]);

  const Cell = ({ c }) => {
    if (!c) return <div className="h-14 rounded border border-dashed border-border/40" />;
    const live = Object.values(states).find((s) => s && s.device_id === c.name) || {};
    const temp = c.temperature;
    const color = tempColor(temp, min, max);
    const online = c.online !== false;
    return (
      <Link
        to={`/ar-condicionado/${c.id}`}
        data-testid={`heatmap-${c.name.toLowerCase()}`}
        className="relative block h-14 rounded border border-border overflow-hidden group hover:ring-2 hover:ring-sky-400 transition-all"
        style={{ background: online && temp != null ? color.bg : "hsl(var(--muted))" }}
      >
        <div className="absolute inset-0 flex items-center justify-between px-3">
          <span className="font-mono text-xs font-bold" style={{ color: online && temp != null ? color.fg : "hsl(var(--muted-foreground))" }}>
            {c.name}
          </span>
          <span className="font-display text-base font-black" style={{ color: online && temp != null ? color.fg : "hsl(var(--muted-foreground))" }}>
            {c.temp_error ? "ERRO" : temp != null ? `${temp.toFixed(1)}°` : "--"}
          </span>
        </div>
      </Link>
    );
  };

  const Legend = () => {
    const steps = 10;
    const ticks = Array.from({ length: steps + 1 }, (_, i) => min + ((max - min) * i) / steps);
    return (
      <div className="flex items-center gap-3 text-xs font-mono">
        <span className="text-sky-400 font-bold">{min}°</span>
        <div className="flex-1 h-3 rounded overflow-hidden flex">
          {ticks.map((t, i) => {
            const { bg } = tempColor(t, min, max);
            return <div key={i} className="flex-1" style={{ background: bg }} />;
          })}
        </div>
        <span className="text-red-400 font-bold">{max}°</span>
      </div>
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="mapa-calor-page">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
          <Thermometer className="w-8 h-8 text-orange-400" /> Mapa de Calor
        </h1>
        <div className="text-muted-foreground text-sm mt-1">
          Temperatura em tempo real por andar e lado
        </div>
      </div>

      <Card className="p-4 lg:p-6">
        <Legend />
      </Card>

      <Card className="p-4 lg:p-6">
        <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-3 items-center">
          <div className="font-mono text-xs uppercase text-muted-foreground text-right pr-2">Andar</div>
          <div className="font-display font-black text-center text-sky-400">LADO 1</div>
          <div className="font-mono text-xs uppercase text-muted-foreground text-center">│</div>
          <div className="font-display font-black text-center text-sky-400">LADO 2</div>

          {floors.map((f) => (
            <React.Fragment key={f}>
              <div className="font-mono text-sm font-bold text-right pr-2 text-muted-foreground">{f}º</div>
              <Cell c={byFloorSide[f]?.[1]} />
              <div className="w-px h-10 bg-border mx-auto" />
              <Cell c={byFloorSide[f]?.[2]} />
            </React.Fragment>
          ))}
        </div>
      </Card>
    </div>
  );
}
