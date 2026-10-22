import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../../lib/api";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toast } from "sonner";
import { Power, PowerOff, Play, Square, Bot, Hand, AlertTriangle, FlaskConical, Lock, History } from "lucide-react";
import { COR, corEq, estadoTxt } from "./CagSinotico";

const fmt = (v, d = 1, u = "") => (v == null || Number.isNaN(Number(v)) ? "—" : `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}${u}`);
const fmtH = (h) => (h == null ? "—" : `${Math.round(h).toLocaleString("pt-BR")} h`);

function Pill({ e }) {
  const c = corEq(e);
  return <span className="text-[10px] font-black tracking-wider px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0" style={{ color: c, borderColor: c + "88", background: c + "1a" }}>{estadoTxt(e)}</span>;
}

/* ---------- Faceplate de equipamento (bomba, chiller ou válvula) ---------- */
export function Faceplate({ id, s, pode, isAdmin, onDone, compact }) {
  const e = s.equipamentos[id];
  const [busy, setBusy] = useState(false);
  if (!e) return null;
  const auto = s.geral.modo === "AUTO";
  const valv = e.tipo === "valvula";
  const ligado = valv ? e.aberta : e.status;
  const bloqueio = auto ? "Central em automático" : !e.remoto ? "Equipamento em LOCAL" : null;
  const cmd = async (ligar) => {
    const verbo = valv ? (ligar ? "ABRIR" : "FECHAR") : ligar ? "LIGAR" : "DESLIGAR";
    if (!ligar && !window.confirm(`${verbo} ${e.nome}?`)) return;
    setBusy(true);
    try { await api.post("/cag/comando", { equipamento: id, ligar }); toast.success(`${e.nome}: ${verbo} enviado`); onDone(); }
    catch (err) { toast.error(formatApiError(err)); }
    setBusy(false);
  };
  const falha = async (v) => { try { await api.post("/cag/simular-falha", { equipamento: id, falha: v }); onDone(); } catch (err) { toast.error(formatApiError(err)); } };
  const linhas = [
    ["Comando", e.remoto ? "Remoto" : <span className="text-amber-400 inline-flex items-center gap-1"><Hand className="w-3 h-3" />Local</span>],
    ...(!valv ? [["Horímetro", fmtH(e.horas)]] : []),
    ...(e.tipo === "chiller" ? [["Água saída", fmt(e.temp_saida, 1, " °C")], ["Água entrada", fmt(e.temp_entrada, 1, " °C")], ["Carga", fmt(e.carga, 0, " %")]] : []),
    ...(e.velocidade != null ? [["Inversor", fmt(e.velocidade, 0, " %")]] : []),
  ];
  return (
    <Card className={`p-3 space-y-2 border-l-4`} style={{ borderLeftColor: corEq(e) }} data-testid={`cag-face-${id}`}>
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-display font-black text-sm">{id}</div><div className="text-[11px] text-muted-foreground">{e.nome}</div></div>
        <Pill e={e} />
      </div>
      {!compact && (
        <div className="text-xs divide-y divide-border/50">
          {linhas.map(([k, v]) => <div key={k} className="flex justify-between py-1"><span className="text-muted-foreground">{k}</span><span className="font-mono">{v}</span></div>)}
        </div>
      )}
      {e.falha && <div className="text-[11px] text-red-400 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />Em falha — verificar no local</div>}
      {pode && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" disabled={busy || !!bloqueio || e.falha || (ligado && !e.pendente)} onClick={() => cmd(true)} className="bg-emerald-600 hover:bg-emerald-500 h-8" data-testid={`cag-on-${id}`}>
              <Power className="w-3.5 h-3.5 mr-1" />{valv ? "Abrir" : "Ligar"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !!bloqueio || (!ligado && !e.pendente)} onClick={() => cmd(false)} className="h-8" data-testid={`cag-off-${id}`}>
              <PowerOff className="w-3.5 h-3.5 mr-1" />{valv ? "Fechar" : "Desligar"}
            </Button>
          </div>
          {bloqueio && <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" />{bloqueio}</div>}
        </>
      )}
      {isAdmin && s.simulacao && (
        <label className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border pt-1.5">
          <span className="flex items-center gap-1"><FlaskConical className="w-3 h-3" />Simular falha</span>
          <Switch checked={!!e.falha} onCheckedChange={falha} className="scale-75" />
        </label>
      )}
    </Card>
  );
}

/* ---------- Setpoints ---------- */
export function Setpoints({ s, pode, onDone }) {
  const [agua, setAgua] = useState("");
  const [dp, setDp] = useState("");
  const enviar = async (tipo, valor, limpar) => {
    try { await api.post("/cag/setpoint", { tipo, valor: Number(String(valor).replace(",", ".")) }); toast.success("Setpoint enviado"); limpar(""); onDone(); }
    catch (err) { toast.error(formatApiError(err)); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-display text-sm uppercase tracking-widest">Setpoints</div>
      {[
        { k: "agua", l: "Água gelada (°C)", atual: s.geral.setpoint, v: agua, set: setAgua, ph: "5 a 12", d: 1 },
        { k: "dp", l: "Pressão diferencial (kPa)", atual: s.geral.dp_setpoint, v: dp, set: setDp, ph: "20 a 300", d: 0 },
      ].map((x) => (
        <div key={x.k}>
          <div className="text-xs text-muted-foreground flex justify-between"><span>{x.l}</span><span className="font-mono text-foreground">atual {fmt(x.atual, x.d)}</span></div>
          {pode && (
            <div className="flex gap-2 mt-1">
              <Input value={x.v} onChange={(ev) => x.set(ev.target.value)} placeholder={x.ph} inputMode="decimal" className="h-9" data-testid={`cag-sp-${x.k}`} />
              <Button size="sm" className="h-9" disabled={!x.v} onClick={() => enviar(x.k, x.v, x.set)}>Aplicar</Button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/* ---------- Central: modo, partir/parar, líder ---------- */
function Central({ s, pode, onDone }) {
  const g = s.geral;
  const auto = g.modo === "AUTO";
  const enviar = async (body, msg) => {
    try { await api.post("/cag/central", body); toast.success(msg); onDone(); } catch (err) { toast.error(formatApiError(err)); }
  };
  const mudarModo = (m) => {
    if (m === g.modo) return;
    const txt = m === "MANUAL"
      ? "Passar a central para MANUAL? A sequência automática para e cada equipamento passa a ser comandado aqui, um a um."
      : "Passar a central para AUTOMÁTICO? A controladora assume a sequência (válvula → bomba → chiller) e os comandos individuais ficam bloqueados.";
    if (window.confirm(txt)) enviar({ modo: m }, `Central em ${m === "AUTO" ? "AUTOMÁTICO" : "MANUAL"}`);
  };
  const seg = (ativo) => `flex-1 px-3 py-2 text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${ativo ? "bg-sky-600 text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"} disabled:opacity-60`;
  return (
    <Card className="p-4 space-y-4" data-testid="cag-central">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm uppercase tracking-widest">Central</div>
        <span className={`text-xs font-black px-2 py-1 rounded border ${g.central ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" : "text-slate-400 border-border"}`}>
          {g.central ? "EM OPERAÇÃO" : "PARADA"}
        </span>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Modo</div>
        <div className="flex rounded-md overflow-hidden border border-border">
          <button className={seg(auto)} disabled={!pode} onClick={() => mudarModo("AUTO")} data-testid="cag-modo-auto"><Bot className="w-4 h-4" />Automático</button>
          <button className={seg(!auto)} disabled={!pode} onClick={() => mudarModo("MANUAL")} data-testid="cag-modo-manual"><Hand className="w-4 h-4" />Manual</button>
        </div>
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${auto ? "" : "opacity-50"}`}>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Partida / parada</div>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!pode || !auto || g.central} onClick={() => enviar({ ligar: true }, "Partida da central enviada")} className="bg-emerald-600 hover:bg-emerald-500" data-testid="cag-partir"><Play className="w-4 h-4 mr-1" />Partir</Button>
            <Button variant="outline" disabled={!pode || !auto || !g.central} onClick={() => window.confirm("Parar a central de água gelada?") && enviar({ ligar: false }, "Parada da central enviada")} data-testid="cag-parar"><Square className="w-4 h-4 mr-1" />Parar</Button>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Chiller líder</div>
          <div className="flex rounded-md overflow-hidden border border-border">
            {["CH1", "CH2"].map((c) => (
              <button key={c} className={seg(g.lider === c)} disabled={!pode || !auto} onClick={() => g.lider !== c && enviar({ lider: c }, `${c} agora é o líder`)} data-testid={`cag-lider-${c}`}>{c}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground leading-relaxed">
        {auto
          ? "Automático: a controladora abre a válvula do chiller líder, parte a bomba primária, depois o chiller, e mantém as secundárias pela pressão diferencial. Se o líder falhar, assume o outro."
          : "Manual: comande cada equipamento abaixo. Intertravamentos: o chiller só liga com a válvula de entrada aberta e a bomba primária rodando; a válvula só fecha com o chiller desligado."}
      </div>
    </Card>
  );
}

/* ---------- Histórico ---------- */
function Historico() {
  const { data = [] } = useQuery({ queryKey: ["cag-log"], queryFn: async () => (await api.get("/cag/log", { params: { limit: 20 } })).data, refetchInterval: 5000 });
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b border-border font-display text-sm uppercase tracking-widest flex items-center gap-2"><History className="w-4 h-4" />Últimos comandos</div>
      <div className="overflow-x-auto max-h-72">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left"><tr><th className="p-2">Data/hora</th><th className="p-2">Usuário</th><th className="p-2">Alvo</th><th className="p-2">Ação</th></tr></thead>
          <tbody>
            {data.map((l, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="p-2 font-mono whitespace-nowrap">{new Date(l.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td className="p-2">{l.user_id || "—"}</td>
                <td className="p-2 font-mono">{(l.device_id || "").replace("CAG/", "") || "Central"}</td>
                <td className="p-2 font-bold">{l.acao}{["SETPOINT", "DP_SETPOINT", "MODO", "LIDER"].includes(l.acao) ? ` ${l.value}` : ""}{l.simulacao ? <span className="ml-1 text-violet-300 font-normal">(sim.)</span> : null}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Nenhum comando ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function CagComandos({ s, pode, isAdmin, onDone }) {
  const P = { s, pode, isAdmin, onDone };
  return (
    <div className="space-y-5" data-testid="cag-comandos">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <Central s={s} pode={pode} onDone={onDone} />
        <Setpoints s={s} pode={pode} onDone={onDone} />
      </div>

      <section className="space-y-2">
        <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">Chillers e válvulas de entrada</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {["1", "2"].map((n) => (
            <div key={n} className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
              <Faceplate id={`CH${n}`} {...P} />
              <Faceplate id={`VCH${n}`} {...P} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">Bombas primárias <span className="normal-case tracking-normal">· BAP1→CH1, BAP2→CH2, BAP3 reserva</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{["BAP1", "BAP2", "BAP3"].map((b) => <Faceplate key={b} id={b} {...P} />)}</div>
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">Bombas secundárias <span className="normal-case tracking-normal">· BAS3 reserva</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{["BAS1", "BAS2", "BAS3"].map((b) => <Faceplate key={b} id={b} {...P} />)}</div>
      </section>

      <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        {[["Ligado/aberta", COR.on], ["Desligado/fechada", COR.off], ["Em transição", COR.pend], ["Falha", COR.falha]].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{l}</span>
        ))}
      </div>

      <Historico />
    </div>
  );
}
