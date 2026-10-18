import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import { toast } from "sonner";
import { Upload, Trash2, Cpu, AlertTriangle, Square } from "lucide-react";

export const rssiColor = (r) => (r == null ? "text-muted-foreground" : r > -67 ? "text-emerald-400" : r >= -80 ? "text-amber-400" : "text-red-400");
export const fmtUptime = (m) => {
  if (m == null) return "—";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
};
const fmtDate = (s) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

const STATUS_STYLE = {
  fila: "text-muted-foreground", enviado: "text-sky-400", ok: "text-emerald-400",
  erro: "text-red-400", timeout: "text-red-400",
};

function otaLabel(item, st) {
  const ota = st?.ota_state || "";
  if (item?.status === "enviado") {
    if (/^baixando/i.test(ota)) return "baixando…";
    if (/reiniciando/i.test(ota)) return "reiniciando…";
    return "enviado, aguardando…";
  }
  if (item?.status === "ok") return "ok";
  if (item?.status === "timeout") return "erro: timeout 10 min";
  if (item?.status === "erro") return /rollback/i.test(item.msg || "") ? "rollback" : item.msg || "erro";
  if (item?.status === "fila") return "na fila";
  return ota || "—";
}

function UploadCard({ onDone }) {
  const [file, setFile] = useState(null);
  const [versao, setVersao] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file || !versao) return toast.error("Selecione o .bin e informe a versão");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("versao", versao.trim());
    fd.append("notas", notas);
    setBusy(true);
    try {
      await api.post("/admin/firmware", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Firmware ${versao} enviado`);
      setFile(null); setVersao(""); setNotas("");
      onDone();
    } catch (e) { toast.error(formatApiError(e)); }
    setBusy(false);
  };
  return (
    <Card className="p-4">
      <h3 className="font-display text-sm uppercase tracking-widest mb-3 flex items-center gap-2"><Upload className="w-4 h-4 text-sky-400" /> Enviar novo firmware (.bin)</h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div><Label>Arquivo .bin (até 4 MB)</Label><Input type="file" accept=".bin" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="fw-file-input" /></div>
        <div><Label>Versão (X.Y.Z)</Label><Input value={versao} onChange={(e) => setVersao(e.target.value)} placeholder="1.4.1" data-testid="fw-version-input" /></div>
        <div><Label>Notas</Label><Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="O que mudou" data-testid="fw-notes-input" /></div>
        <Button onClick={submit} disabled={busy} data-testid="fw-upload-btn">{busy ? "Enviando…" : "Enviar"}</Button>
      </div>
    </Card>
  );
}

function FirmwareList({ firmwares, onChange }) {
  const del = async (f) => {
    if (!window.confirm(`Excluir o firmware ${f.versao}?`)) return;
    try { await api.delete(`/admin/firmware/${f.id}`); onChange(); } catch (e) { toast.error(formatApiError(e)); }
  };
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b border-border font-display text-sm uppercase tracking-widest">Versões disponíveis ({firmwares.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left"><tr>
            <th className="p-2">Versão</th><th className="p-2">Arquivo</th><th className="p-2">Tamanho</th>
            <th className="p-2">MD5</th><th className="p-2">Data</th><th className="p-2">Notas</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {firmwares.map((f) => (
              <tr key={f.id} className="border-t border-border/60" data-testid={`fw-row-${f.versao}`}>
                <td className="p-2 font-mono font-bold text-sky-400">v{f.versao}</td>
                <td className="p-2 font-mono">{f.nome_arquivo}</td>
                <td className="p-2 font-mono">{(f.tamanho / 1024).toFixed(0)} KB</td>
                <td className="p-2 font-mono text-muted-foreground" data-testid={`fw-md5-${f.versao}`}>{f.md5}</td>
                <td className="p-2 font-mono">{fmtDate(f.criado_em)}</td>
                <td className="p-2">{f.notas || "—"}</td>
                <td className="p-2"><Button size="sm" variant="outline" onClick={() => del(f)} data-testid={`fw-delete-${f.versao}`}><Trash2 className="w-3 h-3" /></Button></td>
              </tr>
            ))}
            {!firmwares.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhum firmware enviado.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BatchBanner({ batch, onCancel }) {
  if (!batch?.status) return null;
  const color = batch.status === "executando" ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
    : batch.status === "concluido" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
    : "border-red-500/40 bg-red-500/10 text-red-200";
  const done = batch.items.filter((i) => i.status === "ok").length;
  return (
    <Card className={`p-3 text-sm flex items-center justify-between gap-3 ${color}`} data-testid="ota-batch-banner">
      <div>
        <b className="uppercase">Lote v{batch.versao} — {batch.status}</b> · {done}/{batch.items.length} ok
        {batch.message && <div className="text-xs mt-1">{batch.message}</div>}
        {batch.skipped?.length > 0 && <div className="text-xs mt-1 opacity-80">Ignoradas: {batch.skipped.map((s) => `${s.device_id} (${s.motivo})`).join(", ")}</div>}
      </div>
      {batch.status === "executando" && (
        <Button size="sm" variant="outline" onClick={onCancel} data-testid="ota-cancel-btn"><Square className="w-3 h-3 mr-1" /> Parar lote</Button>
      )}
    </Card>
  );
}

function ControllerRow({ c, st, item, checked, onToggle }) {
  const s = { ...c, ...(st || {}) };
  return (
    <tr className="border-t border-border/60" data-testid={`fw-ctrl-row-${c.device_id}`}>
      <td className="p-2"><Checkbox checked={checked} onCheckedChange={onToggle} data-testid={`fw-select-${c.device_id}`} /></td>
      <td className="p-2 font-bold">{c.name || <span className="text-muted-foreground font-normal">não cadastrado</span>}</td>
      <td className="p-2 font-mono">{c.device_id}</td>
      <td className="p-2 font-mono text-sky-400">{s.firmware_version ? `v${s.firmware_version}` : "—"}</td>
      <td className="p-2">{s.online ? <span className="text-emerald-400">online</span> : <span className="text-slate-500">offline</span>}</td>
      <td className={`p-2 font-mono ${rssiColor(s.rssi)}`} data-testid={`fw-rssi-${c.device_id}`}>{s.rssi != null ? `${s.rssi} dBm` : "—"}</td>
      <td className="p-2 font-mono">{fmtUptime(s.uptime_min)}</td>
      <td className="p-2 font-mono max-w-[220px] truncate" title={s.reset_reason || ""}>{s.reset_reason || "—"}</td>
      <td className={`p-2 font-mono ${STATUS_STYLE[item?.status] || "text-muted-foreground"}`} data-testid={`fw-ota-${c.device_id}`}>{otaLabel(item, s)}</td>
    </tr>
  );
}

export function FirmwareTab() {
  const qc = useQueryClient();
  const { states } = useTelemetry();
  const [sel, setSel] = useState(new Set());
  const [fwId, setFwId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: firmwares = [] } = useQuery({ queryKey: ["firmwares"], queryFn: async () => (await api.get("/admin/firmware")).data });
  const { data: ctrls = [] } = useQuery({ queryKey: ["fw-ctrls"], queryFn: async () => (await api.get("/admin/firmware/controladoras")).data, refetchInterval: 5000 });
  const { data: batch } = useQuery({ queryKey: ["fw-batch"], queryFn: async () => (await api.get("/admin/firmware/lote")).data, refetchInterval: 2000 });
  const items = Object.fromEntries((batch?.items || []).map((i) => [i.device_id, i]));
  const fw = firmwares.find((f) => f.id === fwId);
  const refreshFw = () => qc.invalidateQueries({ queryKey: ["firmwares"] });
  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const send = async () => {
    try {
      const r = await api.post(`/admin/firmware/${fwId}/enviar`, { device_ids: [...sel] });
      toast.success(`Lote iniciado: ${r.data.items.length} controladora(s)`);
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ["fw-batch"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const cancel = async () => { await api.post("/admin/firmware/lote/cancelar"); qc.invalidateQueries({ queryKey: ["fw-batch"] }); };

  return (
    <div className="space-y-6" data-testid="firmware-tab">
      <UploadCard onDone={refreshFw} />
      <FirmwareList firmwares={firmwares} onChange={refreshFw} />
      <BatchBanner batch={batch} onCancel={cancel} />
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border flex flex-wrap items-center gap-3">
          <div className="font-display text-sm uppercase tracking-widest flex items-center gap-2 mr-auto"><Cpu className="w-4 h-4 text-sky-400" /> Controladoras ({ctrls.length})</div>
          <Select value={fwId} onValueChange={setFwId}>
            <SelectTrigger className="w-44" data-testid="fw-version-select"><SelectValue placeholder="Versão…" /></SelectTrigger>
            <SelectContent>{firmwares.map((f) => <SelectItem key={f.id} value={f.id}>v{f.versao}</SelectItem>)}</SelectContent>
          </Select>
          <Button disabled={!fwId || !sel.size || batch?.status === "executando"} onClick={() => setConfirmOpen(true)} data-testid="fw-update-btn">
            Atualizar ({sel.size})
          </Button>
        </div>
        <div className="px-3 py-2 text-xs bg-amber-500/10 text-amber-300 border-b border-amber-500/30 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Recomendação: atualize primeiro UMA controladora de teste e confirme que voltou com a nova versão antes de atualizar as demais. O lote é escalonado (uma por vez) e pausa na primeira falha.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left"><tr>
              <th className="p-2"></th><th className="p-2">Nome</th><th className="p-2">device_id</th><th className="p-2">Versão</th>
              <th className="p-2">Conexão</th><th className="p-2">RSSI</th><th className="p-2">Uptime</th><th className="p-2">Último RESET</th><th className="p-2">OTA</th>
            </tr></thead>
            <tbody>
              {ctrls.map((c) => (
                <ControllerRow key={c.device_id} c={c} st={states[c.device_id]} item={items[c.device_id]} checked={sel.has(c.device_id)} onToggle={() => toggle(c.device_id)} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atualizar {sel.size} controladora(s) para v{fw?.versao}?</AlertDialogTitle>
            <AlertDialogDescription>
              O fancoil continua operando durante o download; a controladora reinicia ao final. Serão atualizadas uma por vez — o lote pausa se alguma falhar. Controladoras offline ou já nesta versão serão ignoradas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={send} data-testid="fw-confirm-update">Atualizar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
