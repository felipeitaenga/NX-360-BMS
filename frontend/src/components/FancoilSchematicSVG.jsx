import React from "react";

/**
 * FancoilSchematicSVG — Animated HVAC schematic
 * Flow: Retorno (left) → Filtro → Serpentina + Válvula VAG → Ventilador → Insuflamento (right)
 */
export default function FancoilSchematicSVG({ running, temperature, setpoint, vag, tempError }) {
  const fanOpacity = running ? 1 : 0.5;
  const supplyColor = running ? "#38bdf8" : "#64748b";
  const returnColor = running ? "#f97316" : "#64748b";

  return (
    <svg
      viewBox="0 0 820 320"
      className="w-full h-auto"
      role="img"
      aria-label="Esquema do fancoil"
      data-testid="fancoil-schematic"
    >
      <defs>
        <linearGradient id="supplyGrad" x1="0" x2="1">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0.1" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="returnGrad" x1="1" x2="0">
          <stop offset="0" stopColor="#f97316" stopOpacity="0.1" />
          <stop offset="1" stopColor="#f97316" stopOpacity="0.6" />
        </linearGradient>
        <pattern id="filterPat" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 0 L8 8 M8 0 L0 8" stroke="#94a3b8" strokeWidth="1" />
        </pattern>
      </defs>

      {/* Casing */}
      <rect x="40" y="60" width="740" height="180" rx="14" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />

      {/* Return duct (left) */}
      <rect x="40" y="100" width="140" height="100" fill="url(#returnGrad)" stroke={returnColor} strokeWidth="2" />
      <text x="110" y="90" textAnchor="middle" fontSize="12" fill="currentColor" className="font-mono">RETORNO</text>
      {running && (
        <g stroke={returnColor} strokeWidth="2" fill="none" className="flow-arrows">
          <path d="M 55 150 L 165 150" />
          <path d="M 55 130 L 165 130" />
          <path d="M 55 170 L 165 170" />
        </g>
      )}

      {/* Filter G4 */}
      <rect x="200" y="100" width="40" height="100" fill="url(#filterPat)" stroke="#94a3b8" strokeWidth="2" />
      <text x="220" y="90" textAnchor="middle" fontSize="11" fill="currentColor" className="font-mono">FILTRO</text>

      {/* Coil + Valve */}
      <g>
        <rect x="260" y="100" width="140" height="100" fill="none" stroke="#0ea5e9" strokeWidth="2" />
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={`M ${270 + i * 26} 110 Q ${283 + i * 26} 150 ${270 + i * 26} 190`}
            stroke="#0ea5e9"
            strokeWidth="2.5"
            fill="none"
          />
        ))}
        <text x="330" y="90" textAnchor="middle" fontSize="11" fill="currentColor" className="font-mono">SERPENTINA</text>
        {/* VAG valve */}
        <circle cx="330" cy="235" r="18" fill="hsl(var(--card))" stroke="#0ea5e9" strokeWidth="2" />
        <text x="330" y="240" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0ea5e9" className="font-mono">
          {vag != null ? `${vag.toFixed(0)}%` : "--"}
        </text>
        <text x="330" y="275" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.7" className="font-mono">VAG</text>
      </g>

      {/* Fan */}
      <g transform="translate(500 150)">
        <circle r="52" fill="hsl(var(--card))" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
        <g className={running ? "spin-fan" : ""} opacity={fanOpacity}>
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <path
              key={a}
              d="M 0 0 Q 15 -20 0 -42 Q -15 -20 0 0 Z"
              fill="#38bdf8"
              transform={`rotate(${a})`}
            />
          ))}
          <circle r="8" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
        </g>
        <text x="0" y="80" textAnchor="middle" fontSize="11" fill="currentColor" className="font-mono">VENTILADOR</text>
      </g>

      {/* Supply duct */}
      <rect x="600" y="100" width="180" height="100" fill="url(#supplyGrad)" stroke={supplyColor} strokeWidth="2" />
      <text x="690" y="90" textAnchor="middle" fontSize="12" fill="currentColor" className="font-mono">INSUFLAMENTO</text>
      {running && (
        <g stroke={supplyColor} strokeWidth="2" fill="none" className="flow-arrows">
          <path d="M 610 130 L 770 130" />
          <path d="M 610 150 L 770 150" />
          <path d="M 610 170 L 770 170" />
        </g>
      )}

      {/* Temperature sensor badge */}
      <g transform="translate(110 42)">
        <rect x="-55" y="-16" width="110" height="30" rx="4" fill={tempError ? "#ef4444" : "hsl(var(--card))"} stroke={tempError ? "#ef4444" : "#f97316"} strokeWidth="1.5" />
        <text x="0" y="4" textAnchor="middle" fontSize="13" fontWeight="700" fill={tempError ? "#fff" : "currentColor"} className="font-mono">
          {tempError ? "SENSOR ERRO" : temperature != null ? `${temperature.toFixed(1)} °C` : "--"}
        </text>
      </g>

      {/* Setpoint */}
      <g transform="translate(690 42)">
        <rect x="-55" y="-16" width="110" height="30" rx="4" fill="hsl(var(--card))" stroke="#10b981" strokeWidth="1.5" />
        <text x="0" y="4" textAnchor="middle" fontSize="13" fontWeight="700" fill="#10b981" className="font-mono">
          SP {setpoint != null ? `${setpoint.toFixed(1)} °C` : "--"}
        </text>
      </g>
    </svg>
  );
}
