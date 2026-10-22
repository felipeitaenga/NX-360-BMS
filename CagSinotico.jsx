import React from "react";

/* Sinótico da CAG (desenho aprovado em 21/10/2026)
   Chillers parafuso condensação a ar · válvula atuada na entrada de cada chiller ·
   bombas centrífugas monobloco · instrumentação. Animado conforme o estado real. */

export const COR = { on: "#10b981", off: "#64748b", falha: "#ef4444", pend: "#f59e0b" };
export const corEq = (e) => (!e ? COR.off : e.falha ? COR.falha : e.pendente ? COR.pend : (e.tipo === "valvula" ? e.aberta : e.status) ? COR.on : COR.off);
export const estadoTxt = (e) => {
  if (!e) return "";
  if (e.falha) return "FALHA";
  if (e.tipo === "valvula") return e.em_curso ? "EM CURSO" : e.aberta ? "ABERTA" : "FECHADA";
  if (e.pendente) return e.cmd ? "PARTINDO" : "PARANDO";
  return e.status ? "LIGADO" : "DESLIGADO";
};
const run = (e) => !!(e && e.status && !e.falha);
const fmt = (v, d = 1) => (v == null ? "--" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));

export const CSS = `
.cx-flow{animation:cxflow 1s linear infinite}@keyframes cxflow{to{stroke-dashoffset:-28}}
.cx-spin{animation:cxspin .6s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes cxspin{to{transform:rotate(360deg)}}
.cx-blink{animation:cxblink 1s step-end infinite}@keyframes cxblink{50%{opacity:.25}}
.cx-lbl{font:700 13px system-ui,sans-serif;fill:#e2e8f0}.cx-sub{font:11px system-ui,sans-serif;fill:#94a3b8}
.cx-mono{font:700 12px ui-monospace,monospace}
.cx-eq{cursor:pointer}.cx-eq:hover{filter:brightness(1.12)}
@media (prefers-reduced-motion: reduce){.cx-flow,.cx-spin,.cx-blink{animation:none}}
`;

export function Defs() {
  return (
    <defs>
      <linearGradient id="cxCab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e5e7eb" /><stop offset="1" stopColor="#9ca3af" /></linearGradient>
      <linearGradient id="cxCabSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#d1d5db" /><stop offset=".5" stopColor="#f3f4f6" /><stop offset="1" stopColor="#9ca3af" /></linearGradient>
      <linearGradient id="cxCyl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e0f2fe" /><stop offset=".35" stopColor="#93c5fd" /><stop offset="1" stopColor="#1e3a8a" /></linearGradient>
      <linearGradient id="cxComp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d9f99d" /><stop offset=".4" stopColor="#65a30d" /><stop offset="1" stopColor="#1a2e05" /></linearGradient>
      <linearGradient id="cxMotor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#93c5fd" /><stop offset=".4" stopColor="#1d4ed8" /><stop offset="1" stopColor="#0b1e5b" /></linearGradient>
      <linearGradient id="cxIron" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#94a3b8" /><stop offset=".5" stopColor="#475569" /><stop offset="1" stopColor="#1e293b" /></linearGradient>
      <linearGradient id="cxSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#64748b" /><stop offset="1" stopColor="#1e293b" /></linearGradient>
      <linearGradient id="cxAct" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f1f5f9" /><stop offset="1" stopColor="#94a3b8" /></linearGradient>
      <radialGradient id="cxVolute" cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#cbd5e1" /><stop offset=".5" stopColor="#64748b" /><stop offset="1" stopColor="#1e293b" /></radialGradient>
      <pattern id="cxCoil" width="4" height="10" patternUnits="userSpaceOnUse"><rect width="4" height="10" fill="#9ca3af" /><line x1="1" y1="0" x2="1" y2="10" stroke="#6b7280" strokeWidth="1" /></pattern>
      <pattern id="cxMesh" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#f59e0b" /><path d="M0 5 L5 0" stroke="#92400e" strokeWidth="1" /></pattern>
      <filter id="cxSh" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity=".45" /></filter>
      <filter id="cxGlow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>
  );
}

/* ---------- tubulação e acessórios ---------- */
export function Tubo({ pts, tipo, fluxo, w = 16 }) {
  const d = "M" + pts.map((p) => p.join(" ")).join(" L");
  const base = { c: "#0369a1", q: "#c2410c", d: "#6d28d9", e: "#854d0e", r: "#0e7490", p: "#475569" }[tipo] || "#475569";
  return (
    <g>
      <path d={d} fill="none" stroke="#020617" strokeWidth={w + 5} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={base} strokeWidth={w} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth={w * 0.28} strokeLinejoin="round" transform={`translate(${-w * 0.18},${-w * 0.18})`} />
      {fluxo && <path d={d} fill="none" stroke="#f8fafc" strokeOpacity=".8" strokeWidth="3" strokeDasharray="8 20" strokeLinecap="round" className="cx-flow" />}
    </g>
  );
}
export const Valvula = ({ x, y, vert }) => (
  <g transform={`translate(${x},${y}) rotate(${vert ? 90 : 0})`}>
    <path d="M-12 -11 L12 11 L12 -11 L-12 11 Z" fill="#e2e8f0" stroke="#0f172a" strokeWidth="1.5" />
    <line x1="0" y1="0" x2="0" y2="-20" stroke="#cbd5e1" strokeWidth="2" /><rect x="-9" y="-26" width="18" height="6" rx="2" fill="#dc2626" />
  </g>
);
export const Retencao = ({ x, y }) => (
  <g transform={`translate(${x},${y}) rotate(-90)`}><rect x="-12" y="-11" width="24" height="22" rx="3" fill="#cbd5e1" stroke="#0f172a" /><path d="M-6 -7 L6 0 L-6 7 Z" fill="#0f172a" /></g>
);
export const Manometro = ({ x, y, ang }) => {
  const a = (ang * Math.PI) / 180;
  return (
    <g transform={`translate(${x},${y})`}>
      <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="3" /><circle r="11" fill="#f8fafc" stroke="#334155" strokeWidth="2" />
      <line x1="0" y1="0" x2={7 * Math.sin(a)} y2={-7 * Math.cos(a)} stroke="#dc2626" strokeWidth="1.6" /><circle r="1.6" fill="#0f172a" />
    </g>
  );
};
const Termometro = ({ x, y, v, c, label }) => (
  <g transform={`translate(${x},${y})`}>
    {label && <text y="-10" className="cx-sub">{label}</text>}
    <rect x="-3" y="-2" width="6" height="18" rx="3" fill="#e2e8f0" stroke="#334155" /><circle cx="0" cy="18" r="5" fill={c} stroke="#334155" />
    <rect x="10" y="-6" width="68" height="24" rx="5" fill="#020617" stroke="#334155" />
    <text x="44" y="11" textAnchor="middle" className="cx-mono" fill={c}>{v}</text>
  </g>
);

/* ---------- válvula atuada (on/off) em tubo vertical ---------- */
function ValvulaAtuada({ id, x, y, e, sel, onSel }) {
  const c = corEq(e);
  const aberta = e?.aberta, curso = e?.em_curso;
  return (
    <g className="cx-eq" onClick={() => onSel(id)} data-testid={`cag-${id}`}>
      <g transform={`translate(${x},${y})`}>
        {sel && <rect x="-24" y="-26" width="132" height="52" rx="8" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="4 4" />}
        <rect x="-15" y="-19" width="30" height="5" rx="1" fill="#475569" stroke="#0f172a" />
        <rect x="-15" y="14" width="30" height="5" rx="1" fill="#475569" stroke="#0f172a" />
        <path d="M-11 -12 L11 12 L-11 12 L11 -12 Z" fill={aberta ? "#e2e8f0" : "#475569"} stroke="#0f172a" strokeWidth="1.5" />
        <line x1="12" y1="0" x2="26" y2="0" stroke="#94a3b8" strokeWidth="4" />
        <rect x="26" y="-15" width="40" height="30" rx="4" fill="url(#cxAct)" stroke="#0f172a" strokeWidth="1.5" />
        <rect x="26" y="-15" width="40" height="6" rx="3" fill={c} className={e?.falha ? "cx-blink" : ""} />
        <circle cx="46" cy="4" r="7" fill="#0f172a" />
        <line x1="46" y1="4" x2={46 + (aberta || curso ? 0 : 6)} y2={4 + (aberta || curso ? -6 : 0)} stroke="#facc15" strokeWidth="2.5" strokeLinecap="round"
          transform={curso ? "rotate(45 46 4)" : undefined} />
        <text x="72" y="-2" className="cx-lbl" fontSize="12">{id}</text>
        <text x="72" y="12" fontSize="10" fontWeight="800" fill={c}>{estadoTxt(e)}</text>
        {e && !e.remoto && <g transform="translate(66,-20)"><rect x="-8" y="-8" width="16" height="16" rx="3" fill={COR.pend} /><text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill="#111">L</text></g>}
      </g>
    </g>
  );
}

/* ---------- bomba centrífuga monobloco ---------- */
export function Bomba({ id, cx, cy, e, sc, sel, onSel }) {
  const c = corEq(e), r = run(e);
  const fins = [];
  for (let i = -26; i <= 26; i += 7) fins.push(<line key={i} x1="124" y1={i} x2="216" y2={i} stroke="#0b1e5b" strokeOpacity=".55" strokeWidth="2" />);
  const cowl = [];
  for (let i = -20; i <= 20; i += 6) cowl.push(<line key={i} x1="230" y1={i} x2="246" y2={i} stroke="#0b1e5b" strokeWidth="1.5" />);
  return (
    <g className="cx-eq" onClick={() => onSel(id)} data-testid={`cag-${id}`}>
      <g transform={`translate(${cx},${cy}) scale(${sc})`} filter="url(#cxSh)">
        {sel && <rect x="-86" y="-96" width="350" height="172" rx="12" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="6 6" />}
        <rect x="-70" y="44" width="320" height="14" rx="2" fill="url(#cxSteel)" stroke="#0f172a" />
        <rect x="-60" y="58" width="16" height="10" fill="#334155" /><rect x="226" y="58" width="16" height="10" fill="#334155" />
        <path d="M-30 30 L30 30 L36 44 L-36 44 Z" fill="url(#cxIron)" stroke="#0f172a" />
        <path d="M30 -18 L84 -14 L84 14 L30 18 Z" fill="url(#cxIron)" stroke="#0f172a" />
        <rect x="40" y="18" width="34" height="26" fill="url(#cxIron)" stroke="#0f172a" />
        <path d="M0 -40 A40 40 0 1 1 -40 0 L-40 -24 Q-40 -40 -22 -46 Z" fill="url(#cxVolute)" stroke="#0f172a" strokeWidth="2" />
        <path d="M0 -30 A30 30 0 1 1 -30 0" fill="none" stroke="#0f172a" strokeOpacity=".5" strokeWidth="2" />
        <rect x="-26" y="-74" width="26" height="32" fill="url(#cxIron)" stroke="#0f172a" /><rect x="-32" y="-80" width="38" height="8" rx="1" fill="#475569" stroke="#0f172a" />
        <rect x="-66" y="-14" width="28" height="28" fill="url(#cxIron)" stroke="#0f172a" /><rect x="-72" y="-20" width="8" height="40" rx="1" fill="#475569" stroke="#0f172a" />
        <circle r="15" fill="#0f172a" stroke="#475569" strokeWidth="2" />
        <g className={r ? "cx-spin" : ""}>
          {[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d="M0 0 Q6 -5 10 -11" stroke={r ? "#7dd3fc" : "#64748b"} strokeWidth="2.5" fill="none" transform={`rotate(${a})`} />)}
          <circle r="3" fill="#cbd5e1" />
        </g>
        <path d="M84 -16 L118 -20 L118 20 L84 16 Z" fill="url(#cxMesh)" stroke="#78350f" strokeWidth="1.5" />
        <rect x="118" y="-34" width="104" height="68" rx="8" fill="url(#cxMotor)" stroke="#0f172a" strokeWidth="1.5" />
        {fins}
        <rect x="146" y="-48" width="34" height="16" rx="2" fill="url(#cxMotor)" stroke="#0f172a" />
        <rect x="128" y="34" width="20" height="10" fill="#1e3a8a" /><rect x="192" y="34" width="20" height="10" fill="#1e3a8a" />
        <path d="M222 -30 L244 -24 Q252 0 244 24 L222 30 Z" fill="#1e3a8a" stroke="#0f172a" strokeWidth="1.5" />
        {cowl}
        <circle cx="190" cy="-40" r="5" fill={c} className={e?.falha ? "cx-blink" : ""} filter={r ? "url(#cxGlow)" : undefined} />
        {e && !e.remoto && <g transform="translate(140,-56)"><rect x="-10" y="-10" width="20" height="20" rx="4" fill={COR.pend} /><text y="5" textAnchor="middle" fontWeight="900" fontSize="13" fill="#111">L</text></g>}
      </g>
      <g transform={`translate(${cx + 90 * sc},${cy + 82 * sc})`}>
        <rect x="-58" y="-2" width="116" height="34" rx="7" fill="#020617" stroke={c} strokeOpacity=".7" />
        <text x="0" y="13" textAnchor="middle" className="cx-lbl">{id}</text>
        <text x="0" y="27" textAnchor="middle" fontSize="10" fontWeight="700" fill={c}>{estadoTxt(e)}{e?.velocidade != null && r ? ` · ${fmt(e.velocidade, 0)}%` : ""}</text>
      </g>
    </g>
  );
}

/* ---------- chiller parafuso condensação a ar ---------- */
function Chiller({ id, x, y, e, sel, onSel }) {
  const c = corEq(e), r = run(e), W = 340;
  const px = W - 96;
  return (
    <g className="cx-eq" onClick={() => onSel(id)} data-testid={`cag-${id}`}>
      <g transform={`translate(${x},${y})`} filter="url(#cxSh)">
        {sel && <rect x="-40" y="-70" width={W + 70} height="340" rx="14" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="6 6" />}
        <rect x="0" y="236" width={W} height="14" fill="url(#cxSteel)" stroke="#0f172a" />
        {[10, W / 2 - 8, W - 26].map((p) => <rect key={p} x={p} y="250" width="16" height="8" fill="#334155" />)}
        <path d={`M0 46 L22 22 L${W + 22} 22 L${W} 46 Z`} fill="#cbd5e1" stroke="#475569" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${52 + i * 80},34)`}>
            <ellipse rx="34" ry="9" fill="#1f2937" stroke="#6b7280" strokeWidth="2" />
            <g transform="scale(1,.26)">
              <g className={r ? "cx-spin" : ""}>
                {[0, 90, 180, 270].map((a) => <path key={a} d="M0 0 C 10 -8, 26 -10, 30 -2 C 22 2, 10 4, 0 0" fill="#9ca3af" transform={`rotate(${a})`} />)}
                <circle r="5" fill="#e5e7eb" />
              </g>
            </g>
            <ellipse rx="34" ry="9" fill="none" stroke="#9ca3af" strokeWidth="1.5" />
            <path d="M-34 0 A34 9 0 0 0 34 0" fill="none" stroke="#4b5563" strokeWidth="3" />
          </g>
        ))}
        <rect x="0" y="46" width={W} height="104" fill="url(#cxCabSide)" stroke="#475569" />
        {[0, 1, 2, 3].map((i) => {
          const bx = 8 + i * 82;
          return (
            <g key={i}>
              <rect x={bx} y="54" width="76" height="88" fill="url(#cxCoil)" stroke="#6b7280" />
              <path d={`M${bx} 54 L${bx + 38} 142 L${bx + 76} 54`} fill="none" stroke="#4b5563" strokeWidth="2" />
            </g>
          );
        })}
        <rect x="0" y="150" width={W - 96} height="86" fill="#111827" stroke="#475569" />
        {[[22, 158], [136, 158]].map(([cx, cy]) => (
          <g key={cx}>
            <rect x={cx} y={cy} width="94" height="26" rx="12" fill="url(#cxComp)" stroke="#0f172a" />
            <rect x={cx + 60} y={cy - 4} width="30" height="34" rx="5" fill="url(#cxComp)" stroke="#0f172a" />
            <rect x={cx + 8} y={cy - 8} width="14" height="10" fill="#4d7c0f" />
            <line x1={cx + 15} y1={cy - 8} x2={cx + 15} y2={cy - 20} stroke="#94a3b8" strokeWidth="4" />
            <circle cx={cx + 30} cy={cy + 13} r="4" fill={r ? "#a3e635" : "#3f6212"} className={r ? "cx-blink" : ""} />
          </g>
        ))}
        <rect x="14" y="196" width={W - 122} height="34" rx="17" fill="url(#cxCyl)" stroke="#0f172a" strokeWidth="1.5" />
        {Array.from({ length: 6 }, (_, i) => 54 + i * 36).map((lx) => <line key={lx} x1={lx} y1="197" x2={lx} y2="229" stroke="#1e3a8a" strokeOpacity=".35" />)}
        <ellipse cx="14" cy="213" rx="8" ry="17" fill="#93c5fd" stroke="#0f172a" />
        <rect x="-26" y="196" width="34" height="12" fill="url(#cxIron)" stroke="#0f172a" /><rect x="-30" y="192" width="6" height="20" fill="#475569" />
        <rect x="-26" y="218" width="34" height="12" fill="url(#cxIron)" stroke="#0f172a" /><rect x="-30" y="214" width="6" height="20" fill="#475569" />
        <rect x={px} y="150" width="96" height="86" fill="url(#cxCab)" stroke="#475569" />
        <line x1={px + 48} y1="154" x2={px + 48} y2="232" stroke="#6b7280" />
        <rect x={px + 8} y="160" width="34" height="22" rx="2" fill="#022c22" stroke="#0f172a" />
        <text x={px + 25} y="175" textAnchor="middle" fontFamily="monospace" fontSize="10" fill="#34d399">{e?.status ? fmt(e.temp_saida) : "--.-"}</text>
        <circle cx={px + 14} cy="194" r="4" fill={r ? "#22c55e" : "#14532d"} />
        <circle cx={px + 26} cy="194" r="4" fill={e?.falha ? "#ef4444" : "#450a0a"} className={e?.falha ? "cx-blink" : ""} />
        <circle cx={px + 38} cy="194" r="4" fill={e && !e.remoto ? "#f59e0b" : "#451a03"} />
        <rect x={px + 56} y="186" width="6" height="16" rx="2" fill="#475569" />
        <rect x={px + 8} y="206" width="34" height="4" fill="#9ca3af" /><rect x={px + 8} y="214" width="34" height="4" fill="#9ca3af" />
        <rect x={W - 14} y="-10" width="8" height="32" fill="#94a3b8" />
        <circle cx={W - 10} cy="-14" r="7" fill={c} className={e?.falha ? "cx-blink" : ""} filter={r ? "url(#cxGlow)" : undefined} />
      </g>
      <g transform={`translate(${x + 30},${y - 40})`}>
        <text className="cx-lbl" fontSize="15">{id === "CH1" ? "CHILLER 1" : "CHILLER 2"}</text>
        <text y="16" className="cx-sub"><tspan fill="#7dd3fc" fontWeight="700">SP {fmt(e?.setpoint)} °C</tspan> · parafuso</text>
      </g>
      <g transform={`translate(${x + W - 150},${y - 58})`}>
        <rect width="150" height="30" rx="7" fill="#020617" stroke={c} strokeOpacity=".7" />
        <text x="10" y="19" fontSize="11" fontWeight="800" fill={c}>{estadoTxt(e)}</text>
        {e && !e.remoto ? <text x="140" y="19" textAnchor="end" fontSize="11" fontWeight="800" fill={COR.pend}>LOCAL</text>
          : r && <text x="140" y="19" textAnchor="end" className="cx-mono" fill="#7dd3fc">{fmt(e.carga, 0)}%</text>}
      </g>
    </g>
  );
}

function Predio({ x, y, ativo }) {
  const jan = [];
  for (let i = 0; i < 14; i++) for (let j = 0; j < 4; j++)
    jan.push(<rect key={`${i}-${j}`} x={16 + j * 32} y={24 + i * 44} width="22" height="28" rx="2" fill={ativo ? "#0ea5e9" : "#0f172a"} fillOpacity={ativo ? 0.25 + ((i * 3 + j) % 4) * 0.12 : 1} stroke="#334155" />);
  return (
    <g transform={`translate(${x},${y})`} filter="url(#cxSh)">
      <rect width="150" height="660" rx="6" fill="#1e293b" stroke="#475569" strokeWidth="2" />
      <rect x="-6" y="-12" width="162" height="16" rx="3" fill="#334155" />
      {jan}
      <text x="75" y="-22" textAnchor="middle" className="cx-lbl">PRÉDIO · fancoils</text>
    </g>
  );
}

export default function CagSinotico({ s, sel, onSel }) {
  const E = s.equipamentos, g = s.geral;
  const pri = ["BAP1", "BAP2", "BAP3"].some((b) => run(E[b]));
  const sec = ["BAS1", "BAS2", "BAS3"].some((b) => run(E[b]));
  const chX = { CH1: 130, CH2: 545 }, chY = 210;
  const pX = { BAP1: 170, BAP2: 440, BAP3: 710 }, pY = 660, PSC = 0.72;
  const sY = { BAS1: 230, BAS2: 450, BAS3: 670 }, sX = 1110, SSC = 0.82;
  return (
    <svg viewBox="0 0 1560 870" className="w-full min-w-[900px] h-auto select-none" data-testid="cag-sinotico">
      <style>{CSS}</style>
      <Defs />
      <text x="60" y="40" className="cx-sub" letterSpacing="3">CIRCUITO PRIMÁRIO</text>
      <text x="1030" y="40" className="cx-sub" letterSpacing="3">CIRCUITO SECUNDÁRIO</text>
      <Tubo pts={[[60, 120], [1020, 120]]} tipo="c" fluxo={pri} w={20} />
      <Tubo pts={[[1370, 780], [60, 780]]} tipo="q" fluxo={pri || sec} w={20} />
      <Tubo pts={[[760, 560], [60, 560]]} tipo="q" fluxo={pri} />

      {/* chillers: saída fria (sobe ao coletor) e entrada (válvula atuada) */}
      {Object.entries(chX).map(([id, x]) => {
        const v = E["VCH" + id[2]];
        const vazao = pri && v?.aberta;
        return (
          <g key={id}>
            <Tubo pts={[[x - 30, chY + 202], [x - 62, chY + 202], [x - 62, 120]]} tipo="c" fluxo={vazao} w={12} />
            <Tubo pts={[[x - 40, 560], [x - 40, chY + 224], [x - 30, chY + 224]]} tipo="q" fluxo={vazao} w={12} />
            <Valvula x={x - 62} y={300} vert />
          </g>
        );
      })}
      {Object.entries(chX).map(([id, x]) => <Chiller key={id} id={id} x={x} y={chY} e={E[id]} sel={sel === id} onSel={onSel} />)}
      {Object.entries(chX).map(([id, x]) => {
        const vid = "VCH" + id[2];
        return <ValvulaAtuada key={vid} id={vid} x={x - 40} y={505} e={E[vid]} sel={sel === vid} onSel={onSel} />;
      })}

      {/* primárias */}
      {Object.entries(pX).map(([id, x]) => {
        const on = run(E[id]);
        return (
          <g key={id}>
            <Tubo pts={[[x - 80, 780], [x - 80, pY], [x - 62 * PSC, pY]]} tipo="q" fluxo={on} w={12} />
            <Tubo pts={[[x - 13 * PSC, pY - 78 * PSC], [x - 13 * PSC, 560]]} tipo="q" fluxo={on} w={12} />
            <Valvula x={x - 80} y={730} vert />
            <Retencao x={x - 13 * PSC} y={592} />
            <Manometro x={x + 14} y={598} ang={on ? 40 : -60} />
          </g>
        );
      })}
      {Object.entries(pX).map(([id, x]) => <Bomba key={id} id={id} cx={x} cy={pY} e={E[id]} sc={PSC} sel={sel === id} onSel={onSel} />)}

      {/* desacoplador */}
      <Tubo pts={[[945, 120], [945, 780]]} tipo="d" fluxo={pri && sec} w={14} />
      <text x="968" y="450" className="cx-sub" letterSpacing="3" transform="rotate(90 968 450)" textAnchor="middle" style={{ fill: "#a78bfa" }}>DESACOPLADOR</text>

      {/* secundárias */}
      <Tubo pts={[[1020, 120], [1020, 670]]} tipo="c" fluxo={sec} />
      {Object.entries(sY).map(([id, y]) => {
        const on = run(E[id]);
        return (
          <g key={id}>
            <Tubo pts={[[1020, y], [sX - 62 * SSC, y]]} tipo="c" fluxo={on} w={12} />
            <Tubo pts={[[sX - 13 * SSC, y - 78 * SSC], [sX - 13 * SSC, y - 104], [1340, y - 104]]} tipo="c" fluxo={on} w={12} />
            <Valvula x={1050} y={y} />
            <Retencao x={sX - 13 * SSC} y={y - 80} />
            <Manometro x={sX - 13 * SSC + 22} y={y - 60} ang={on ? 50 : -60} />
          </g>
        );
      })}
      <Tubo pts={[[1340, 566], [1340, 120], [1380, 120]]} tipo="c" fluxo={sec} />
      {Object.entries(sY).map(([id, y]) => <Bomba key={id} id={id} cx={sX} cy={y} e={E[id]} sc={SSC} sel={sel === id} onSel={onSel} />)}

      <Predio x={1385} y={110} ativo={sec} />
      <Termometro x={1240} y={72} v={`${fmt(g.temp_ida)}°C`} c="#38bdf8" label="ÁGUA GELADA" />
      <Termometro x={1080} y={800} v={`${fmt(g.temp_retorno)}°C`} c="#fb923c" />
      <text x="1080" y="850" className="cx-sub">RETORNO</text>
      <g transform="translate(1290,826)">
        <line x1="70" y1="-706" x2="70" y2="-20" stroke="#64748b" strokeDasharray="4 4" />
        <rect x="24" y="-20" width="92" height="44" rx="8" fill="#020617" stroke="#64748b" />
        <text x="70" y="-4" textAnchor="middle" className="cx-sub">ΔP</text>
        <text x="70" y="15" textAnchor="middle" className="cx-mono" fill="#e2e8f0">{fmt(g.dp, 0)} kPa</text>
      </g>
    </svg>
  );
}
