import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTelemetry } from "../context/TelemetryContext";
import { NIVEL, corNivel } from "../components/hid/HidSinotico";
import {
  Wind, Power, Hand, WifiOff, Siren, Thermometer, Snowflake, Droplets, Lightbulb, ChevronRight, Gauge, Clock,
  CheckCircle2, AlertTriangle, Server,
} from "lucide-react";

const TZ = { timeZone: "America/Sao_Paulo" };
const fmt = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
const hora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { ...TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const CAT_ICON = { fancoil: Wind, cag: Snowflake, hidraulica: Droplets, sistema: Server };

/* permissão de módulo (mesma regra do menu) */
function usePode() {
  const { user, perms } = useAuth();
  return (mod) => {
    if (user?.role === "admin") return true;
    if (perms?.modules?.length) return perms.modules.includes(mod);
    if (perms?.fancoil_ids?.length) return mod === "ar_condicionado" || mod === "alarmes";
    return false;
  };
}
const seguro = (url) => async () => { try { return (await api.get(url)).data; } catch { return null; } };

function Badge({ cor, children, pulse }) {
  return <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border whitespace-nowrap ${pulse ? "pulse-red" : ""}`} style={{ color: cor, borderColor: cor + "66", background: cor + "1a" }}>{children}</span>;
}

function Sistema({ icon: Icon, titulo, sub, to, cor, status, children, testid }) {
  return (
    <Card className="p-0 overflow-hidden flex flex-col" data-testid={testid}>
      <Link to={to} className="flex items-center gap-3 p-4 border-b border-border hover:bg-muted/30 transition-colors group">
        <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0" style={{ background: cor + "22", color: cor }}><Icon className="w-5 h-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-black uppercase tracking-wide text-sm">{titulo}</div>
          {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
        </div>
        {status}
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
      </Link>
      <div className="p-4 flex-1">{children}</div>
    </Card>
  );
}

function Num({ label, value, cor = "text-foreground", icon: Icon }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 truncate">{Icon && <Icon className="w-3 h-3" />}{label}</div>
      <div className={`font-mono font-black text-xl ${cor}`}>{value}</div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, cor, to }) {
  const corpo = (
    <Card className="p-3 h-full hover:border-sky-500/40 transition-colors">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className={`font-mono font-black text-2xl ${cor}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to}>{corpo}</Link> : corpo;
}

export default function Home() {
  const pode = usePode();
  const { states } = useTelemetry();
  const ac = pode("ar_condicionado"), hid = pode("hidraulica"), ilu = pode("iluminacao"), alm = pode("alarmes");

  const { data: fancoils = [] } = useQuery({ queryKey: ["fancoils"], queryFn: async () => (await api.get("/fancoils")).data, refetchInterval: 30000, enabled: ac });
  const { data: cag } = useQuery({ queryKey: ["home-cag"], queryFn: seguro("/cag"), refetchInterval: 10000, enabled: ac });
  const { data: hidr } = useQuery({ queryKey: ["home-hid"], queryFn: seguro("/hidraulica"), refetchInterval: 10000, enabled: hid });
  const { data: luz } = useQuery({ queryKey: ["home-luz"], queryFn: seguro("/lighting/overview"), refetchInterval: 15000, enabled: ilu });
  const { data: alarmes = [] } = useQuery({ queryKey: ["active-alarms-home"], queryFn: async () => (await api.get("/alarms?active_only=true")).data, refetchInterval: 15000, enabled: alm });
  const { data: settings } = useQuery({ queryKey: ["settings-public"], queryFn: seguro("/admin/settings") });

  const fc = useMemo(() => {
    let on = 0, forced = 0, offline = 0, tempSum = 0, tempCount = 0;
    const ativos = fancoils.filter((f) => f.active !== false);
    ativos.forEach((f) => {
      const st = states[f.device_id] || {};
      const online = st.online ?? f.online;
      const temp = st.temperature ?? f.temperature;
      if (online === false) offline++;
      if ((st.status ?? f.status) === true) on++;
      if ((st.estado ?? f.estado) === false) forced++;
      if (online && typeof temp === "number") { tempSum += temp; tempCount++; }
    });
    return { on, forced, offline, total: ativos.length, media: tempCount ? tempSum / tempCount : null };
  }, [fancoils, states]);

  const hidResumo = useMemo(() => {
    if (!hidr?.sistemas) return null;
    return Object.entries(hidr.sistemas).map(([k, s]) => {
      const tq = s.tanques[s.controle];
      const bombas = Object.values(s.bombas);
      const alarme = Object.values(s.tanques).some((t) => t.alarme || t.nivel === "falha_boia") || bombas.some((b) => b.falha);
      return { k, nome: s.nome, tq, modo: s.modo, ligadas: bombas.filter((b) => b.status).length, total: bombas.length, alarme };
    });
  }, [hidr]);

  const porCat = useMemo(() => {
    const c = {};
    alarmes.forEach((a) => { c[a.categoria] = (c[a.categoria] || 0) + 1; });
    return c;
  }, [alarmes]);
  const naoRec = alarmes.filter((a) => !a.acknowledged).length;

  const g = cag?.geral;
  const seqTxt = cag?.sequencia ? Object.entries(cag.sequencia).filter(([, q]) => q.fase === "partindo" || q.fase === "parando" || q.falha).map(([c, q]) => `${c}: ${q.falha ? "falha" : q.texto}`).join(" · ") : "";
  const buildingImg = settings?.building_image_url
    || "https://images.unsplash.com/photo-1528810289438-283f885c31ef?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5" data-testid="home-page">
      <div className="relative rounded-xl overflow-hidden border border-border">
        <img src={buildingImg} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="w-full h-36 lg:h-44 object-cover bg-slate-900" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-900/70 to-slate-900/20" />
        <div className="absolute inset-0 p-4 lg:p-6 flex flex-col justify-end">
          <div className="text-[11px] text-sky-300 font-mono uppercase tracking-widest">Painel geral</div>
          <h1 className="font-display text-2xl lg:text-3xl font-black text-white uppercase tracking-tight">Visão consolidada do edifício</h1>
          <div className="text-xs text-slate-300 mt-1">Ar condicionado · CAG · hidráulica · iluminação · alarmes — em tempo real</div>
        </div>
      </div>

      {/* faixa de indicadores */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {alm && <Kpi icon={Siren} label="Alarmes ativos" value={alarmes.length} cor={alarmes.length ? "text-red-400" : "text-emerald-400"} sub={naoRec ? `${naoRec} não reconhecido(s)` : "tudo reconhecido"} to="/alarmes" />}
        {ac && <Kpi icon={Wind} label="Fancoils ligados" value={`${fc.on}/${fc.total}`} cor="text-emerald-400" sub={`${fc.offline} offline · ${fc.forced} em forçado`} to="/ar-condicionado" />}
        {ac && cag && <Kpi icon={Snowflake} label="CAG" value={g?.central ? "OPERANDO" : "PARADA"} cor={g?.central ? "text-emerald-400" : "text-slate-400"} sub={`${cag.resumo?.chillers ?? 0}/2 chillers · água ${fmt(g?.temp_ida)} °C`} to="/ar-condicionado/cag" />}
        {hid && hidResumo && <Kpi icon={Droplets} label="Hidráulica" value={hidResumo.some((s) => s.alarme) ? "ATENÇÃO" : "NORMAL"} cor={hidResumo.some((s) => s.alarme) ? "text-red-400" : "text-sky-400"} sub={`${hidResumo.reduce((a, s) => a + s.ligadas, 0)} bomba(s) ligada(s)`} to="/hidraulica" />}
        {ilu && luz && <Kpi icon={Lightbulb} label="Iluminação" value={luz.circuitos_ligados ?? 0} cor="text-yellow-300" sub={`circuitos acesos · ${luz.controladoras_online}/${luz.controladoras_total} controladoras`} to="/iluminacao" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {ac && (
          <Sistema testid="home-fancoils" icon={Wind} titulo="Ar condicionado — fancoils" sub={`${fc.total} fancoils ativos`} to="/ar-condicionado" cor="#38bdf8"
            status={fc.offline ? <Badge cor="#94a3b8">{fc.offline} OFFLINE</Badge> : <Badge cor="#22c55e">TODOS ONLINE</Badge>}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Num icon={Power} label="Ligados" value={`${fc.on}/${fc.total}`} cor="text-emerald-400" />
              <Num icon={Hand} label="Forçado" value={fc.forced} cor={fc.forced ? "text-amber-400" : "text-foreground"} />
              <Num icon={WifiOff} label="Offline" value={fc.offline} cor={fc.offline ? "text-slate-300" : "text-foreground"} />
              <Num icon={Thermometer} label="Temp. média" value={`${fmt(fc.media)}°`} cor="text-sky-400" />
            </div>
            <div className="mt-4 h-2 rounded-full bg-muted/60 overflow-hidden flex" title="ligados · desligados · offline">
              <div className="bg-emerald-500" style={{ width: `${fc.total ? (fc.on / fc.total) * 100 : 0}%` }} />
              <div className="bg-slate-500" style={{ width: `${fc.total ? (fc.offline / fc.total) * 100 : 0}%` }} />
            </div>
            <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />ligados</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted" />desligados</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-500" />offline</span>
            </div>
          </Sistema>
        )}

        {ac && cag && g && (
          <Sistema testid="home-cag" icon={Snowflake} titulo="CAG — água gelada" sub={`Modo ${g.modo === "AUTO" ? "automático" : "manual"} · líder ${g.lider}${cag.simulacao ? " · simulação" : ""}`} to="/ar-condicionado/cag" cor="#22d3ee"
            status={g.central ? <Badge cor="#22c55e">EM OPERAÇÃO</Badge> : <Badge cor="#94a3b8">PARADA</Badge>}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Num icon={Thermometer} label="Água gelada" value={`${fmt(g.temp_ida)}°`} cor="text-sky-400" />
              <Num label="Setpoint" value={`${fmt(g.setpoint)}°`} />
              <Num label="Retorno" value={`${fmt(g.temp_retorno)}°`} cor="text-orange-400" />
              <Num icon={Gauge} label="ΔP kPa" value={fmt(g.dp, 0)} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              {["CH1", "CH2"].map((c) => {
                const e = cag.equipamentos?.[c] || {};
                const cor = e.falha ? "#ef4444" : e.status ? "#22c55e" : "#64748b";
                return (
                  <div key={c} className="rounded-md border border-border p-2 flex items-center justify-between" style={{ borderLeft: `4px solid ${cor}` }}>
                    <div>
                      <div className="text-xs font-black">{c}{g.lider === c && <span className="ml-1 text-[9px] text-sky-400">LÍDER</span>}</div>
                      <div className="text-[10px] text-muted-foreground">{e.falha ? "falha" : e.status ? `carga ${fmt(e.carga, 0)}%` : "desligado"}</div>
                    </div>
                    <div className="font-mono text-sm">{e.status ? `${fmt(e.temp_saida)}°` : "—"}</div>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {cag.programacao?.ativo ? `Programação ativa${cag.programacao.pico ? " · pico com 2 chillers" : ""}${cag.programacao.alternancia ? " · alternância diária" : ""}` : "Programação horária desligada"}
            </div>
            {seqTxt && <div className="text-[11px] text-amber-300 mt-1">{seqTxt}</div>}
          </Sistema>
        )}

        {hid && hidResumo && (
          <Sistema testid="home-hid" icon={Droplets} titulo="Hidráulica" sub="Água potável · esgoto · pluviais e reúso" to="/hidraulica" cor="#60a5fa"
            status={hidResumo.some((s) => s.alarme) ? <Badge cor="#ef4444" pulse>ALARME</Badge> : <Badge cor="#38bdf8">NORMAL</Badge>}>
            <div className="space-y-2">
              {hidResumo.map((s) => {
                const cor = corNivel(s.tq);
                const fill = NIVEL[s.tq?.nivel]?.fill ?? 0;
                return (
                  <Link key={s.k} to={`/hidraulica/${{ POT: "agua", ESG: "esgoto", PLU: "pluvial" }[s.k]}`} className="flex items-center gap-3 rounded-md border border-border p-2 hover:bg-muted/30">
                    <div className="w-7 h-10 rounded-sm border-2 border-slate-500 relative overflow-hidden shrink-0 bg-slate-900/40">
                      <div className="absolute bottom-0 left-0 right-0" style={{ height: `${fill * 100}%`, background: cor + "cc" }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{s.nome}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{s.tq?.nome} · modo {String(s.modo || "").toLowerCase()}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] font-black" style={{ color: cor }}>{NIVEL[s.tq?.nivel]?.txt || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">bombas {s.ligadas}/{s.total}</div>
                    </div>
                    {s.alarme && <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />}
                  </Link>
                );
              })}
            </div>
          </Sistema>
        )}

        {ilu && luz && (
          <Sistema testid="home-luz" icon={Lightbulb} titulo="Iluminação" sub={`${luz.pavimentos?.length || 0} pavimentos`} to="/iluminacao" cor="#facc15"
            status={luz.controladoras_online < luz.controladoras_total ? <Badge cor="#f59e0b">{luz.controladoras_total - luz.controladoras_online} OFFLINE</Badge> : <Badge cor="#22c55e">ONLINE</Badge>}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Num icon={Lightbulb} label="Circuitos acesos" value={luz.circuitos_ligados ?? 0} cor="text-yellow-300" />
              <Num icon={Server} label="Controladoras" value={`${luz.controladoras_online}/${luz.controladoras_total}`} />
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {(luz.pavimentos || []).map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <div className="w-24 truncate">{p.nome}</div>
                  <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden"><div className="h-full bg-yellow-400/80" style={{ width: `${p.pontos_total ? (p.pontos_acesos / p.pontos_total) * 100 : 0}%` }} /></div>
                  <div className="w-12 text-right font-mono text-[10px] text-muted-foreground">{p.pontos_acesos}/{p.pontos_total}</div>
                  {p.offline && <WifiOff className="w-3 h-3 text-amber-400" />}
                </div>
              ))}
              {!luz.pavimentos?.length && <div className="text-xs text-muted-foreground">Nenhum pavimento cadastrado.</div>}
            </div>
          </Sistema>
        )}

        {alm && (
          <Sistema testid="home-alarmes" icon={Siren} titulo="Alarmes ativos" sub={Object.entries(porCat).map(([k, n]) => `${{ fancoil: "Fancoils", cag: "CAG", hidraulica: "Hidráulica", sistema: "Sistema" }[k] || k} ${n}`).join(" · ") || "Nenhum alarme ativo"} to="/alarmes" cor="#f87171"
            status={alarmes.length ? <Badge cor="#ef4444" pulse={naoRec > 0}>{alarmes.length} ATIVO(S)</Badge> : <Badge cor="#22c55e">OK</Badge>}>
            {alarmes.length ? (
              <div className="space-y-1.5">
                {alarmes.slice(0, 6).map((a) => {
                  const I = CAT_ICON[a.categoria] || Siren;
                  return (
                    <Link key={a.id} to={a.link || "/alarmes"} className="flex items-center gap-2 text-xs rounded-md px-2 py-1.5 hover:bg-muted/30">
                      <span className="w-1.5 h-6 rounded-full shrink-0" style={{ background: a.priority === "alta" ? "#ef4444" : a.priority === "media" ? "#f59e0b" : "#38bdf8" }} />
                      <I className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                      <div className="min-w-0 flex-1"><span className="font-semibold">{a.equipamento || a.device_id}</span><span className="text-muted-foreground"> · {a.label}</span></div>
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0">{hora(a.started_at)}</span>
                      {!a.acknowledged && <span className="w-2 h-2 rounded-full bg-red-500 pulse-red shrink-0" title="não reconhecido" />}
                    </Link>
                  );
                })}
                {alarmes.length > 6 && <div className="text-[11px] text-muted-foreground px-2">+{alarmes.length - 6} outros — ver todos</div>}
              </div>
            ) : (
              <div className="h-full min-h-[100px] flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />Nenhum alarme ativo
              </div>
            )}
          </Sistema>
        )}
      </div>
    </div>
  );
}
