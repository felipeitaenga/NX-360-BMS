import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  FileText, Download, Search, History, Terminal, Timer, LogIn, ShieldCheck, User, Info, Trash2, Save,
} from "lucide-react";

const TZ = { timeZone: "America/Sao_Paulo" };
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { ...TZ, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const PERIODOS = [1, 7, 30, 90];
const CAT_AUD = ["Fancoils", "CAG", "Hidráulica", "Iluminação", "Programação", "Alarmes", "Firmware", "Usuários", "Sistema", "Relatórios", "Outros"];
const CAT_CMD = ["Fancoils", "CAG", "Hidráulica", "Programação", "Firmware"];
const CAT_COR = {
  Fancoils: "#38bdf8", CAG: "#22d3ee", "Hidráulica": "#60a5fa", "Iluminação": "#facc15", "Programação": "#a78bfa",
  Alarmes: "#f87171", Firmware: "#fb923c", "Usuários": "#f472b6", Sistema: "#94a3b8", "Relatórios": "#34d399", Outros: "#64748b",
};
const ABAS = [
  { k: "alteracoes", l: "Alterações", icon: History },
  { k: "comandos", l: "Comandos", icon: Terminal },
  { k: "horas", l: "Horas ligado", icon: Timer },
  { k: "acessos", l: "Acessos", icon: LogIn, admin: true },
  { k: "privacidade", l: "Privacidade (LGPD)", icon: ShieldCheck, admin: true },
];

function Th({ children, className = "" }) {
  return <th className={`px-3 py-2.5 font-mono uppercase text-[10px] tracking-wider text-muted-foreground text-left ${className}`}>{children}</th>;
}
function Cat({ c }) {
  const cor = CAT_COR[c] || "#64748b";
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: cor, borderColor: cor + "66", background: cor + "14" }}>{c}</span>;
}
function Usuario({ r }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-6 h-6 rounded-full bg-sky-500/15 text-sky-300 flex items-center justify-center shrink-0"><User className="w-3.5 h-3.5" /></div>
      <div className="min-w-0">
        <div className="font-semibold truncate">{r.usuario}</div>
        {r.email && r.email !== r.usuario && <div className="text-[10px] text-muted-foreground truncate">{r.email}</div>}
      </div>
    </div>
  );
}
const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

async function baixarCsv(caminho, params, nome) {
  const token = localStorage.getItem("access_token");
  const qs = new URLSearchParams({ ...params, format: "csv" }).toString();
  const r = await fetch(`${API}${caminho}?${qs}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!r.ok) { toast.error("Não foi possível exportar"); return; }
  const u = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = u; a.download = nome; a.click();
  URL.revokeObjectURL(u);
}

/* barra de filtros comum */
function Filtros({ f, setF, categorias, usuarios, mostrarUsuario = true, onCsv, total }) {
  return (
    <div className="p-3 flex flex-col xl:flex-row gap-2 xl:items-center border-b border-border">
      <div className="flex rounded-md overflow-hidden border border-border shrink-0 self-start">
        {PERIODOS.map((d) => (
          <button key={d} onClick={() => setF({ ...f, days: d })}
            className={`px-3 py-1.5 text-xs font-bold ${f.days === d ? "bg-sky-600 text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"}`}>
            {d === 1 ? "24 h" : `${d} dias`}
          </button>
        ))}
      </div>
      {mostrarUsuario && (
        <select className={sel} value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} data-testid="rel-filtro-usuario">
          <option value="">Todos os usuários</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      )}
      {categorias && (
        <select className={sel} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} data-testid="rel-filtro-categoria">
          <option value="">Todos os sistemas</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <div className="relative flex-1 min-w-[180px]">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Buscar…" className="pl-9 h-9" />
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground font-mono">{total} registros</span>
        {onCsv && <Button size="sm" variant="outline" onClick={onCsv} data-testid="export-csv-button"><Download className="w-4 h-4 mr-1" />CSV</Button>}
      </div>
    </div>
  );
}

function useDebounce(v, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
const params = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v != null));

/* ---------- Alterações (auditoria) ---------- */
function Alteracoes({ usuarios, admin }) {
  const [f, setF] = useState({ days: 7, usuario: "", categoria: "", q: "" });
  const fd = useDebounce(f);
  const { data = [], isLoading } = useQuery({ queryKey: ["rep-aud", fd], queryFn: async () => (await api.get("/reports/auditoria", { params: params(fd) })).data });
  return (
    <Card className="overflow-hidden">
      <Filtros f={f} setF={setF} categorias={admin ? CAT_AUD : CAT_AUD.filter((c) => !["Usuários", "Sistema", "Relatórios"].includes(c))}
        usuarios={usuarios} total={data.length} onCsv={() => baixarCsv("/reports/auditoria", params(f), "auditoria.csv")} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><Th>Data/hora</Th><Th>Usuário</Th><Th>Sistema</Th><Th>Ação</Th><Th>Alvo</Th>{admin && <Th>Detalhe</Th>}{admin && <Th>IP</Th>}<Th>Resultado</Th></tr></thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{dataHora(r.timestamp)}</td>
                <td className="px-3 py-2 max-w-[220px]"><Usuario r={r} /></td>
                <td className="px-3 py-2"><Cat c={r.categoria} /></td>
                <td className="px-3 py-2">{r.acao}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.alvo || "—"}</td>
                {admin && <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground max-w-[320px] break-all">{r.detalhe || "—"}</td>}
                {admin && <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">{r.ip || "—"}</td>}
                <td className="px-3 py-2">{(r.status || 0) < 400
                  ? <span className="text-emerald-400 text-xs font-bold">OK</span>
                  : <span className="text-red-400 text-xs font-bold" title={`HTTP ${r.status}`}>Recusado</span>}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{isLoading ? "Carregando…" : "Nenhuma alteração no período."}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Comandos ---------- */
function Comandos({ usuarios }) {
  const [f, setF] = useState({ days: 7, usuario: "", categoria: "", q: "" });
  const fd = useDebounce(f);
  const { data = [], isLoading } = useQuery({ queryKey: ["rep-cmd", fd], queryFn: async () => (await api.get("/reports/commands", { params: params(fd) })).data });
  return (
    <Card className="overflow-hidden">
      <Filtros f={f} setF={setF} categorias={CAT_CMD} usuarios={usuarios} total={data.length}
        onCsv={() => baixarCsv("/reports/commands", params(f), "log_comandos.csv")} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><Th>Data/hora</Th><Th>Usuário</Th><Th>Sistema</Th><Th>Equipamento</Th><Th>Comando</Th><Th>De</Th><Th>Para</Th><Th>Confirmado</Th></tr></thead>
          <tbody>
            {data.map((c, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{dataHora(c.timestamp)}</td>
                <td className="px-3 py-2 max-w-[220px]"><Usuario r={c} /></td>
                <td className="px-3 py-2"><Cat c={c.categoria} /></td>
                <td className="px-3 py-2">{c.alvo}{c.simulacao ? <span className="ml-1 text-[10px] text-violet-300">(sim.)</span> : null}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.tipo}</td>
                <td className="px-3 py-2 font-mono text-xs max-w-[160px] truncate" title={c.previous_value}>{c.previous_value ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs max-w-[160px] truncate" title={c.value}>{c.value ?? "—"}</td>
                <td className="px-3 py-2">{c.confirmed ? <span className="text-emerald-400">✓</span> : "—"}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{isLoading ? "Carregando…" : "Nenhum comando no período."}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Horas ligado ---------- */
function Horas() {
  const [days, setDays] = useState(30);
  const { data = {} } = useQuery({ queryKey: ["rep-hours", days], queryFn: async () => (await api.get("/reports/hours-on", { params: { days } })).data });
  const linhas = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...linhas.map(([, v]) => v));
  return (
    <Card className="overflow-hidden">
      <div className="p-3 flex items-center gap-2 border-b border-border">
        <div className="flex rounded-md overflow-hidden border border-border">
          {PERIODOS.map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-xs font-bold ${days === d ? "bg-sky-600 text-white" : "bg-muted/30 text-muted-foreground hover:bg-muted/60"}`}>{d === 1 ? "24 h" : `${d} dias`}</button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">horas aproximadas pelo histórico (1 amostra/min)</span>
      </div>
      <div className="p-3 space-y-1.5">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 text-sm">
            <div className="w-24 shrink-0 font-display font-bold">{k}</div>
            <div className="flex-1 h-4 rounded bg-muted/50 overflow-hidden"><div className="h-full bg-sky-500/70 rounded" style={{ width: `${(v / max) * 100}%` }} /></div>
            <div className="w-20 text-right font-mono text-xs">{v} h</div>
          </div>
        ))}
        {!linhas.length && <div className="p-6 text-center text-muted-foreground">Sem dados ainda</div>}
      </div>
    </Card>
  );
}

/* ---------- Acessos (admin) ---------- */
function Acessos({ usuarios }) {
  const [f, setF] = useState({ days: 30, usuario: "", q: "" });
  const { data = [], isLoading } = useQuery({ queryKey: ["rep-access", f.days, f.usuario], queryFn: async () => (await api.get("/reports/access-log", { params: params({ days: f.days, usuario: f.usuario }) })).data });
  const t = f.q.trim().toLowerCase();
  const lista = t ? data.filter((a) => [a.usuario, a.email, a.acao, a.ip].join(" ").toLowerCase().includes(t)) : data;
  const falhas = data.filter((a) => a.action === "login_falha").length;
  return (
    <Card className="overflow-hidden">
      <Filtros f={f} setF={setF} usuarios={usuarios} total={lista.length}
        onCsv={() => baixarCsv("/reports/access-log", params({ days: f.days, usuario: f.usuario }), "log_acessos.csv")} />
      {falhas > 0 && <div className="px-3 py-2 text-xs text-amber-300 bg-amber-500/10 border-b border-border">{falhas} tentativa(s) de login com senha incorreta no período.</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><Th>Data/hora</Th><Th>Usuário</Th><Th>Evento</Th><Th>IP</Th></tr></thead>
          <tbody>
            {lista.map((a, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{dataHora(a.timestamp)}</td>
                <td className="px-3 py-2"><Usuario r={a} /></td>
                <td className="px-3 py-2"><span className={a.action === "login_falha" ? "text-amber-400 font-bold" : ""}>{a.acao}</span></td>
                <td className="px-3 py-2 font-mono text-xs">{a.ip || "—"}</td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">{isLoading ? "Carregando…" : "Nenhum acesso no período."}</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Privacidade (LGPD) ---------- */
function Privacidade() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["lgpd"], queryFn: async () => (await api.get("/lgpd")).data });
  const [cfg, setCfg] = useState(null);
  useEffect(() => { if (data && !cfg) setCfg(data.config); }, [data, cfg]);
  if (!data || !cfg) return <Card className="p-10 text-center text-muted-foreground">Carregando…</Card>;
  const salvar = async () => {
    try { const r = await api.put("/lgpd", Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, Number(v)]))); qc.setQueryData(["lgpd"], r.data); toast.success("Retenção salva"); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const expurgar = async () => {
    if (!window.confirm("Apagar agora os registros mais antigos que os prazos de retenção? Não tem como desfazer.")) return;
    try { const r = await api.post("/lgpd/expurgar"); toast.success(`Removidos: ${r.data.access_log} acessos, ${r.data.audit_log} alterações, ${r.data.command_log} comandos`); qc.invalidateQueries({ queryKey: ["lgpd"] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const campos = [
    ["retencao_acessos_dias", "Log de acesso", "mínimo 180 dias (Marco Civil da Internet, art. 15)"],
    ["retencao_auditoria_dias", "Auditoria de alterações", "90 a 3650 dias"],
    ["retencao_comandos_dias", "Log de comandos", "90 a 3650 dias"],
  ];
  const ue = data.ultimo_expurgo;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5">
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="font-display text-sm uppercase tracking-widest">Dados pessoais tratados</div>
          <div className="text-xs text-muted-foreground mt-1">Inventário do que o NX-360 guarda sobre os usuários do sistema.</div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40"><tr><Th>Registro</Th><Th>Dados</Th><Th className="text-right">Qtde</Th><Th>Mais antigo</Th></tr></thead>
          <tbody>
            {data.inventario.map((x) => (
              <tr key={x.colecao} className="border-t border-border align-top">
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{x.nome}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{x.dados}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{x.registros.toLocaleString("pt-BR")}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{x.mais_antigo ? dataHora(x.mais_antigo).slice(0, 8) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-4 border-t border-border text-xs text-muted-foreground space-y-1.5 leading-relaxed">
          <div><b className="text-foreground">Finalidade:</b> segurança da informação e rastreabilidade da operação predial (quem comandou ou alterou cada equipamento).</div>
          <div><b className="text-foreground">Base legal (LGPD):</b> art. 7º, II (obrigação legal/regulatória) e IX (legítimo interesse); art. 37 (registro das operações de tratamento).</div>
          <div><b className="text-foreground">Minimização:</b> e-mail, IP e detalhes técnicos só aparecem para administradores; os demais perfis veem apenas o nome. Senhas e tokens nunca entram nos registros (senha guardada só como hash bcrypt).</div>
          <div><b className="text-foreground">Rastreio de exportações:</b> todo CSV exportado fica registrado em Alterações (quem, quando e qual relatório).</div>
        </div>
      </Card>

      <Card className="p-4 space-y-4 self-start">
        <div>
          <div className="font-display text-sm uppercase tracking-widest">Prazo de retenção</div>
          <div className="text-xs text-muted-foreground mt-1">Registros mais antigos que o prazo são apagados automaticamente uma vez por dia.</div>
        </div>
        {campos.map(([k, l, d]) => (
          <div key={k} className="flex items-center gap-3">
            <div className="flex-1"><div className="text-sm">{l}</div><div className="text-[10px] text-muted-foreground">{d}</div></div>
            <Input type="number" className="w-24 h-9 text-right font-mono" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} data-testid={`lgpd-${k}`} />
            <span className="text-xs text-muted-foreground w-7">dias</span>
          </div>
        ))}
        <div className="flex gap-2">
          <Button onClick={salvar} className="bg-sky-600 hover:bg-sky-500 flex-1"><Save className="w-4 h-4 mr-1" />Salvar</Button>
          <Button variant="outline" onClick={expurgar}><Trash2 className="w-4 h-4 mr-1" />Expurgar agora</Button>
        </div>
        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Último expurgo: {ue ? `${dataHora(ue.em)} — ${ue.access_log} acessos, ${ue.audit_log} alterações, ${ue.command_log} comandos removidos` : "ainda não executado"}
        </div>
      </Card>
    </div>
  );
}

export default function Relatorios() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const abas = ABAS.filter((a) => !a.admin || admin);
  const [aba, setAba] = useState("alteracoes");
  const { data: usuarios = [] } = useQuery({ queryKey: ["rep-usuarios"], queryFn: async () => (await api.get("/reports/usuarios")).data });
  const tab = (k) => `px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 border whitespace-nowrap ${aba === k ? "bg-sky-500/15 border-sky-500/50 text-sky-200" : "border-border text-muted-foreground hover:bg-muted/40"}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5" data-testid="reports-page">
      <div>
        <h1 className="font-display text-2xl lg:text-3xl font-black tracking-tight uppercase flex items-center gap-3">
          <FileText className="w-7 h-7 text-sky-400" /> Relatórios
        </h1>
        <div className="text-sm text-muted-foreground mt-1">Quem alterou e comandou cada equipamento, horas de uso e acessos ao sistema</div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {abas.map((a) => { const I = a.icon; return <button key={a.k} className={tab(a.k)} onClick={() => setAba(a.k)} data-testid={`tab-${a.k}`}><I className="w-4 h-4" />{a.l}</button>; })}
      </div>

      {aba === "alteracoes" && <Alteracoes usuarios={usuarios} admin={admin} />}
      {aba === "comandos" && <Comandos usuarios={usuarios} />}
      {aba === "horas" && <Horas />}
      {aba === "acessos" && admin && <Acessos usuarios={usuarios} />}
      {aba === "privacidade" && admin && <Privacidade />}

      <div className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Estes relatórios contêm dados pessoais (LGPD). Use apenas para operação e segurança do edifício; não compartilhe exportações fora da equipe responsável.
      </div>
    </div>
  );
}
