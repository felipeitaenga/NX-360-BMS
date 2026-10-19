import React from "react";
import { Card } from "./ui/card";
import { Activity, AlertTriangle } from "lucide-react";

const fmt = (v, d = 1, u = "") => (v == null || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(d)}${u}`);

function Cell({ label, value, color = "text-foreground", testid }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono font-bold text-base ${color}`} data-testid={testid}>{value}</div>
    </div>
  );
}

// PID/STATE (firmware ≥ 1.4.4) — somente leitura; ajuste no modal "Editar fancoil"
export function PidRealtimePanel({ st }) {
  const s = st.pid_state;
  const spMismatch = st.setpoint_state != null && st.setpoint != null && Math.abs(st.setpoint_state - st.setpoint) > 0.05;
  return (
    <Card className="p-5 bg-card/80" data-testid="pid-realtime-panel">
      <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-violet-400" /> Controle em tempo real
        {st.pid_state_at && <span className="ml-auto text-[10px] normal-case tracking-normal font-mono">{new Date(st.pid_state_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>}
      </h2>
      {spMismatch && (
        <div className="mb-3 text-xs text-amber-300 flex items-center gap-2" data-testid="pid-sp-mismatch">
          <AlertTriangle className="w-4 h-4" /> Controladora usando SP {fmt(st.setpoint_state, 1, " °C")} (enviado {fmt(st.setpoint, 1, " °C")})
        </div>
      )}
      {!s ? (
        <div className="text-xs text-muted-foreground" data-testid="pid-realtime-empty">Sem dados de PID — firmware sem suporte (requer 1.4.4+).</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Cell label="SP real" value={fmt(s.sp, 1, " °C")} color="text-emerald-400" testid="pid-sp" />
          <Cell label="Temp. filtrada" value={fmt(s.temp, 1, " °C")} color="text-orange-400" testid="pid-temp" />
          <Cell label="Erro (SP − T)" value={s.erro == null ? "—" : `${s.erro > 0 ? "+" : ""}${Number(s.erro).toFixed(1)} °C`} color={s.erro == null ? "text-muted-foreground" : s.erro < 0 ? "text-sky-400" : "text-amber-400"} testid="pid-erro" />
          <Cell label="Saída PID" value={fmt(s.pid, 1, " %")} color="text-violet-400" testid="pid-out" />
          <Cell label="VAG aplicada" value={fmt(s.vag, 1, " %")} color="text-sky-400" testid="pid-vag" />
          <Cell label="Zona morta" value={s.zm ? "SIM (congelada)" : "não"} color={s.zm ? "text-amber-400" : "text-muted-foreground"} testid="pid-zm" />
        </div>
      )}
    </Card>
  );
}
