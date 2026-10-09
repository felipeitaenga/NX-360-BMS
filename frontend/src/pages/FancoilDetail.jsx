import React, { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useTelemetry } from "../context/TelemetryContext";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { toast } from "sonner";
import { ArrowLeft, Minus, Plus, Power, Hand, Wifi, WifiOff } from "lucide-react";
import FancoilSchematicSVG from "../components/FancoilSchematicSVG";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";

function IndicatorRow({ label, value, color, testid }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono font-bold text-sm ${color || "text-foreground"}`} data-testid={testid}>{value}</div>
    </div>
  );
}

export default function FancoilDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { states } = useTelemetry();
  const [sendingEstado, setSendingEstado] = useState(false);
  const [sendingCmd, setSendingCmd] = useState(false);
  const [sendingSp, setSendingSp] = useState(false);
  const [spBuffer, setSpBuffer] = useState(null);
  const [range, setRange] = useState(1);

  const { data: fancoil, isLoading } = useQuery({
    queryKey: ["fancoil", id],
    queryFn: async () => (await api.get(`/fancoils/${id}`)).data,
    refetchInterval: 60000,
  });
  const { data: history = [] } = useQuery({
    queryKey: ["history", id, range],
    queryFn: async () => (await api.get(`/history/${id}?days=${range}`)).data,
    refetchInterval: 60000,
    enabled: !!fancoil,
  });

  const st = fancoil ? states[fancoil.device_id] || {} : {};
  const online = fancoil && (st.online ?? fancoil.online);
  const status = st.status ?? fancoil?.status;
  const estado = st.estado ?? fancoil?.estado;
  const modo = st.modo ?? fancoil?.modo;
  const cmd = st.cmd ?? fancoil?.cmd;
  const temperature = st.temperature ?? fancoil?.temperature;
  const tempError = st.temp_error ?? fancoil?.temp_error;
  const setpoint = spBuffer != null ? spBuffer : (st.setpoint ?? fancoil?.setpoint);
  const serverSp = st.setpoint ?? fancoil?.setpoint;
  const vag = st.vag ?? fancoil?.vag;
  const serverPressure = st.pressure ?? fancoil?.pressure;
  const [pressureBuffer, setPressureBuffer] = useState(null);
  const [sendingPressure, setSendingPressure] = useState(false);
  const pressure = pressureBuffer != null ? pressureBuffer : serverPressure;

  const canCommand = user && user.role !== "viewer";

  const chartData = useMemo(
    () =>
      history.map((h) => ({
        t: new Date(h.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        temperatura: h.temperature,
        setpoint: h.setpoint,
        vag: h.vag,
      })),
    [history]
  );

  const sendCommand = async (kind, value) => {
    try {
      await api.post(`/fancoils/${id}/command`, { kind, value });
      toast.success(`Comando ${kind} enviado`);
      qc.invalidateQueries({ queryKey: ["fancoil", id] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  if (isLoading || !fancoil) return <div className="p-8">Carregando...</div>;

  return (
    <div className="p-4 lg:p-8 space-y-6" data-testid="fancoil-detail-page">
      <div className="flex items-center justify-between gap-3">
        <Link to="/ar-condicionado" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="back-to-fancoils">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <div className="flex items-center gap-2 text-xs font-mono uppercase">
          {online ? (
            <span className="flex items-center gap-1 text-emerald-400"><Wifi className="w-4 h-4" /> Online</span>
          ) : (
            <span className="flex items-center gap-1 text-slate-500"><WifiOff className="w-4 h-4" /> Offline</span>
          )}
        </div>
      </div>

      <div>
        <h1 className="font-display text-3xl lg:text-5xl font-black tracking-tight uppercase">
          Conjunto {fancoil.name.replace("CJ", "")}
        </h1>
        <div className="text-muted-foreground text-sm mt-1 font-mono uppercase tracking-wider">
          {fancoil.description} • Dispositivo {fancoil.device_id}
        </div>
      </div>

      {modo === false && (
        <Card className="p-3 bg-amber-500/10 border-amber-500/40 text-amber-300 text-sm">
          <b>QUADRO EM MANUAL LOCAL</b> — comandos remotos podem não ter efeito.
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
        {/* ESQUERDA — Esquema */}
        <Card className="lg:col-span-3 p-4 lg:p-6 bg-card/80 h-full flex items-center">
          <FancoilSchematicSVG
            running={status === true || (status == null && cmd === true && estado === false) || (vag != null && vag > 10 && cmd !== false)}
            temperature={temperature}
            setpoint={serverSp}
            vag={vag}
            tempError={tempError}
          />
        </Card>

        {/* DIREITA — Indicadores (apenas) */}
        <Card className="lg:col-span-2 p-5 bg-card/80 h-full flex flex-col">
          <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground mb-3">Indicadores</h2>
          <div className="flex-1 flex flex-col justify-between">
            <IndicatorRow
              label="Condição"
              value={estado === true ? "NORMAL" : estado === false ? "FORÇADO" : "--"}
              color={estado === true ? "text-emerald-400" : estado === false ? "text-amber-400" : "text-muted-foreground"}
              testid="indicator-condicao"
            />
            <IndicatorRow label="Comando" value={cmd === true ? "LIGAR" : cmd === false ? "DESLIGAR" : "--"} color={cmd === true ? "text-emerald-400" : "text-red-400"} testid="indicator-comando" />
            <IndicatorRow label="Quadro" value={modo === true ? "AUTOMÁTICO" : modo === false ? "MANUAL" : "--"} color={modo === false ? "text-amber-400" : "text-emerald-400"} testid="indicator-quadro" />
            <IndicatorRow label="Status" value={status === true ? "LIGADO" : status === false ? "DESLIGADO" : "--"} color={status === true ? "text-emerald-400" : "text-red-400"} testid="indicator-status" />
            <IndicatorRow label="Temperatura" value={tempError ? "ERRO" : temperature != null ? `${temperature.toFixed(1)} °C` : "--"} color={tempError ? "text-red-400" : "text-sky-400"} testid="indicator-temperatura" />
          </div>
          {st.last_update && (
            <div className="text-[10px] text-muted-foreground font-mono mt-auto pt-3">
              Última atualização: {new Date(st.last_update).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            </div>
          )}
        </Card>
      </div>

      {/* COMANDOS — largura total, abaixo */}
      {canCommand && (
        <Card className="p-5 lg:p-6 bg-card/80" data-testid="commands-card">
          <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground mb-4">Comandos</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
            {/* a) Condição de operação */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Condição de operação</div>
              <div className="grid grid-cols-2 gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={!online || estado === true || sendingEstado}
                      data-testid="btn-condicao-normal"
                      className={`h-14 font-display font-black uppercase tracking-wide ${estado === true
                        ? "bg-emerald-600 hover:bg-emerald-600 text-white ring-2 ring-emerald-300"
                        : "bg-muted hover:bg-emerald-600/80 hover:text-white border border-border"}`}
                    >
                      NORMAL
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mudar para NORMAL</AlertDialogTitle>
                      <AlertDialogDescription>
                        O fancoil passará a obedecer a <b>programação horária da controladora</b>.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction data-testid="confirm-condicao-normal"
                        onClick={async () => { setSendingEstado(true); await sendCommand("ESTADO", "true"); setSendingEstado(false); }}>
                        Confirmar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={!online || estado === false || sendingEstado}
                      data-testid="btn-condicao-forcado"
                      className={`h-14 font-display font-black uppercase tracking-wide ${estado === false
                        ? "bg-amber-600 hover:bg-amber-600 text-white ring-2 ring-amber-300"
                        : "bg-muted hover:bg-amber-600/80 hover:text-white border border-border"}`}
                    >
                      FORÇADO
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mudar para FORÇADO</AlertDialogTitle>
                      <AlertDialogDescription>
                        O fancoil passará a obedecer apenas <b>comandos do supervisório</b> (LIGAR/DESLIGAR abaixo).
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction data-testid="confirm-condicao-forcado"
                        onClick={async () => { setSendingEstado(true); await sendCommand("ESTADO", "false"); setSendingEstado(false); }}>
                        Confirmar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {/* b) Comando LIGAR / DESLIGAR + aviso */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Comando</div>
              <div className="grid grid-cols-2 gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={!online || estado !== false || cmd === true || sendingCmd}
                      data-testid="btn-cmd-ligar"
                      className={`h-14 font-display text-base font-black uppercase tracking-wide ${cmd === true
                        ? "bg-emerald-600 text-white ring-2 ring-emerald-300"
                        : "bg-emerald-700 hover:bg-emerald-600 text-white"}`}
                    >
                      <Power className="w-5 h-5 mr-2" /> LIGAR
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>LIGAR fancoil {fancoil.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Envia CMD=true via tópico {fancoil.name} CMD/SET.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction data-testid="confirm-cmd-ligar"
                        onClick={async () => { setSendingCmd(true); await sendCommand("CMD", "true"); setSendingCmd(false); }}>
                        Confirmar LIGAR
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={!online || estado !== false || cmd === false || sendingCmd}
                      data-testid="btn-cmd-desligar"
                      className={`h-14 font-display text-base font-black uppercase tracking-wide ${cmd === false
                        ? "bg-red-600 text-white ring-2 ring-red-300"
                        : "bg-red-700 hover:bg-red-600 text-white"}`}
                    >
                      <Power className="w-5 h-5 mr-2" /> DESLIGAR
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>DESLIGAR fancoil {fancoil.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Envia CMD=false via tópico {fancoil.name} CMD/SET.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction data-testid="confirm-cmd-desligar"
                        onClick={async () => { setSendingCmd(true); await sendCommand("CMD", "false"); setSendingCmd(false); }}>
                        Confirmar DESLIGAR
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {estado === true && (
                <div className="mt-2 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 rounded">
                  Em NORMAL o fancoil segue a programação horária — mude para FORÇADO para comandar manualmente.
                </div>
              )}
            </div>

            {/* c) Setpoint */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Setpoint (envio ao fancoil)</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-14 w-14" data-testid="setpoint-decrement-button"
                        disabled={!online || sendingSp}
                        onClick={() => setSpBuffer((v) => (v != null ? v : serverSp ?? 23) - 0.5)}>
                  <Minus className="w-4 h-4" />
                </Button>
                <div className="flex-1 text-center font-display text-3xl font-black">
                  {setpoint != null ? setpoint.toFixed(1) : "--"} °C
                </div>
                <Button variant="outline" size="icon" className="h-14 w-14" data-testid="setpoint-increment-button"
                        disabled={!online || sendingSp}
                        onClick={() => setSpBuffer((v) => (v != null ? v : serverSp ?? 23) + 0.5)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <Button
                className="w-full mt-2 h-14 font-semibold uppercase tracking-wide"
                data-testid="setpoint-apply-button"
                disabled={!online || sendingSp || spBuffer == null || spBuffer === serverSp}
                onClick={async () => {
                  setSendingSp(true);
                  await sendCommand("SETPOINT", spBuffer.toFixed(1));
                  setSpBuffer(null);
                  setSendingSp(false);
                }}
              >
                Aplicar setpoint
              </Button>
              <div className="text-[10px] text-muted-foreground font-mono mt-1">
                Limites: {fancoil.setpoint_min} – {fancoil.setpoint_max} °C
              </div>
            </div>

            {/* d) Pressão */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Pressão (envio ao fancoil, 0–100 %)</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-14 w-14" data-testid="pressure-decrement-button"
                        disabled={!online || sendingPressure}
                        onClick={() => setPressureBuffer((v) => Math.max(0, (v != null ? v : serverPressure ?? 50) - 5))}>
                  <Minus className="w-4 h-4" />
                </Button>
                <div className="flex-1 text-center font-display text-3xl font-black">
                  {pressure != null ? pressure.toFixed(1) : "--"} %
                </div>
                <Button variant="outline" size="icon" className="h-14 w-14" data-testid="pressure-increment-button"
                        disabled={!online || sendingPressure}
                        onClick={() => setPressureBuffer((v) => Math.min(100, (v != null ? v : serverPressure ?? 50) + 5))}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <Button
                className="w-full mt-2 h-14 font-semibold uppercase tracking-wide"
                data-testid="pressure-apply-button"
                disabled={!online || sendingPressure || pressureBuffer == null || pressureBuffer === serverPressure}
                onClick={async () => {
                  setSendingPressure(true);
                  await sendCommand("PRESSAO", pressureBuffer.toFixed(1));
                  setPressureBuffer(null);
                  setSendingPressure(false);
                }}
              >
                Aplicar pressão
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Chart */}
      <Card className="p-4 lg:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
          <h2 className="font-display text-lg uppercase tracking-wider">Histórico</h2>
          <div className="flex gap-1">
            {[
              [1, "24h"],
              [7, "7d"],
              [30, "30d"],
            ].map(([d, lbl]) => (
              <Button
                key={d}
                variant={range === d ? "default" : "outline"}
                size="sm"
                data-testid={`range-${lbl}`}
                onClick={() => setRange(d)}
              >
                {lbl}
              </Button>
            ))}
          </div>
        </div>
        <div style={{ width: "100%", height: 288, minHeight: 240 }}>
          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
            <LineChart data={chartData}>
              <CartesianGrid strokeOpacity={0.15} />
              <XAxis dataKey="t" fontSize={10} tick={{ fill: "currentColor" }} hide={chartData.length > 48} />
              <YAxis yAxisId="l" fontSize={10} tick={{ fill: "currentColor" }} />
              <YAxis yAxisId="r" orientation="right" fontSize={10} tick={{ fill: "currentColor" }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Legend />
              <Line yAxisId="l" type="monotone" dataKey="temperatura" stroke="#f97316" strokeWidth={2} dot={false} name="Temp. (°C)" />
              <Line yAxisId="l" type="monotone" dataKey="setpoint" stroke="#10b981" strokeWidth={2} dot={false} name="SP (°C)" />
              <Line yAxisId="r" type="monotone" dataKey="vag" stroke="#0ea5e9" strokeWidth={2} dot={false} name="VAG (%)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

    </div>
  );
}
