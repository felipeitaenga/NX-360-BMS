import React from "react";

/**
 * FancoilSchematicSVG v3 — Representação lateral mais rica do fancoil.
 * Cores da serpentina reagem à abertura da VAG (0% = seco/escuro, 100% = cheio/vívido).
 * Setores: retorno (grelha laranja), filtro G4 (zigzag), serpentina (aletas + gotas),
 * ventilador centrífugo com motor "M", insuflamento (grelha azul).
 * Tubos AG RET (quente) / AG ALIM (fria) chegam pelo topo passando pela válvula VAG.
 */
export default function FancoilSchematicSVG({
  running,
  temperature,          // T RETORNO (ambiente)
  supplyTemp,           // T INSUFL. (opcional — se não tiver, mostra --)
  setpoint,
  vag,                  // 0..100 %
  tempError,
}) {
  const vagPct = Math.max(0, Math.min(100, Number(vag) || 0));
  const wet = running && vagPct > 0;
  // Intensidade da serpentina: 0 → cinza; 100 → cyan vívido
  const coilAlpha = 0.15 + 0.75 * (vagPct / 100);
  // Cor da serpentina transiciona de cinza para cyan conforme VAG
  const coilHue = wet ? "#38bdf8" : "#64748b";
  const dropCount = Math.round((vagPct / 100) * 24); // nº de gotículas visíveis

  // Jitter determinístico para gotículas (padrão repetível)
  const drops = [];
  for (let i = 0; i < 24; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    drops.push({
      x: 282 + col * 32 + ((i * 17) % 8),
      y: 128 + row * 14 + ((i * 11) % 6),
      r: 2.2 + ((i * 7) % 10) / 15,
      delay: (i * 0.17) % 2.4,
      visible: i < dropCount,
    });
  }

  return (
    <svg
      viewBox="0 0 880 360"
      className="w-full h-auto"
      role="img"
      aria-label="Esquema do fancoil"
      data-testid="fancoil-schematic"
    >
      <defs>
        {/* Casing com perspectiva */}
        <linearGradient id="cabinet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="40%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#020617" />
        </linearGradient>
        <linearGradient id="cabinetEdge" x1="0" x2="1">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="50%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>

        {/* Grelhas */}
        <pattern id="returnGrille" width="18" height="20" patternUnits="userSpaceOnUse">
          <rect width="18" height="20" fill="#7c2d12" />
          <rect x="2" y="3" width="14" height="2" fill="#ea580c" opacity="0.85" />
          <rect x="2" y="8" width="14" height="2" fill="#ea580c" opacity="0.85" />
          <rect x="2" y="13" width="14" height="2" fill="#ea580c" opacity="0.85" />
          <rect x="2" y="18" width="14" height="1.5" fill="#ea580c" opacity="0.85" />
        </pattern>
        <pattern id="supplyGrille" width="18" height="20" patternUnits="userSpaceOnUse">
          <rect width="18" height="20" fill="#082f49" />
          <rect x="2" y="3" width="14" height="2" fill="#38bdf8" opacity="0.9" />
          <rect x="2" y="8" width="14" height="2" fill="#38bdf8" opacity="0.9" />
          <rect x="2" y="13" width="14" height="2" fill="#38bdf8" opacity="0.9" />
          <rect x="2" y="18" width="14" height="1.5" fill="#38bdf8" opacity="0.9" />
        </pattern>

        {/* Serpentina: aletas verticais sempre visíveis + glow dinâmico */}
        <pattern id="coilFins" width="7" height="24" patternUnits="userSpaceOnUse">
          <rect width="7" height="24" fill="#1e293b" />
          <line x1="1.5" y1="0" x2="1.5" y2="24" stroke="#475569" strokeOpacity="0.9" strokeWidth="1" />
          <line x1="4.5" y1="0" x2="4.5" y2="24" stroke="#475569" strokeOpacity="0.9" strokeWidth="1" />
        </pattern>
        {/* Overlay de "água fria" na serpentina — intensidade segue a VAG */}
        <linearGradient id="coilWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity={coilAlpha} />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity={coilAlpha * 0.7} />
        </linearGradient>

        {/* Filtro G4 */}
        <pattern id="filterZZ" width="12" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 24 L6 0 L12 24" stroke="#94a3b8" strokeWidth="1.3" fill="none" />
        </pattern>

        {/* Glow do ventilador */}
        <radialGradient id="fanGlow">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>

        {/* Dreno da bandeja */}
        <linearGradient id="drainMetal" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#475569" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
      </defs>

      {/* ===== Tubulação hidráulica (topo) ===== */}
      {/* AG RET (quente) — volta de água quente, sobe à direita da serpentina */}
      <g>
        <path d="M 230 20 L 230 70 Q 230 86 246 86 L 440 86 L 440 115"
              stroke="#f43f5e" strokeWidth="7" fill="none" strokeLinejoin="round" />
        <text x="230" y="14" textAnchor="middle" fontSize="11" fontWeight="800"
              fill="#f43f5e" className="font-mono tracking-wider">AG RET</text>
      </g>
      {/* AG ALIM (fria) — alimentação de água gelada, entra pela válvula VAG */}
      <g>
        <path d="M 410 20 L 410 115" stroke="#38bdf8" strokeWidth="7" fill="none" />
        <text x="410" y="14" textAnchor="middle" fontSize="11" fontWeight="800"
              fill="#38bdf8" className="font-mono tracking-wider">AG ALIM</text>
      </g>

      {/* Válvula VAG — mostra abertura % */}
      <g transform="translate(410 100)">
        <rect x="-18" y="-6" width="36" height="12" rx="2" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
        <rect x="-14" y="-3" width={28 * (vagPct / 100)} height="6" fill="#38bdf8" opacity={vagPct > 0 ? 0.9 : 0.3} />
      </g>
      <g transform="translate(470 100)">
        <rect x="-28" y="-18" width="56" height="36" rx="4" fill="hsl(var(--card))" stroke="#38bdf8" strokeWidth="1.5" />
        <text x="0" y="-4" textAnchor="middle" fontSize="9" fill="#38bdf8" opacity="0.8" className="font-mono tracking-widest">VAG</text>
        <text x="0" y="12" textAnchor="middle" fontSize="14" fontWeight="900"
              fill={vagPct > 0 ? "#38bdf8" : "#64748b"} className="font-mono">
          {vag != null ? `${vagPct.toFixed(0)}%` : "--"}
        </text>
      </g>

      {/* ===== Gabinete ===== */}
      <rect x="30" y="130" width="820" height="170" rx="14" fill="url(#cabinet)" stroke="url(#cabinetEdge)" strokeWidth="2" />
      {/* Linha de perspectiva */}
      <path d="M 44 130 L 60 118 L 836 118 L 850 130" fill="url(#cabinetEdge)" opacity="0.4" />
      <path d="M 850 130 L 836 118 L 836 288 L 850 300 Z" fill="#0f172a" opacity="0.5" />

      {/* ===== RETORNO (grelha laranja) ===== */}
      <g>
        <rect x="48" y="146" width="150" height="138" rx="4" fill="url(#returnGrille)" stroke="#9a3412" strokeWidth="1.5" />
        {running && (
          <g stroke="#fdba74" strokeWidth="2.5" fill="none" opacity="0.6" strokeLinecap="round">
            {[160, 185, 210, 235, 260].map((y, i) => (
              <path key={y} d={`M 60 ${y} h 120`} strokeDasharray="4 10">
                <animate attributeName="stroke-dashoffset" from="14" to="0" dur={`${0.7 + i * 0.15}s`} repeatCount="indefinite" />
              </path>
            ))}
          </g>
        )}
      </g>

      {/* ===== FILTRO G4 (zigzag) ===== */}
      <g>
        <rect x="212" y="146" width="42" height="138" rx="2" fill="url(#filterZZ)" stroke="#64748b" strokeWidth="1.5" />
      </g>

      {/* ===== SERPENTINA (aletas + tubos horizontais + gotas) ===== */}
      <g>
        {/* Base: aletas verticais SEMPRE visíveis (estrutura) */}
        <rect x="268" y="146" width="160" height="138" rx="2" fill="url(#coilFins)"
              stroke="#64748b" strokeWidth="1.5" />
        {/* Overlay azul = água circulando (intensidade pela VAG) */}
        <rect x="268" y="146" width="160" height="138" rx="2" fill="url(#coilWater)" />
        {/* Tubos (serpentinados) horizontais — SEMPRE visíveis */}
        {[158, 180, 202, 224, 246, 268].map((y, i) => (
          <g key={y}>
            <path
              d={
                i % 2 === 0
                  ? `M 272 ${y} L 418 ${y} Q 428 ${y} 428 ${y + 11} L 428 ${y + 11}`
                  : `M 428 ${y} L 272 ${y} Q 268 ${y} 268 ${y - 11}`
              }
              stroke="#0ea5e9"
              strokeOpacity={0.4 + 0.5 * (vagPct / 100)}
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        ))}
        {/* Gotículas: aparecem quando VAG > 0 */}
        {drops.map((d, i) =>
          d.visible ? (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#7dd3fc" opacity="0.95">
              {wet && (
                <animate
                  attributeName="cy"
                  values={`${d.y};${d.y + 10};${d.y}`}
                  dur={`${2.4 + d.delay}s`}
                  begin={`${d.delay}s`}
                  repeatCount="indefinite"
                />
              )}
            </circle>
          ) : null
        )}
        {/* Bandeja de dreno */}
        <rect x="268" y="283" width="160" height="7" fill="url(#drainMetal)" stroke="#64748b" strokeWidth="1" />
        <path d="M 330 290 L 330 304 L 352 304" stroke="#475569" strokeWidth="4" fill="none" />
        {/* Tubos verticais de alimentação (sempre visíveis) */}
        <path d="M 410 115 L 410 146" stroke="#38bdf8" strokeWidth="6" fill="none" />
        <path d="M 440 115 L 440 146" stroke="#f43f5e" strokeWidth="6" fill="none" opacity="0.9" />
      </g>

      {/* ===== VENTILADOR CENTRÍFUGO (voluta + rotor interno) ===== */}
      <g transform="translate(540 215)">
        {running && <circle r="78" fill="url(#fanGlow)" />}

        {/* Voluta / scroll housing — gabinete em espiral */}
        <path
          d="M -58 -56 Q -62 -62 -54 -62 L 56 -62 Q 72 -58 72 -14 L 72 24 Q 72 36 60 42 L 64 60 Q 66 68 58 68 L -32 68 Q -58 68 -70 48 Q -82 20 -74 -14 Q -70 -36 -58 -56 Z"
          fill="#0f172a"
          stroke="#475569"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Saída de ar (parafusada ao gabinete) */}
        <rect x="60" y="36" width="18" height="24" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />

        {/* Carcaça interna circular do rotor */}
        <circle r="46" fill="#020617" stroke="#334155" strokeWidth="1.5" />
        <circle r="43" fill="none" stroke="#1e293b" strokeWidth="1" strokeDasharray="2 4" />

        {/* Pás curvadas (centrifugal forward-curved) */}
        <g className={running ? "fan-rotate" : ""} style={{ transformOrigin: "0px 0px" }}>
          {Array.from({ length: 14 }).map((_, idx) => {
            const angle = (idx * 360) / 14;
            return (
              <path
                key={idx}
                d="M 0 -18 Q 12 -32 10 -42 Q 2 -42 -4 -34 Q -4 -26 0 -18 Z"
                fill="#38bdf8"
                opacity={running ? 0.9 : 0.5}
                transform={`rotate(${angle})`}
              />
            );
          })}
          {/* Hub central */}
          <circle r="9" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
          <circle r="4" fill="#38bdf8" />
          <circle r="1.5" fill="#0f172a" />
        </g>

        {/* Pontos de parafuso do gabinete */}
        {[[-50, -46], [50, -46], [-56, 50], [50, 50]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2" fill="#334155" stroke="#64748b" strokeWidth="0.6" />
        ))}

        {/* Motor "M" acoplado abaixo */}
        <g transform="translate(0 86)">
          <rect x="-18" y="-12" width="36" height="24" rx="4" fill="#1e293b" stroke="#64748b" strokeWidth="1.5" />
          <circle cx="-11" cy="0" r="1.2" fill="#64748b" />
          <circle cx="11" cy="0" r="1.2" fill="#64748b" />
          <text y="5" textAnchor="middle" fontSize="14" fontWeight="900"
                fill={running ? "#10b981" : "#64748b"} className="font-mono">M</text>
        </g>
        {/* Eixo motor → rotor */}
        <line x1="0" y1="46" x2="0" y2="74" stroke="#475569" strokeWidth="2" />
      </g>

      {/* ===== INSUFLAMENTO (grelha azul) ===== */}
      <g>
        <rect x="660" y="146" width="180" height="138" rx="4" fill="url(#supplyGrille)" stroke="#0369a1" strokeWidth="1.5" />
        {running && (
          <g stroke="#7dd3fc" strokeWidth="2.5" fill="none" opacity="0.7" strokeLinecap="round">
            {[160, 185, 210, 235, 260].map((y, i) => (
              <path key={y} d={`M 672 ${y} h 158`} strokeDasharray="6 10">
                <animate attributeName="stroke-dashoffset" from="0" to="-16" dur={`${0.6 + i * 0.1}s`} repeatCount="indefinite" />
              </path>
            ))}
          </g>
        )}
      </g>

      {/* ===== Rótulos dos setores ===== */}
      <g fontSize="10" className="font-mono tracking-wider" fill="currentColor" opacity="0.7">
        <text x="123" y="320" textAnchor="middle">RETORNO</text>
        <text x="233" y="320" textAnchor="middle">FILTRO</text>
        <text x="348" y="320" textAnchor="middle" fontWeight="700" fill="#38bdf8" opacity={0.5 + 0.5 * (vagPct / 100)}>
          SERPENTINA
        </text>
        <text x="348" y="334" textAnchor="middle" fontSize="8" opacity="0.5">BANDEJA DRENO</text>
        <text x="540" y="320" textAnchor="middle">VENTILADOR</text>
        <text x="540" y="334" textAnchor="middle" fontSize="8" fontWeight="700"
              fill={running ? "#10b981" : "#64748b"} opacity="0.9">
          {running ? "LIGADO" : "DESLIGADO"}
        </text>
        <text x="750" y="320" textAnchor="middle">INSUFLAMENTO</text>
      </g>

      {/* ===== Badges flutuantes (topo) ===== */}
      {/* T RETORNO */}
      <g transform="translate(100 48)">
        <rect x="-56" y="-18" width="112" height="36" rx="6"
              fill="hsl(var(--card))" stroke={tempError ? "#ef4444" : "#f97316"} strokeWidth="2" />
        <text x="0" y="-3" textAnchor="middle" fontSize="9" fill="#f97316" opacity="0.9" className="font-mono tracking-widest">T RETORNO</text>
        <text x="0" y="13" textAnchor="middle" fontSize="14" fontWeight="900"
              fill={tempError ? "#ef4444" : "#f97316"} className="font-mono">
          {tempError ? "SENSOR ERRO" : temperature != null ? `${temperature.toFixed(1)} °C` : "--"}
        </text>
      </g>

      {/* T INSUFL. */}
      <g transform="translate(680 48)">
        <rect x="-56" y="-18" width="112" height="36" rx="6"
              fill="hsl(var(--card))" stroke="#38bdf8" strokeWidth="2" />
        <text x="0" y="-3" textAnchor="middle" fontSize="9" fill="#38bdf8" opacity="0.9" className="font-mono tracking-widest">T INSUFL.</text>
        <text x="0" y="13" textAnchor="middle" fontSize="14" fontWeight="900" fill="#38bdf8" className="font-mono">
          {supplyTemp != null ? `${Number(supplyTemp).toFixed(1)} °C` : "--.- °C"}
        </text>
      </g>

      {/* SETPOINT */}
      <g transform="translate(810 48)">
        <rect x="-56" y="-18" width="112" height="36" rx="6"
              fill="hsl(var(--card))" stroke="#10b981" strokeWidth="2" />
        <text x="0" y="-3" textAnchor="middle" fontSize="9" fill="#10b981" opacity="0.9" className="font-mono tracking-widest">SETPOINT</text>
        <text x="0" y="13" textAnchor="middle" fontSize="14" fontWeight="900" fill="#10b981" className="font-mono">
          {setpoint != null ? `${setpoint.toFixed(1)} °C` : "--.- °C"}
        </text>
      </g>
    </svg>
  );
}
