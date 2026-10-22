import React from "react";
import { CSS, Defs, Tubo, Valvula, Retencao, Manometro, Bomba, COR, corEq, estadoTxt } from "../cag/CagSinotico";

/* Sinóticos da hidráulica (desenho aprovado em 21/10/2026).
   Nível só por boias: VAZIO / BAIXO / MÉDIO / ALTO — sem porcentagem. */

export const NIVEL = {
  baixo: { txt: "BAIXO", fill: 0.1 },
  normal_inf: { txt: "NORMAL", fill: 0.38 },
  normal_sup: { txt: "NORMAL", fill: 0.68 },
  alto: { txt: "ALTO", fill: 0.92 },
  falha_boia: { txt: "FALHA BOIA", fill: 0.5 },
};
/* cor do nível: alarme = vermelho; normal = azul; extremos sem alarme (ex.: poço vazio) = verde */
export const corNivel = (t) => (!t ? "#64748b" : t.alarme || t.nivel === "falha_boia" ? "#ef4444" : t.nivel.startsWith("normal") ? "#38bdf8" : "#10b981");
export const nomesBoias = (tipo) => ({
  alta: "Alta · alarme",
  media: "Controle",
  baixa: tipo === "esgotamento" ? "Baixa · proteção" : tipo === "fonte" ? "Baixa · proteção" : "Baixa · alarme",
});
const BOIAS = [["alta", 0.85], ["media", 0.5], ["baixa", 0.2]];
const run = (e) => !!(e && e.status && !e.falha);

const HCSS = `
.hx-wave{animation:hxwave 3s ease-in-out infinite alternate}@keyframes hxwave{to{transform:translateX(-30px)}}
.hx-rain{animation:hxrain .7s linear infinite}@keyframes hxrain{to{stroke-dashoffset:-40}}
.hx-bub{animation:hxbub 3s linear infinite}@keyframes hxbub{0%{transform:translateY(0);opacity:0}20%{opacity:.8}100%{transform:translateY(-60px);opacity:0}}
@media (prefers-reduced-motion: reduce){.hx-wave,.hx-rain,.hx-bub{animation:none}}
`;

function HDefs() {
  return (
    <defs>
      <linearGradient id="hxConc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9ca3af" /><stop offset="1" stopColor="#4b5563" /></linearGradient>
      <linearGradient id="hxFibra" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1e3a8a" /><stop offset=".4" stopColor="#3b82f6" /><stop offset="1" stopColor="#1e3a8a" /></linearGradient>
      <linearGradient id="hxInox" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#64748b" /><stop offset=".35" stopColor="#e2e8f0" /><stop offset=".6" stopColor="#94a3b8" /><stop offset="1" stopColor="#334155" /></linearGradient>
      <linearGradient id="hxAgua" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7dd3fc" stopOpacity=".95" /><stop offset="1" stopColor="#0369a1" /></linearGradient>
      <linearGradient id="hxEsgoto" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a16207" stopOpacity=".95" /><stop offset="1" stopColor="#422006" /></linearGradient>
      <linearGradient id="hxReuso" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#67e8f9" stopOpacity=".95" /><stop offset="1" stopColor="#0e7490" /></linearGradient>
      <pattern id="hxSolo" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#3f2a17" /><circle cx="3" cy="4" r="1.3" fill="#5b3b1e" /><circle cx="10" cy="10" r="1.6" fill="#2a1b0e" /><circle cx="11" cy="3" r=".9" fill="#6b4423" /></pattern>
    </defs>
  );
}

const Chao = ({ y, H }) => (
  <g>
    <rect x="0" y={y} width="1400" height={H - y} fill="url(#hxSolo)" />
    <rect x="0" y={y - 5} width="1400" height="7" fill="#4d7c0f" />
    <rect x="0" y={y - 5} width="1400" height="2" fill="#84cc16" opacity=".6" />
  </g>
);

/* reservatório em corte com nível por boias */
function Tanque({ id, t, x, y, w, h, liq = "hxAgua", tipo = "concreto", sel, onSel, nx = 0.62, titulo }) {
  const n = NIVEL[t?.nivel || "baixo"];
  const nb = nomesBoias(t?.tipo);
  const parede = tipo === "concreto" ? 14 : 6;
  const ix = x + parede, iy = y + parede, iw = w - 2 * parede, ih = h - 2 * parede;
  const ly = iy + ih * (1 - n.fill);
  const corN = corNivel(t);
  const clip = `hxclip-${id}`;
  let wave = `M${ix - 40} ${ly}`;
  for (let i = ix - 40; i < ix + iw + 60; i += 30) wave += " q7.5 -5 15 0 t15 0";
  return (
    <g className="cx-eq" onClick={() => onSel?.(id)} data-testid={`hid-${id}`}>
      {sel && <rect x={x - 10} y={y - 34} width={w + 20} height={h + 44} rx="10" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 6" />}
      <g filter="url(#cxSh)">
        <rect x={x} y={y} width={w} height={h} rx={tipo === "concreto" ? 4 : 14} fill={tipo === "concreto" ? "url(#hxConc)" : "url(#hxFibra)"} stroke="#0f172a" strokeWidth="2" />
        <rect x={ix} y={iy} width={iw} height={ih} rx={tipo === "concreto" ? 2 : 8} fill="#0b1324" />
        <clipPath id={clip}><rect x={ix} y={iy} width={iw} height={ih} rx={tipo === "concreto" ? 2 : 8} /></clipPath>
        <g clipPath={`url(#${clip})`}>
          <rect x={ix} y={ly} width={iw} height={iy + ih - ly} fill={`url(#${liq})`} style={{ transition: "y .8s, height .8s" }} />
          <path d={`${wave} V${ly + 12} H${ix - 40} Z`} fill="#fff" fillOpacity=".22" className="hx-wave" />
          {liq === "hxEsgoto" && [0, 1, 2, 3, 4, 5].map((i) => (
            <circle key={i} cx={ix + 20 + (i * (iw - 40)) / 5} cy={iy + ih - 8} r={2 + (i % 3)} fill="#fde68a" fillOpacity=".5" className="hx-bub" style={{ animationDelay: `${i * 0.45}s` }} />
          ))}
        </g>
        {tipo === "concreto" && <rect x={x + w * 0.62} y={y - 8} width={w * 0.2} height="10" rx="2" fill="#6b7280" stroke="#1f2937" />}
        {BOIAS.map(([k, hh]) => {
          const nome = h < 130 ? nb[k].split(" · ")[0] : nb[k];
          const by = iy + ih * (1 - hh);
          const on = t?.[k];
          const c = on ? (k === "media" ? "#38bdf8" : "#22c55e") : "#475569";
          return (
            <g key={k}>
              <line x1={ix + 8} y1={by} x2={ix + 26} y2={by} stroke="#94a3b8" strokeWidth="1.5" />
              <ellipse cx={ix + 32} cy={by} rx="7" ry="5" fill={c} stroke="#0f172a" />
              {w >= 200 && <rect x={ix + 42} y={by - 8} width={nome.length * 6.5 + 10} height="16" rx="4" fill="#020617" fillOpacity=".85" />}
              {w >= 200 && <text x={ix + 47} y={by + 4} fontSize="10" fontWeight="700" fill={on ? (k === "media" ? "#7dd3fc" : "#4ade80") : "#94a3b8"}>{nome}</text>}
            </g>
          );
        })}
      </g>
      <text x={x} y={y - 14} className="cx-lbl">{titulo || t?.nome?.toUpperCase()}</text>
      <g transform={`translate(${w >= 200 ? x + w * nx : x + w / 2 + 12},${y + h / 2})`}>
        <rect x={w >= 200 ? -56 : -40} y="-20" width={w >= 200 ? 112 : 80} height="38" rx="8" fill="#020617" fillOpacity=".8" stroke={corN} strokeOpacity=".8" />
        <text y="-4" textAnchor="middle" fontSize="9" fill="#94a3b8" letterSpacing="2">NÍVEL</text>
        <text y="12" textAnchor="middle" fontSize="15" fontWeight="900" fill={corN} className={t?.alarme || t?.nivel === "falha_boia" ? "cx-blink" : ""}>{n.txt}</text>
      </g>
    </g>
  );
}

function Submersivel({ id, x, y, e, sel, onSel }) {
  const c = corEq(e), r = run(e);
  return (
    <g className="cx-eq" onClick={() => onSel?.(id)} data-testid={`hid-${id}`}>
      <g transform={`translate(${x},${y})`} filter="url(#cxSh)">
        {sel && <rect x="-40" y="-160" width="96" height="190" rx="8" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 6" />}
        <rect x="-26" y="-118" width="6" height="140" fill="#94a3b8" /><rect x="20" y="-118" width="6" height="140" fill="#94a3b8" />
        <path d="M10 -70 Q40 -110 30 -150" fill="none" stroke="#111827" strokeWidth="4" />
        <rect x="-20" y="-70" width="40" height="62" rx="9" fill="url(#hxInox)" stroke="#0f172a" strokeWidth="1.5" />
        {[-60, -52, -44, -36, -28, -20].map((i) => <line key={i} x1="-18" y1={i} x2="18" y2={i} stroke="#334155" strokeOpacity=".5" />)}
        <rect x="-8" y="-82" width="16" height="14" rx="3" fill="#475569" stroke="#0f172a" />
        <path d="M-26 -8 H26 L30 14 H-30 Z" fill="url(#cxIron)" stroke="#0f172a" />
        <rect x="26" y="-4" width="22" height="14" fill="url(#cxIron)" stroke="#0f172a" />
        <g transform="translate(0,4)">
          <circle r="8" fill="#0f172a" />
          <g className={r ? "cx-spin" : ""}>{[0, 90, 180, 270].map((a) => <line key={a} x1="0" y1="0" x2="6" y2="0" stroke={r ? "#fde68a" : "#64748b"} strokeWidth="2.5" transform={`rotate(${a})`} />)}</g>
        </g>
        <circle cx="0" cy="-48" r="5" fill={c} className={e?.falha ? "cx-blink" : ""} filter={r ? "url(#cxGlow)" : undefined} />
        <rect x="-34" y="14" width="68" height="8" fill="#334155" />
      </g>
      <g transform={`translate(${x},${y + 36})`}>
        <rect x="-52" y="0" width="104" height="32" rx="7" fill="#020617" stroke={c} strokeOpacity=".7" />
        <text y="13" textAnchor="middle" className="cx-lbl" fontSize="12">{id}</text>
        <text y="26" textAnchor="middle" fontSize="10" fontWeight="700" fill={c}>{estadoTxt(e)}</text>
      </g>
    </g>
  );
}

function Predio({ x, y, w, h, andares = 7, telhado }) {
  const fh = h / andares, cols = Math.floor((w - 20) / 40);
  return (
    <g filter="url(#cxSh)">
      <rect x={x} y={y} width={w} height={h} fill="#1e293b" stroke="#475569" strokeWidth="2" />
      {Array.from({ length: andares }).map((_, i) => (
        <g key={i}>
          <line x1={x} y1={y + i * fh} x2={x + w} y2={y + i * fh} stroke="#334155" />
          {Array.from({ length: cols }).map((__, j) => <rect key={j} x={x + 14 + j * 40} y={y + i * fh + fh * 0.25} width="24" height={fh * 0.5} rx="2" fill="#0ea5e9" fillOpacity={0.18 + ((i + j) % 3) * 0.1} />)}
        </g>
      ))}
      {telhado && <path d={`M${x - 10} ${y} L${x + w / 2} ${y - 34} L${x + w + 10} ${y} Z`} fill="#475569" stroke="#1e293b" strokeWidth="2" />}
    </g>
  );
}
const Lbl = ({ x, y, t, sub }) => (<g><text x={x} y={y} className="cx-lbl">{t}</text>{sub && <text x={x} y={y + 15} className="cx-sub">{sub}</text>}</g>);
const Seta = ({ x, y, t }) => (<g transform={`translate(${x},${y})`}><path d="M0 0 h18 l-6 -6 M18 0 l-6 6" stroke="#94a3b8" strokeWidth="2" fill="none" /><text x="24" y="4" className="cx-sub">{t}</text></g>);
const PeVal = ({ x }) => <rect x={x - 10} y="596" width="20" height="9" rx="2" fill="#94a3b8" />;

/* ===== 1. Água potável ===== */
function Potavel({ s, sel, onSel }) {
  const T = s.tanques, B = s.bombas;
  const P = { BR1: [600, 378, 380], BR2: [880, 378, 420] };
  const algum = run(B.BR1) || run(B.BR2);
  return (
    <svg viewBox="0 0 1400 640" className="w-full min-w-[900px] h-auto select-none">
      <style>{CSS + HCSS}</style><Defs /><HDefs />
      <Chao y={430} H={640} />
      <text x="40" y="34" className="cx-sub" letterSpacing="3">ÁGUA POTÁVEL · RECALQUE</text>
      <Tubo pts={[[20, 380], [240, 380], [240, 470]]} tipo="c" fluxo={!T.CIS.media} w={10} />
      <g transform="translate(80,380)"><rect x="-18" y="-14" width="36" height="28" rx="5" fill="#e2e8f0" stroke="#0f172a" /><circle r="8" fill="#0f172a" /></g>
      <text x="20" y="352" className="cx-sub">concessionária → hidrômetro</text>
      <Tanque id="CIS" t={T.CIS} x={60} y={460} w={400} h={150} sel={sel === "CIS"} onSel={onSel} />
      {Object.entries(P).map(([id, [x, y, xin]]) => (
        <g key={id}>
          <Tubo pts={[[xin, 596], [xin, 418], [x - 100, 418], [x - 100, y], [x - 40, y]]} tipo="c" fluxo={run(B[id])} w={10} />
          <Valvula x={xin} y={442} vert /><PeVal x={xin} />
          <Tubo pts={[[x - 8, y - 48], [x - 8, 300], [1000, 300]]} tipo="c" fluxo={run(B[id])} w={10} />
          <Retencao x={x - 8} y={330} /><Manometro x={x + 16} y={326} ang={run(B[id]) ? 45 : -60} />
        </g>
      ))}
      {Object.entries(P).map(([id, [x, y]]) => <Bomba key={id} id={id} cx={x} cy={y} e={B[id]} sc={0.6} sel={sel === id} onSel={onSel} />)}
      <Tubo pts={[[1000, 300], [1000, 110], [1040, 110]]} tipo="c" fluxo={algum} w={12} />
      <Predio x={1040} y={170} w={320} h={260} />
      <Tanque id="SUP" t={T.SUP} x={1065} y={60} w={270} h={100} tipo="fibra" sel={sel === "SUP"} onSel={onSel} nx={0.76} />
      <Tubo pts={[[1200, 160], [1200, 250]]} tipo="c" fluxo={T.SUP.baixa} w={8} /><Seta x={1210} y={240} t="consumo" />
      <Lbl x={1040} y={455} t="Prédio" sub="barrilete → apartamentos / áreas comuns" />
    </svg>
  );
}

/* ===== 2. Esgoto ===== */
function Esgoto({ s, sel, onSel }) {
  const T = s.tanques, B = s.bombas;
  const S = { BE1: [720, 620], BE2: [810, 620] };
  const algum = run(B.BE1) || run(B.BE2);
  return (
    <svg viewBox="0 0 1400 700" className="w-full min-w-[900px] h-auto select-none">
      <style>{CSS + HCSS}</style><Defs /><HDefs />
      <Chao y={400} H={700} />
      <text x="40" y="34" className="cx-sub" letterSpacing="3">ESGOTO · ELEVATÓRIA</text>
      <text x="40" y="54" className="cx-sub">rodízio automático · liga por boia · alarme de nível alto</text>
      <Predio x={40} y={120} w={280} h={280} />
      <Tubo pts={[[300, 380], [300, 470], [470, 470]]} tipo="e" fluxo w={12} />
      <text x="310" y="500" className="cx-sub">chegada do esgoto</text>
      <Tanque id="POCO" t={T.POCO} x={460} y={420} w={440} h={240} liq="hxEsgoto" sel={sel === "POCO"} onSel={onSel} nx={0.38} />
      <Tubo pts={[[888, 412], [888, 340]]} tipo="p" fluxo={false} w={6} />
      <path d="M880 340 Q888 326 896 340" fill="none" stroke="#94a3b8" strokeWidth="3" /><text x="900" y="360" className="cx-sub">respiro</text>
      {Object.entries(S).map(([id, [x, y]]) => <Tubo key={id} pts={[[x + 48, y + 3], [x + 56, y + 3], [x + 56, 330], [1000, 330]]} tipo="e" fluxo={run(B[id])} w={9} />)}
      {Object.entries(S).map(([id, [x, y]]) => <Submersivel key={id} id={id} x={x} y={y} e={B[id]} sel={sel === id} onSel={onSel} />)}
      {Object.entries(S).map(([id, [x]]) => <g key={id}><Retencao x={x + 56} y={375} /><Valvula x={x + 56} y={352} vert /></g>)}
      <Tubo pts={[[1000, 330], [1240, 330], [1240, 400]]} tipo="e" fluxo={algum} w={12} />
      <g transform="translate(1240,400)"><rect x="-40" y="0" width="80" height="16" fill="#374151" /><rect x="-30" y="16" width="60" height="140" fill="#1f2937" stroke="#4b5563" /><rect x="-48" y="-6" width="96" height="8" rx="2" fill="#6b7280" /></g>
      <Lbl x={1150} y={300} t="Rede pública de esgoto" sub="PV de lançamento" />
    </svg>
  );
}

/* ===== 3. Pluviais / reúso ===== */
function Pluvial({ s, sel, onSel }) {
  const T = s.tanques, B = s.bombas;
  const P = { BP1: [860, 378, 600], BP2: [1110, 378, 640] };
  const algum = run(B.BP1) || run(B.BP2);
  return (
    <svg viewBox="0 0 1400 640" className="w-full min-w-[900px] h-auto select-none">
      <style>{CSS + HCSS}</style><Defs /><HDefs />
      <Chao y={430} H={640} />
      <text x="40" y="34" className="cx-sub" letterSpacing="3">ÁGUAS PLUVIAIS · CAPTAÇÃO E REÚSO</text>
      {[[160, 92], [300, 84]].map(([cx, cy]) => (
        <g key={cx} fill="#94a3b8" opacity=".85"><circle cx={cx} cy={cy} r="20" /><circle cx={cx + 22} cy={cy - 8} r="24" /><circle cx={cx + 48} cy={cy} r="18" /><rect x={cx - 10} y={cy} width="70" height="16" rx="8" /></g>
      ))}
      {Array.from({ length: 18 }).map((_, i) => <line key={i} x1={140 + i * 13} y1={118 + (i % 3) * 5} x2={135 + i * 13} y2={150 + (i % 3) * 5} stroke="#7dd3fc" strokeWidth="2" strokeDasharray="8 12" className="hx-rain" style={{ animationDelay: `${(i % 5) * 0.12}s` }} />)}
      <Predio x={110} y={190} w={300} h={240} andares={6} telhado />
      <Tubo pts={[[90, 190], [90, 470], [200, 470]]} tipo="r" fluxo w={10} /><text x="20" y="250" className="cx-sub">condutor</text>
      <g transform="translate(220,456)"><rect x="-22" y="-20" width="44" height="34" rx="4" fill="#e2e8f0" stroke="#0f172a" /><path d="M-14 -12 L14 6 M-14 -2 L4 10" stroke="#475569" /></g>
      <text x="200" y="510" className="cx-sub">filtro</text>
      <Tubo pts={[[242, 470], [300, 470], [300, 482]]} tipo="r" fluxo w={10} />
      <Tanque id="CAP" t={T.CAP} x={280} y={470} w={420} h={140} liq="hxReuso" sel={sel === "CAP"} onSel={onSel} nx={0.5} />
      <Tubo pts={[[700, 492], [730, 492], [730, 580]]} tipo="r" fluxo={!!T.CAP.alta} w={8} />
      <text x="740" y="586" className="cx-sub">extravasor → galeria pluvial</text>
      {Object.entries(P).map(([id, [x, y, xin]]) => (
        <g key={id}>
          <Tubo pts={[[xin, 596], [xin, 418], [x - 100, 418], [x - 100, y], [x - 40, y]]} tipo="r" fluxo={run(B[id])} w={10} />
          <Valvula x={xin} y={442} vert />
          <Tubo pts={[[x - 8, y - 48], [x - 8, 300], [1250, 300]]} tipo="r" fluxo={run(B[id])} w={10} />
          <Retencao x={x - 8} y={330} /><Manometro x={x + 16} y={326} ang={run(B[id]) ? 45 : -60} />
        </g>
      ))}
      {Object.entries(P).map(([id, [x, y]]) => <Bomba key={id} id={id} cx={x} cy={y} e={B[id]} sc={0.6} sel={sel === id} onSel={onSel} />)}
      <Tubo pts={[[1250, 300], [1250, 130], [1272, 130]]} tipo="r" fluxo={algum} w={12} />
      <g fill="#475569"><rect x="1290" y="190" width="8" height="240" /><rect x="1372" y="190" width="8" height="240" /><path d="M1294 230 L1376 300 M1376 230 L1294 300 M1294 320 L1376 390 M1376 320 L1294 390" stroke="#475569" strokeWidth="3" /></g>
      <Tanque id="REU" t={T.REU} x={1270} y={70} w={130} h={120} tipo="fibra" liq="hxReuso" sel={sel === "REU"} onSel={onSel} titulo="REÚSO" />
      <Tubo pts={[[1335, 190], [1335, 215], [1180, 215]]} tipo="r" fluxo={T.REU.baixa} w={8} />
      <text x="1172" y="219" textAnchor="end" className="cx-sub">bacias · irrigação · lavagem ←</text>
    </svg>
  );
}

export default function HidSinotico({ sistema, s, sel, onSel }) {
  if (sistema === "POT") return <Potavel s={s} sel={sel} onSel={onSel} />;
  if (sistema === "ESG") return <Esgoto s={s} sel={sel} onSel={onSel} />;
  return <Pluvial s={s} sel={sel} onSel={onSel} />;
}
export { COR };
