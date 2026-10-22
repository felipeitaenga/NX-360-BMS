import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";
import { Snowflake, Thermometer, Gauge, Power, Wifi, WifiOff, Bot, Hand, LayoutDashboard, SlidersHorizontal } from "lucide-react";
import CagSinotico, { COR } from "../components/cag/CagSinotico";
import CagComandos, { Faceplate, Setpoints } from "../components/cag/CagComandos";

/* CAG — Central de Água Gelada: 2 chillers parafuso (com válvula atuada na entrada),
   3 bombas primárias e 3 secundárias. Abas: Sinótico | Comandos. */

const fmt = (v, d = 1, u = "") => (v == null || Number.isNaN(Number(v)) ? "—" : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}${u}`);

function Kpi({ icon: Icon, label, value, sub, color = "text-foreground" }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className={`font-mono font-black text-2xl ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export default function CAG() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";
  const pode = user?.role !== "viewer";
  const [aba, setAba] = useState("sinotico");
  const [sel, setSel] = useState("CH1");
  const { data: s } = useQuery({ queryKey: ["cag"], queryFn: async () => (await api.get("/cag")).data, refetchInterval: 2000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["cag"] }); qc.invalidateQueries({ queryKey: ["cag-log"] }); };
  const toggleSim = async (v) => {
    if (!v && !window.confirm("Desligar a simulação? A tela passa a mostrar só os dados reais da CAG (TJS/CAG/...).")) return;
    try { await api.put("/cag/simulacao", { ativo: v }); refresh(); } catch (err) { toast.error(formatApiError(err)); }
  };
  const tab = (k) => `px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 border ${aba === k ? "bg-sky-500/15 border-sky-500/50 text-sky-200" : "border-border text-muted-foreground hover:bg-muted/40"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5" data-testid="cag-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-3">
            <Snowflake className="w-7 h-7 text-cyan-400" /> CAG — Central de Água Gelada
          </h1>
          <div className="text-sm text-muted-foreground mt-1">2 chillers parafuso · 2 válvulas atuadas · 3 bombas primárias · 3 bombas secundárias</div>
        </div>
        {s && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={`px-2 py-1 rounded border font-bold tracking-widest flex items-center gap-1 ${s.geral.modo === "AUTO" ? "border-sky-500/50 text-sky-300" : "border-amber-500/50 text-amber-300"}`} data-testid="cag-modo-badge">
              {s.geral.modo === "AUTO" ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}{s.geral.modo === "AUTO" ? "AUTOMÁTICO" : "MANUAL"}
            </span>
            {s.simulacao && <span className="px-2 py-1 rounded border border-violet-400/50 text-violet-300 font-bold tracking-widest" data-testid="cag-sim-badge">SIMULAÇÃO</span>}
            <span className={`flex items-center gap-1 ${s.online ? "text-emerald-400" : "text-red-400"}`}>{s.online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}{s.online ? "online" : "sem comunicação"}</span>
            {isAdmin && <label className="flex items-center gap-2 text-muted-foreground">Dados simulados <Switch checked={s.simulacao} onCheckedChange={toggleSim} data-testid="cag-sim-switch" /></label>}
          </div>
        )}
      </div>

      {!s ? <Card className="p-10 text-center text-muted-foreground">Carregando…</Card> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={Thermometer} label="Água gelada" value={fmt(s.geral.temp_ida, 1, "°C")} sub={`setpoint ${fmt(s.geral.setpoint, 1, "°C")}`} color="text-sky-400" />
            <Kpi icon={Thermometer} label="Retorno" value={fmt(s.geral.temp_retorno, 1, "°C")} color="text-orange-400" />
            <Kpi icon={Thermometer} label="ΔT" value={fmt(s.geral.delta_t, 1, "°C")} sub="retorno − ida" />
            <Kpi icon={Gauge} label="Pressão dif." value={fmt(s.geral.dp, 0)} sub={`kPa · sp ${fmt(s.geral.dp_setpoint, 0)}`} />
            <Kpi icon={Snowflake} label="Chillers" value={`${s.resumo.chillers}/2`} sub={`líder ${s.geral.lider}`} color="text-emerald-400" />
            <Kpi icon={Power} label="Bombas" value={`${s.resumo.primarias}/3 · ${s.resumo.secundarias}/3`} sub="primárias · secundárias" />
          </div>

          <div className="flex gap-2">
            <button className={tab("sinotico")} onClick={() => setAba("sinotico")} data-testid="cag-aba-sinotico"><LayoutDashboard className="w-4 h-4" />Sinótico</button>
            <button className={tab("comandos")} onClick={() => setAba("comandos")} data-testid="cag-aba-comandos"><SlidersHorizontal className="w-4 h-4" />Comandos</button>
          </div>

          {aba === "sinotico" ? (
            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_300px] gap-4">
              <Card className="p-2 sm:p-3 overflow-hidden">
                <div className="overflow-x-auto"><CagSinotico s={s} sel={sel} onSel={setSel} /></div>
                <div className="flex flex-wrap gap-4 justify-center text-[11px] text-muted-foreground mt-1">
                  {[["Ligado/aberta", COR.on], ["Desligado/fechada", COR.off], ["Em transição", COR.pend], ["Falha", COR.falha]].map(([l, c]) => (
                    <span key={l} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{l}</span>
                  ))}
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm text-[9px] font-black text-black flex items-center justify-center" style={{ background: COR.pend }}>L</span>Comando local</span>
                  <span>Clique num equipamento para ver e comandar</span>
                </div>
              </Card>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-1 gap-4 content-start">
                <Faceplate id={sel} s={s} pode={pode} isAdmin={isAdmin} onDone={refresh} />
                <Setpoints s={s} pode={pode} onDone={refresh} />
              </div>
            </div>
          ) : (
            <CagComandos s={s} pode={pode} isAdmin={isAdmin} onDone={refresh} />
          )}
        </>
      )}
    </div>
  );
}
