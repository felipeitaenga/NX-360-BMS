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
// Geometria do ventilador centrífugo (calculada uma vez)
const FAN = (() => {
  const R0 = 50, R1 = 74, PHI_T = 0.42, OUT = 128;
  const r = (phi) => R0 + (R1 - R0) * (phi / (2 * Math.PI));
  const pt = (phi, k = 0) => {
    const rr = r(phi) - k;
    return [rr * Math.sin(phi), -rr * Math.cos(phi)];
  };
  const spiral = (k) => {
    let d = "";
    for (let i = 0; i <= 72; i++) {
      const phi = PHI_T + ((2 * Math.PI - PHI_T) * i) / 72;
      const [x, y] = pt(phi, k);
      d += `${i ? " L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  };
  const [tx, ty] = pt(PHI_T);
  return {
    housing: `${spiral(0)} L ${OUT} ${-R1} L ${OUT} ${ty.toFixed(1)} Z`,
    inner: spiral(4),
    tongue: [tx, ty],
    out: OUT,
    outTop: -R1,
    outBottom: ty,
    outMid: (-R1 + ty) / 2,
    blades: Array.from({ length: 32 }, (_, i) => i * 11.25),
  };
})();

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
      viewBox="0 0 900 385"
      className="w-full h-auto select-none"
      role="img"
      aria-label={`Esquema do fancoil — ${running ? "operando" : "parado"}`}
      data-testid="fancoil-schematic"
    >
      <style>{`
        .${id("spin")} { transform-box: fill-box; transform-origin: center; animation: ${id("rot")} .6s linear infinite; }
        .${id("spinFast")} { transform-box: fill-box; transform-origin: center; animation: ${id("rot")} .32s linear infinite; }
        .${id("chev")} { animation: ${id("chevMove")} 1s linear infinite; }
        @keyframes ${id("chevMove")} { 0% { transform: translateX(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateX(80px); opacity: 0; } }
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
          .${id("spin")}, .${id("air")}, .${id("water")}, .${id("waterR")}, .${id("drop")}, .${id("pulse")}, .${id("spinFast")}, .${id("chev")} { animation: none !important; }
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
        <linearGradient id={id("housing")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#94a3b8" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="#94a3b8" stopOpacity="0.08" />
          <stop offset="1" stopColor="#94a3b8" stopOpacity="0.18" />
        </linearGradient>
        <filter id={id("blur")} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
        <clipPath id={id("outlet")}>
          <rect x="30" y={FAN.outTop + 2} width={FAN.out - 32} height={FAN.outBottom - FAN.outTop - 4} />
        </clipPath>
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
        <g transform="translate(130 64)">
          <rect x="-46" y="-20" width="92" height="40" rx="6" fill="hsl(var(--card))" stroke={waterOn ? WATER : "#64748b"} strokeWidth="1.5" />
          <text x="0" y="-5" textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6" className="font-mono">VAG</text>
          <text x="0" y="12" textAnchor="middle" fontSize="15" fontWeight="800" fill={waterOn ? WATER : "#94a3b8"} className="font-mono">
            {vagPct != null ? `${vagPct.toFixed(0)}%` : "--"}
          </text>
          {/* barra de abertura */}
          <rect x="-40" y="22" width="80" height="4" rx="2" fill="currentColor" opacity="0.12" />
          <rect x="-40" y="22" width={vagPct != null ? (80 * vagPct) / 100 : 0} height="4" rx="2" fill={WATER} />
          <line x1="46" y1="0" x2="86" y2="18" stroke="currentColor" strokeOpacity="0.25" strokeDasharray="2 3" />
        </g>
      </g>

      {/* ================= VENTILADOR CENTRÍFUGO ================= */}
      <g transform="translate(500 196)">
        {running && <circle r="96" fill={`url(#${id("fanGlow")})`} />}

        {/* voluta: espiral de Arquimedes + boca de descarga horizontal */}
        <path
          d={FAN.housing}
          fill={`url(#${id("housing")})`}
          stroke="currentColor"
          strokeOpacity="0.6"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* reforço interno da voluta (dá profundidade) */}
        <path d={FAN.inner} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="6" />
        {/* lingueta (cutoff) */}
        <circle cx={FAN.tongue[0]} cy={FAN.tongue[1]} r="2.5" fill="currentColor" fillOpacity="0.5" />
        {/* flange da boca de descarga */}
        <line x1={FAN.out} y1={FAN.outTop - 5} x2={FAN.out} y2={FAN.outBottom + 5} stroke="currentColor" strokeOpacity="0.6" strokeWidth="4" strokeLinecap="round" />

        {/* setas de ar saindo pela boca */}
        {running && (
          <g clipPath={`url(#${id("outlet")})`}>
            {[0, 0.33, 0.66].map((d) => (
              <path
                key={d}
                className={id("chev")}
                d={`M 40 ${FAN.outMid - 7} l 8 7 l -8 7`}
                fill="none"
                stroke={COOL}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ animationDelay: `-${d}s` }}
              />
            ))}
          </g>
        )}

        {/* bocal de aspiração (atrás do rotor) */}
        <circle r="47" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" strokeDasharray="3 4" />

        {/* rotor */}
        <g className={running ? id("spin") : undefined}>
          {/* disco traseiro */}
          <circle r="43" fill={running ? COOL : "#64748b"} fillOpacity={running ? 0.1 : 0.08} />
          {/* pás curvadas para frente */}
          <g filter={running ? `url(#${id("blur")})` : undefined}>
            {FAN.blades.map((a) => (
              <path
                key={a}
                d="M 0 -29 Q 3.5 -36 9 -41.5"
                fill="none"
                stroke={running ? COOL : "#64748b"}
                strokeOpacity={running ? 0.95 : 0.7}
                strokeWidth="2.4"
                strokeLinecap="round"
                transform={`rotate(${a})`}
              />
            ))}
          </g>
          {/* anéis (aro externo e interno) */}
          <circle r="43" fill="none" stroke={running ? COOL : "#64748b"} strokeWidth="2.5" />
          <circle r="28.5" fill="none" stroke={running ? COOL : "#64748b"} strokeOpacity="0.7" strokeWidth="1.5" />
          {/* raios do cubo */}
          {[0, 90, 180, 270].map((a) => (
            <line key={a} x1="0" y1="-11" x2="0" y2="-28" stroke={running ? COOL : "#64748b"} strokeOpacity="0.55" strokeWidth="2" transform={`rotate(${a + 45})`} />
          ))}
          {/* cubo + parafusos + eixo */}
          <circle r="11" fill="hsl(var(--card))" stroke={running ? COOL : "#64748b"} strokeWidth="2" />
          {[0, 90, 180, 270].map((a) => (
            <circle key={a} cx="0" cy="-6.5" r="1.4" fill={running ? COOL : "#64748b"} transform={`rotate(${a})`} />
          ))}
          <circle r="3" fill={running ? COOL : "#64748b"} />
        </g>

        {/* arcos de velocidade (efeito de giro rápido) */}
        {running && (
          <g className={id("spinFast")}>
            <circle r="36" fill="none" stroke="#e0f2fe" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="18 208" strokeLinecap="round" />
            <circle r="36" fill="none" stroke="#e0f2fe" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="10 216" strokeDashoffset="113" strokeLinecap="round" />
          </g>
        )}
      </g>

      {/* ================= GRELHA DE INSUFLAMENTO ================= */}
      <g>
        {[148, 166, 184, 202, 220, 238].map((y) => (
          <line key={y} x1="754" y1={y + 8} x2="768" y2={y} stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
        ))}
      </g>

      {/* ================= LEITURAS (faixa inferior, separada do desenho) ================= */}
      <line x1="20" y1="308" x2="880" y2="308" stroke="currentColor" strokeOpacity="0.1" />

      {/* sensor de temperatura no retorno + linha guia até o mostrador */}
      <circle cx="110" cy="236" r="4.5" fill="hsl(var(--card))" stroke={tempError ? "#ef4444" : WARM} strokeWidth="2" />
      <path d="M 110 241 V 322" stroke={tempError ? "#ef4444" : WARM} strokeOpacity="0.45" strokeDasharray="2 3" />

      {/* Temperatura (retorno) */}
      <g transform="translate(20 322)">
        <rect width="190" height="50" rx="8" fill={tempError ? "#ef4444" : WARM} fillOpacity={tempError ? 0.9 : 0.08} stroke={tempError ? "#ef4444" : WARM} strokeOpacity="0.6" strokeWidth="1.5" />
        <rect x="0" y="0" width="5" height="50" rx="2.5" fill={tempError ? "#fff" : WARM} />
        <text x="18" y="18" fontSize="10" fill={tempError ? "#fff" : "currentColor"} opacity="0.7" className="font-mono" letterSpacing="1">TEMP. RETORNO</text>
        <text x="18" y="40" fontSize="19" fontWeight="800" fill={tempError ? "#fff" : WARM} className="font-mono">
          {tempError ? "SENSOR ERRO" : temperature != null ? `${temperature.toFixed(1)} °C` : "--"}
        </text>
      </g>

      {/* Setpoint + desvio */}
      <g transform="translate(690 322)">
        <rect width="190" height="50" rx="8" fill="#10b981" fillOpacity="0.08" stroke="#10b981" strokeOpacity="0.6" strokeWidth="1.5" />
        <rect x="185" y="0" width="5" height="50" rx="2.5" fill="#10b981" />
        <text x="14" y="18" fontSize="10" fill="currentColor" opacity="0.7" className="font-mono" letterSpacing="1">TEMP. DESEJADA</text>
        <text x="14" y="40" fontSize="19" fontWeight="800" fill="#10b981" className="font-mono">
          {setpoint != null ? `${setpoint.toFixed(1)} °C` : "--"}
        </text>
        {delta != null && (
          <g>
            <text x="172" y="18" textAnchor="end" fontSize="9" fill="currentColor" opacity="0.55" className="font-mono">DESVIO</text>
            <text x="172" y="39" textAnchor="end" fontSize="13" fontWeight="800" fill={deltaColor} className="font-mono">
              {delta > 0 ? "+" : ""}{delta.toFixed(1)}
            </text>
          </g>
        )}
      </g>

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
      <g transform="translate(450 347)">
        <rect x="-70" y="-17" width="140" height="34" rx="17" fill={running ? "#10b981" : "#64748b"} fillOpacity="0.15" stroke={running ? "#10b981" : "#64748b"} strokeWidth="1.5" />
        <circle cx="-48" cy="0" r="5" fill={running ? "#10b981" : "#64748b"} className={running ? id("pulse") : undefined} />
        <text x="8" y="5" textAnchor="middle" fontSize="13" fontWeight="800" fill={running ? "#10b981" : "#94a3b8"} className="font-mono" letterSpacing="1.5">
          {running ? "OPERANDO" : "PARADO"}
        </text>
      </g>
    </svg>
  );
}
