import React, { useState } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";

export const PID_PROFILES = {
  MUITO_LENTO: { label: "Muito lento", kp: 45, ti: 290, taxa: 10, zm: 0.2, help: "Mais estável (~9 %/min com 1 °C de erro; 0→100 % em ~5 min)" },
  LENTO: { label: "Lento", kp: 52, ti: 190, taxa: 14, zm: 0.2, help: "~16 %/min com 1 °C de erro; 0→100 % em ~3,5 min" },
  NORMAL: { label: "Normal", kp: 60, ti: 120, taxa: 20, zm: 0.15, help: "Padrão (~30 %/min com 1 °C de erro; 0→100 % em ~2,5 min)" },
  RAPIDO: { label: "Rápido", kp: 75, ti: 80, taxa: 30, zm: 0.15, help: "~55 %/min com 1 °C de erro; pode oscilar" },
  MUITO_RAPIDO: { label: "Muito rápido", kp: 90, ti: 50, taxa: 40, zm: 0.1, help: "~80 %/min; alto risco de oscilar — observe a VAG" },
};
const FIELDS = [
  { k: "kp", label: "Kp (5–150)", min: 5, max: 150, step: 1 },
  { k: "ti", label: "Ti em segundos (30–3600)", min: 30, max: 3600, step: 5 },
  { k: "taxa", label: "Taxa %/ciclo (1–50)", min: 1, max: 50, step: 1 },
  { k: "zm", label: "Zona morta °C (0,1–1,0)", min: 0.1, max: 1, step: 0.05 },
];

export const pidLabel = (p) => (p === "PERSONALIZADO" ? "Personalizado" : PID_PROFILES[p]?.label || p || "—");

export const pidFromProfile = (perfil) => ({ perfil, ...Object.fromEntries(FIELDS.map((f) => [f.k, PID_PROFILES[perfil][f.k]])) });

// Valor inicial: desejado salvo → config da controladora → NORMAL
export function initialPid(fc) {
  const d = fc?.pid_desejado || fc?.pid_config;
  if (d?.perfil === "PERSONALIZADO") return { perfil: "PERSONALIZADO", kp: d.kp, ti: d.ti, taxa: d.taxa, zm: d.zm };
  if (d?.perfil && PID_PROFILES[d.perfil]) return pidFromProfile(d.perfil);
  return pidFromProfile("NORMAL");
}

export function pidMatches(desired, config) {
  if (!desired || !config || config.erro || config.perfil !== desired.perfil) return false;
  if (desired.perfil !== "PERSONALIZADO") return true;
  return FIELDS.every((f) => Math.abs(Number(config[f.k]) - Number(desired[f.k])) < 1e-6);
}

export const pidEqual = (a, b) => a?.perfil === b?.perfil && (a?.perfil !== "PERSONALIZADO" || FIELDS.every((f) => Number(a[f.k]) === Number(b[f.k])));

export const pidValid = (p) => p?.perfil !== "PERSONALIZADO" || FIELDS.every((f) => p[f.k] !== "" && Number(p[f.k]) >= f.min && Number(p[f.k]) <= f.max);

function PidStatus({ value, live }) {
  const cfg = live?.pid_config;
  if (!cfg) return <div className="text-xs text-muted-foreground" data-testid="pid-status">Firmware sem suporte (requer 1.4.4+)</div>;
  if (!live.online) return <div className="text-xs text-amber-400" data-testid="pid-status">Controladora offline — será aplicado quando reconectar</div>;
  const ok = pidMatches(value, cfg);
  return (
    <div className={`text-xs font-mono ${ok ? "text-emerald-400" : "text-amber-400"}`} data-testid="pid-status">
      Controladora: {pidLabel(cfg.perfil)}{ok ? " ✓" : " — pendente envio"}
      {cfg.erro && <span className="text-red-400"> · erro: {cfg.erro}</span>}
    </div>
  );
}

export function PidSection({ value, onChange, live, isAdmin }) {
  const [custom, setCustom] = useState(value?.perfil === "PERSONALIZADO");
  const unsupported = !live?.pid_config;
  const readOnly = !isAdmin || unsupported;
  const isCustom = value?.perfil === "PERSONALIZADO";
  const pick = (p) => !readOnly && onChange(pidFromProfile(p));
  const setField = (k, v) => onChange({ ...value, perfil: "PERSONALIZADO", [k]: v === "" ? "" : Number(v) });
  return (
    <div className={`space-y-2 ${unsupported ? "opacity-60" : ""}`} data-testid="pid-section">
      <Label className="text-[10px] uppercase">Velocidade do controle (PID)</Label>
      <div className="grid grid-cols-5 rounded-md border border-border overflow-hidden" role="radiogroup">
        {Object.entries(PID_PROFILES).map(([k, p]) => (
          <button key={k} type="button" disabled={readOnly} onClick={() => pick(k)} data-testid={`pid-profile-${k}`}
            className={`px-1 py-2 text-[11px] sm:text-xs transition-colors border-r border-border last:border-r-0 disabled:cursor-not-allowed ${value?.perfil === k ? "bg-sky-500/20 text-sky-200 font-bold" : "hover:bg-muted/40 text-foreground/80"}`}>
            {p.label}
          </button>
        ))}
      </div>
      {isAdmin && !unsupported && (
        <button type="button" className={`text-xs underline ${isCustom ? "text-sky-300" : "text-muted-foreground"}`} onClick={() => setCustom((c) => !c)} data-testid="pid-custom-toggle">
          Personalizado {isCustom ? "(em uso)" : ""}
        </button>
      )}
      {(custom || isCustom) && (
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.k}>
              <Label className="text-[10px] uppercase">{f.label}</Label>
              <Input type="number" min={f.min} max={f.max} step={f.step} value={value?.[f.k] ?? ""} disabled={readOnly}
                onChange={(e) => setField(f.k, e.target.value)} data-testid={`pid-field-${f.k}`} />
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-muted-foreground" data-testid="pid-help">
        {isCustom ? "Valores personalizados — confira as faixas antes de salvar" : PID_PROFILES[value?.perfil]?.help}
      </div>
      {!pidValid(value) && <div className="text-xs text-red-400">Algum valor está fora da faixa.</div>}
      <PidStatus value={value} live={live} />
    </div>
  );
}
