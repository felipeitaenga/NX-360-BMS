import React, { useId } from "react";

/**
 * FancoilSchematicSVG v3 — corte técnico de fancoil (estilo supervisório BMS).
 *
 * Fluxo: RETORNO → FILTRO → SERPENTINA (água gelada + VAG) → VENTILADOR CENTRÍFUGO → INSUFLAMENTO
 *
 * Animações (somente quando faz sentido):
 *  - Partículas de ar atravessam a máquina: laranja (ar quente) até a serpentina, azul (ar frio) depois dela.
 *  - Rotor centrífugo gira quando `running`.
 *  - Água gelada circula nos tubos com velocidade proporcional à abertura da VAG.
 *  - Gotas de condensado caem na bandeja quando há ventilação + VAG aberta.
 *  - Respeita `prefers-reduced-motion`.
 *
 * Props (inalteradas): running, temperature, setpoint, vag, tempError
 */
export default function FancoilSchematicSVG({ running, temperature, setpoint, vag, tempError }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n) => `fc${uid}-${n}`;

  const vagPct = vag != null && !Number.isNaN(vag) ? Math.max(0, Math.min(100, vag)) : null;
  const waterOn = vagPct != null && vagPct > 1;
  const condensate = running && waterOn && vagPct > 5;
  // 100% → 0.5s por ciclo; 5% → ~2.4s
  const waterDur = waterOn ? `${Math.max(0.5, 2.5 - vagPct / 50).toFixed(2)}s` : "0s";
  const coilOpacity = waterOn ? 0.25 + (vagPct / 100) * 0.55 : 0.12;

  const delta = temperature != null && setpoint != null && !tempError ? temperature - setpoint : null;
  const deltaColor = delta == null ? "#94a3b8" : Math.abs(delta) <= 1 ? "#10b981" : delta > 0 ? "#f97316" : "#38bdf8";

  const WARM = "#fb923c";
  const COOL = "#38bdf8";
  const WATER = "#0ea5e9";
  const muted = { stroke: "currentColor", strokeOpacity: 0.35 };

  // Partículas: [y, delay(s), raio]
  const particles = [
    [150, 0.0, 3], [176, 1.1, 2.5], [200, 0.5, 3], [224, 1.7, 2.5], [244, 0.9, 2],
    [162, 2.3, 2], [212, 2.9, 2.5], [188, 3.4, 2], [236, 3.9, 3], [170, 4.4, 2.5],
  ];

  return (
    <svg
      viewBox="0 0 900 360"
      className="w-full h-auto select-none"
      role="img"
      aria-label={`Esquema do fancoil — ${running ? "operando" : "parado"}`}
      data-testid="fancoil-schematic"
    >
      <style>{`
        .${id("spin")} { transform-box: fill-box; transform-origin: center; animation: ${id("rot")} .55s linear infinite; }
        .${id("air")} { animation: ${id("move")} 4.8s linear infinite; }
        .${id("water")} { stroke-dasharray: 10 8; animation: ${id("flow")} ${waterDur} linear infinite; }
        .${id("waterR")} { stroke-dasharray: 10 8; animation: ${id("flowR")} ${waterDur} linear infinite; }
        .${id("drop")} { animation: ${id("fall")} 1.4s ease-in infinite; }
        .${id("pulse")} { animation: ${id("blink")} 1.6s ease-in-out infinite; }
        @keyframes ${id("rot")} { to { transform: rotate(360deg); } }
        @keyframes ${id("move")} {
          0% { transform: translateX(0); opacity: 0; }
          6% { opacity: .95; }
          92% { opacity: .95; }
          100% { transform: translateX(850px); opacity: 0; }
        }
        @keyframes ${id("flow")} { to { stroke-dashoffset: -36; } }
        @keyframes ${id("flowR")} { to { stroke-dashoffset: 36; } }
        @keyframes ${id("fall")} {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: .9; }
          100% { transform: translateY(22px); opacity: 0; }
        }
        @keyframes ${id("blink")} { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        @media (prefers-reduced-motion: reduce) {
          .${id("spin")}, .${id("air")}, .${id("water")}, .${id("waterR")}, .${id("drop")}, .${id("pulse")} { animation: none !important; }
        }
      `}</style>

      <defs>
        <linearGradient id={id("cabinet")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#94a3b8" stopOpacity="0.16" />
          <stop offset="1" stopColor="#94a3b8" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id={id("ductIn")} x1="0" x2="1">
          <stop offset="0" stopColor={WARM} stopOpacity="0" />
          <stop offset="1" stopColor={WARM} stopOpacity={running ? 0.18 : 0.06} />
        </linearGradient>
        <linearGradient id={id("ductOut")} x1="0" x2="1">
          <stop offset="0" stopColor={COOL} stopOpacity={running ? 0.22 : 0.06} />
          <stop offset="1" stopColor={COOL} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("coilFill")} x1="0" x2="1">
          <stop offset="0" stopColor={waterOn ? WATER : "#64748b"} stopOpacity={coilOpacity * 0.6} />
          <stop offset="1" stopColor={waterOn ? WATER : "#64748b"} stopOpacity={coilOpacity} />
        </linearGradient>
        <radialGradient id={id("fanGlow")}>
          <stop offset="0" stopColor={COOL} stopOpacity="0.35" />
          <stop offset="1" stopColor={COOL} stopOpacity="0" />
        </radialGradient>
        {/* ar quente: antes do centro da serpentina; ar frio: depois */}
        <clipPath id={id("warmZone")}><rect x="0" y="0" width="300" height="360" /></clipPath>
        <clipPath id={id("coolZone")}><rect x="300" y="0" width="600" height="360" /></clipPath>
        <clipPath id={id("airway")}><rect x="20" y="138" width="870" height="116" /></clipPath>
      </defs>

      {/* ================= DUTOS ================= */}
      {/* Retorno */}
      <path d="M 20 138 H 150 V 254 H 20" fill={`url(#${id("ductIn")})`} {...muted} strokeWidth="2" />
      {/* Insuflamento */}
      <path d="M 890 138 H 770 V 254 H 890" fill={`url(#${id("ductOut")})`} {...muted} strokeWidth="2" />

      {/* ================= GABINETE ================= */}
      <rect x="150" y="118" width="620" height="156" rx="8" fill={`url(#${id("cabinet")})`} stroke="currentColor" strokeOpacity="0.55" strokeWidth="2.5" />
      {/* divisórias de seção */}
      {[215, 365, 640].map((x) => (
        <line key={x} x1={x} y1="122" x2={x} y2="270" stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 5" />
      ))}

      {/* ================= PARTÍCULAS DE AR ================= */}
      {running && (
        <g clipPath={`url(#${id("airway")})`}>
          {[["warmZone", WARM], ["coolZone", COOL]].map(([zone, color]) => (
            <g key={zone} clipPath={`url(#${id(zone)})`}>
              {particles.map(([y, delay, r], i) => (
                <circle
                  key={i}
                  className={id("air")}
                  cx="30"
                  cy={y}
                  r={r}
                  fill={color}
                  style={{ animationDelay: `-${delay}s` }}
                />
              ))}
            </g>
          ))}
        </g>
      )}

      {/* ================= GRELHA DE RETORNO ================= */}
      <g>
        {[148, 166, 184, 202, 220, 238].map((y) => (
          <line key={y} x1="152" y1={y} x2="166" y2={y + 8} stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
        ))}
      </g>

      {/* ================= FILTRO (plissado) ================= */}
      <g>
        <rect x="182" y="132" width="24" height="128" rx="2" fill="#94a3b8" fillOpacity="0.08" stroke="#94a3b8" strokeOpacity="0.7" strokeWidth="1.5" />
        <polyline
          points={Array.from({ length: 17 }, (_, i) => `${i % 2 ? 202 : 186},${134 + i * 7.5}`).join(" ")}
          fill="none"
          stroke="#94a3b8"
          strokeOpacity="0.8"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </g>

      {/* ================= SERPENTINA ================= */}
      <g>
        <rect x="236" y="132" width="110" height="122" rx="3" fill={`url(#${id("coilFill")})`} stroke={waterOn ? WATER : "#64748b"} strokeOpacity="0.8" strokeWidth="1.5" />
        {/* aletas */}
        {Array.from({ length: 21 }, (_, i) => 241 + i * 5).map((x) => (
          <line key={x} x1={x} y1="134" x2={x} y2="252" stroke={waterOn ? WATER : "#64748b"} strokeOpacity="0.28" strokeWidth="1" />
        ))}
        {/* tubos (passes) */}
        {[148, 172, 196, 220, 244].map((y) => (
          <line key={y} x1="252" y1={y} x2="330" y2={y} stroke="#cbd5e1" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
        ))}
        {/* curvas de retorno dos tubos */}
        {[148, 196].map((y) => (
          <path key={`r${y}`} d={`M 330 ${y} a 12 12 0 0 1 0 24`} fill="none" stroke="#cbd5e1" strokeOpacity="0.55" strokeWidth="3" />
        ))}
        {[172, 220].map((y) => (
          <path key={`l${y}`} d={`M 252 ${y} a 12 12 0 0 0 0 24`} fill="none" stroke="#cbd5e1" strokeOpacity="0.55" strokeWidth="3" />
        ))}
        {/* bandeja de condensado */}
        <path d="M 230 262 L 236 270 H 346 L 352 262" fill={WATER} fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
        {condensate &&
          [256, 288, 320].map((x, i) => (
            <path
              key={x}
              className={id("drop")}
              d={`M ${x} 252 q 3 5 0 7 q -3 -2 0 -7 z`}
              fill={WATER}
              style={{ animationDelay: `${i * 0.45}s` }}
            />
          ))}
      </g>

      {/* ================= ÁGUA GELADA + VAG ================= */}
      <g>
        {/* Alimentação (AG) — desce até a serpentina */}
        <path d="M 262 20 V 132" fill="none" stroke={WATER} strokeOpacity="0.25" strokeWidth="9" strokeLinecap="round" />
        <path d="M 262 20 V 132" fill="none" stroke={WATER} strokeWidth="3.5" className={waterOn ? id("water") : undefined} strokeOpacity={waterOn ? 1 : 0.35} />
        {/* Retorno (RAG) — sobe da serpentina */}
        <path d="M 322 20 V 132" fill="none" stroke="#7dd3fc" strokeOpacity="0.2" strokeWidth="9" strokeLinecap="round" />
        <path d="M 322 20 V 132" fill="none" stroke="#7dd3fc" strokeWidth="3.5" className={waterOn ? id("waterR") : undefined} strokeOpacity={waterOn ? 0.9 : 0.3} />
        <text x="262" y="14" textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.6" className="font-mono">AG</text>
        <text x="322" y="14" textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.6" className="font-mono">RAG</text>

        {/* Válvula 2 vias (símbolo gravata) + atuador */}
        <g transform="translate(262 82)">
          <path d="M -13 -10 L 13 10 L 13 -10 L -13 10 Z" fill="hsl(var(--card))" stroke={waterOn ? WATER : "#64748b"} strokeWidth="2" strokeLinejoin="round" />
          <line x1="0" y1="0" x2="-26" y2="0" stroke={waterOn ? WATER : "#64748b"} strokeWidth="2" />
          <rect x="-50" y="-11" width="24" height="22" rx="3" fill="hsl(var(--card))" stroke={waterOn ? WATER : "#64748b"} strokeWidth="2" />
          <text x="-38" y="4" textAnchor="middle" fontSize="10" fontWeight="700" fill={waterOn ? WATER : "#64748b"} className="font-mono">M</text>
        </g>
        {/* Indicador de abertura da VAG */}
        <g transform="translate(130 60)">
          <rect x="-58" y="-24" width="116" height="52" rx="8" fill="hsl(var(--card))" stroke={waterOn ? WATER : "#64748b"} strokeWidth="2" />
          <text x="0" y="-7" textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.7" className="font-mono">VAG</text>
          <text x="0" y="18" textAnchor="middle" fontSize="22" fontWeight="900" fill={waterOn ? WATER : "#94a3b8"} className="font-mono">
            {vagPct != null ? `${vagPct.toFixed(0)}%` : "--"}
          </text>
          {/* barra de abertura */}
          <rect x="-50" y="32" width="100" height="5" rx="2" fill="currentColor" opacity="0.12" />
          <rect x="-50" y="32" width={vagPct != null ? (100 * vagPct) / 100 : 0} height="5" rx="2" fill={WATER} />
          <line x1="58" y1="0" x2="86" y2="18" stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 3" />
        </g>
      </g>

      {/* ================= VENTILADOR CENTRÍFUGO ================= */}
      <g transform="translate(500 196)">
        {running && <circle r="92" fill={`url(#${id("fanGlow")})`} />}
        {/* voluta (carcaça em espiral) com boca de descarga à direita */}
        <path
          d="M 70 -58 L 128 -58 L 128 -24 L 66 -24 A 66 66 0 1 1 6 -66 A 70 70 0 0 1 70 -58 Z"
          fill="hsl(var(--card))"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* rotor */}
        <g className={running ? id("spin") : undefined}>
          <circle r="46" fill="none" stroke={COOL} strokeOpacity={running ? 0.5 : 0.25} strokeWidth="1.5" />
          {Array.from({ length: 16 }, (_, i) => i * 22.5).map((a) => (
            <path
              key={a}
              d="M 24 0 Q 36 -6 45 -14"
              fill="none"
              stroke={COOL}
              strokeOpacity={running ? 0.95 : 0.4}
              strokeWidth="3"
              strokeLinecap="round"
              transform={`rotate(${a})`}
            />
          ))}
          <circle r="24" fill="none" stroke={COOL} strokeOpacity={running ? 0.6 : 0.3} strokeWidth="1.5" />
          <circle r="9" fill="hsl(var(--card))" stroke={COOL} strokeWidth="2" />
          <circle r="3" fill={COOL} />
        </g>
      </g>

      {/* ================= GRELHA DE INSUFLAMENTO ================= */}
      <g>
        {[148, 166, 184, 202, 220, 238].map((y) => (
          <line key={y} x1="754" y1={y + 8} x2="768" y2={y} stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
        ))}
      </g>

      {/* ================= LEITURAS ================= */}
      {/* Temperatura (retorno) */}
      <g transform="translate(95 300)">
        <rect x="-88" y="-28" width="176" height="56" rx="10" fill={tempError ? "#ef4444" : "hsl(var(--card))"} stroke={tempError ? "#ef4444" : WARM} strokeWidth="2.5" />
        <text x="0" y="-8" textAnchor="middle" fontSize="12" fill={tempError ? "#fff" : "currentColor"} opacity="0.75" className="font-mono">TEMP. RETORNO</text>
        <text x="0" y="18" textAnchor="middle" fontSize="24" fontWeight="900" fill={tempError ? "#fff" : WARM} className="font-mono">
          {tempError ? "SENSOR ERRO" : temperature != null ? `${temperature.toFixed(1)} °C` : "--"}
        </text>
      </g>

      {/* Setpoint removido do esquema — exibido no card de Comandos */}

      {/* Rótulos das seções */}
      {[
        [85, "RETORNO"],
        [194, "FILTRO"],
        [291, "SERPENTINA"],
        [500, "VENTILADOR"],
        [830, "INSUFL."],
      ].map(([x, t]) => (
        <text key={t} x={x} y={x === 85 || x === 830 ? 128 : 292} textAnchor="middle" fontSize="11" fill="currentColor" opacity="0.55" className="font-mono" letterSpacing="1">
          {t}
        </text>
      ))}

      {/* Estado geral */}
      <g transform="translate(500 330)">
        <rect x="-62" y="-14" width="124" height="28" rx="14" fill={running ? "#10b981" : "#64748b"} fillOpacity="0.15" stroke={running ? "#10b981" : "#64748b"} strokeWidth="1.5" />
        <circle cx="-44" cy="0" r="5" fill={running ? "#10b981" : "#64748b"} className={running ? id("pulse") : undefined} />
        <text x="6" y="5" textAnchor="middle" fontSize="13" fontWeight="800" fill={running ? "#10b981" : "#94a3b8"} className="font-mono" letterSpacing="1.5">
          {running ? "OPERANDO" : "PARADO"}
        </text>
      </g>
    </svg>
  );
}
