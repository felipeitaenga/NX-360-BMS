import React from "react";

/**
 * FancoilSchematicSVG v2 — Perspective fancoil with spinning fan, moving airflow particles,
 * animated damper, chilled-water coil with highlight.
 */
export default function FancoilSchematicSVG({ running, temperature, setpoint, vag, tempError }) {
  return (
    <svg
      viewBox="0 0 880 340"
      className="w-full h-auto"
      role="img"
      aria-label="Esquema do fancoil"
      data-testid="fancoil-schematic"
    >
      <defs>
        <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="45%" stopColor="#334155" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="returnDuct" x1="0" x2="1">
          <stop offset="0" stopColor="#f97316" stopOpacity="0.0" />
          <stop offset="1" stopColor="#f97316" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id="supplyDuct" x1="0" x2="1">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0.65" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0.0" />
        </linearGradient>
        <pattern id="coilPat" width="12" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 0 Q 6 12 0 24" stroke="#38bdf8" strokeWidth="2" fill="none" />
          <path d="M12 0 Q 6 12 12 24" stroke="#38bdf8" strokeWidth="2" fill="none" />
        </pattern>
        <pattern id="filterPat" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 0 L6 6 M6 0 L0 6" stroke="#94a3b8" strokeWidth="0.8" />
        </pattern>
        <radialGradient id="fanGlow">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Casing shadow */}
      <rect x="24" y="72" width="832" height="180" rx="10" fill="url(#metal)" opacity="0.15" />
      <rect x="24" y="72" width="832" height="180" rx="10" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />

      {/* Return duct (left) */}
      <g>
        <rect x="40" y="110" width="150" height="110" fill="url(#returnDuct)" stroke="#f97316" strokeOpacity="0.6" strokeWidth="1.5" />
        <text x="115" y="100" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.8" className="font-mono tracking-wider">RETORNO</text>
        {running && (
          <g stroke="#f97316" strokeWidth="2" fill="none" opacity="0.8">
            <path d="M 48 140 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 15">
              <animate attributeName="stroke-dashoffset" from="24" to="0" dur="0.8s" repeatCount="indefinite" />
              <animate attributeName="stroke-dasharray" values="4 8;4 8" dur="0.8s" />
            </path>
            <path d="M 48 165 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 15">
              <animate attributeName="stroke-dashoffset" from="24" to="0" dur="0.6s" repeatCount="indefinite" />
            </path>
            <path d="M 48 190 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 15">
              <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.0s" repeatCount="indefinite" />
            </path>
          </g>
        )}
      </g>

      {/* Filter G4 */}
      <g>
        <rect x="210" y="110" width="36" height="110" fill="url(#filterPat)" stroke="#94a3b8" strokeWidth="1.5" />
        <text x="228" y="100" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.8" className="font-mono tracking-wider">FILTRO</text>
      </g>

      {/* Coil + chilled water pipes */}
      <g>
        <rect x="266" y="110" width="130" height="110" fill="url(#coilPat)" stroke="#0ea5e9" strokeWidth="1.5" opacity="0.9" />
        <text x="331" y="100" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.8" className="font-mono tracking-wider">SERPENTINA</text>
        {/* Pipes top-right into coil */}
        <path d="M 410 90 Q 410 110 400 115 L 400 130" stroke="#0ea5e9" strokeWidth="4" fill="none" />
        <path d="M 440 90 Q 440 110 430 115 L 430 200" stroke="#0ea5e9" strokeWidth="4" fill="none" />
        {/* VAG valve on top pipe */}
        <g transform="translate(410 72)">
          <circle r="16" fill="hsl(var(--card))" stroke="#0ea5e9" strokeWidth="2.5" />
          <circle r="10" fill={running ? "#0ea5e9" : "#334155"} opacity={running ? "0.5" : "0.3"} />
          <text y="4" textAnchor="middle" fontSize="11" fontWeight="800" fill={running ? "#0ea5e9" : "#64748b"} className="font-mono">
            {vag != null ? `${vag.toFixed(0)}%` : "--"}
          </text>
        </g>
        <text x="410" y="48" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7" className="font-mono tracking-wider">VAG</text>
      </g>

      {/* Fan with glow */}
      <g transform="translate(540 165)">
        {running && <circle r="78" fill="url(#fanGlow)" />}
        <circle r="56" fill="hsl(var(--card))" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
        <circle r="52" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="2 4" />
        <g key={running ? "spin-on" : "spin-off"}>
          {running && (
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="0 0 0"
              to="360 0 0"
              dur="0.6s"
              repeatCount="indefinite"
            />
          )}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <path
              key={angle}
              d="M 0 0 Q 10 -16 2 -46 Q -10 -36 -8 -20 Q -2 -12 0 0 Z"
              fill="#38bdf8"
              transform={`rotate(${angle})`}
              opacity={running ? "0.95" : "0.45"}
            />
          ))}
          <circle r="7" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
          <circle r="3" fill="#38bdf8" />
        </g>
        <text y="78" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.8" className="font-mono tracking-wider">VENTILADOR</text>
      </g>

      {/* Supply duct */}
      <g>
        <rect x="620" y="110" width="200" height="110" fill="url(#supplyDuct)" stroke="#38bdf8" strokeOpacity="0.6" strokeWidth="1.5" />
        <text x="720" y="100" textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.8" className="font-mono tracking-wider">INSUFLAMENTO</text>
        {running && (
          <g stroke="#38bdf8" strokeWidth="2" fill="none" opacity="0.9">
            <path d="M 630 140 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 10">
              <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="0.7s" repeatCount="indefinite" />
              <animate attributeName="stroke-dasharray" values="6 8;6 8" dur="0.7s" />
            </path>
            <path d="M 630 165 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 10">
              <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="0.5s" repeatCount="indefinite" />
            </path>
            <path d="M 630 190 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 20 m 10 0 h 10">
              <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="0.9s" repeatCount="indefinite" />
            </path>
            {/* Floating particles */}
            {[0, 1, 2, 3, 4].map((i) => (
              <circle key={i} r="2.5" fill="#38bdf8" opacity="0.9">
                <animate attributeName="cx" from="630" to="820" dur={`${1.6 + i * 0.3}s`} repeatCount="indefinite" />
                <animate attributeName="cy" values={`${130 + i * 15};${145 + i * 12};${130 + i * 15}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.9;0" dur={`${1.6 + i * 0.3}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </g>
        )}
      </g>

      {/* Temperature badge over return */}
      <g transform="translate(115 50)">
        <rect x="-56" y="-18" width="112" height="34" rx="6" fill={tempError ? "#ef4444" : "hsl(var(--card))"} stroke={tempError ? "#ef4444" : "#f97316"} strokeWidth="2" />
        <text x="0" y="5" textAnchor="middle" fontSize="14" fontWeight="800" fill={tempError ? "#fff" : "currentColor"} className="font-mono">
          {tempError ? "SENSOR ERRO" : temperature != null ? `${temperature.toFixed(1)} °C` : "--"}
        </text>
      </g>

      {/* Setpoint badge over supply */}
      <g transform="translate(720 50)">
        <rect x="-56" y="-18" width="112" height="34" rx="6" fill="hsl(var(--card))" stroke="#10b981" strokeWidth="2" />
        <text x="0" y="5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#10b981" className="font-mono">
          SP {setpoint != null ? `${setpoint.toFixed(1)} °C` : "--"}
        </text>
      </g>

      {/* Base label */}
      <text x="440" y="285" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.4" className="font-mono tracking-widest">
        FLUXO: RETORNO → FILTRO → SERPENTINA → VENTILADOR → INSUFLAMENTO
      </text>
    </svg>
  );
}
