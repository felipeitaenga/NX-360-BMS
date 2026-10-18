import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
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
import { Upload, Trash2, Cpu, AlertTriangle, Square, Copy, HelpCircle, PackageX, Plus } from "lucide-react";
import { rssiColor, fmtUptime, fmtDate, inspectFirmwareFile, otaLabel, otaStyle, CAT_LABEL } from "./firmware/fwUtils";
import { FirmwareUpdateDialog } from "./firmware/FirmwareUpdateDialog";
import { ModelFormDialog } from "./firmware/ControllerModels";

export { rssiColor, fmtUptime };

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => ["firmwares", "fw-tree", "fw-ctrls", "fw-batch"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ---------- Upload com pré-visualização da assinatura ----------
function UploadCard({ models, onNewModel }) {
  const refresh = useInvalidateAll();
  const [file, setFile] = useState(null);
  const [info, setInfo] = useState(null);
  const [modelo, setModelo] = useState("");
  const [versao, setVersao] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const pick = async (f) => {
    setFile(f); setInfo(null); setModelo(""); setVersao("");
    if (f) setInfo(await inspectFirmwareFile(f));
    else setResetKey((k) => k + 1);
  };
  const sig = info?.assinatura;
  const catalogado = sig ? models.find((m) => m.modelo === sig.modelo) : null;
  const submit = async () => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("versao", sig ? "" : versao.trim());
    fd.append("modelo", sig ? "" : modelo);
    fd.append("notas", notas);
    setBusy(true);
    try {
      const r = await api.post("/admin/firmware", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${r.data.modelo} v${r.data.versao} salvo em ${CAT_LABEL[r.data.categoria]} → ${r.data.modelo}`);
      pick(null); setNotas("");
      refresh();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(formatApiError(e));
      if (d?.code === "modelo_nao_catalogado") onNewModel({ modelo: d.modelo, categoria: sig?.tipo || "FANCOIL" });
    }
    setBusy(false);
  };
  return (
    <Card className="p-4" data-testid="fw-upload-card">
      <h3 className="font-display text-sm uppercase tracking-widest mb-3 flex items-center gap-2"><Upload className="w-4 h-4 text-sky-400" /> Enviar firmware (.bin)</h3>
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto] gap-3 items-end">
        <div><Label>Arquivo .bin (até 4 MB)</Label><Input type="file" accept=".bin" key={resetKey} onChange={(e) => pick(e.target.files?.[0] || null)} data-testid="fw-file-input" /></div>
        {sig || !info ? (
          <div className="md:col-span-2 text-sm font-mono" data-testid="fw-upload-preview">
            {!info ? <span className="text-muted-foreground">Selecione um arquivo…</span> : (
              <>
                <span className="text-emerald-400 font-bold">{sig.tipo} · {sig.modelo} · v{sig.versao}</span>
                {!catalogado && <div className="text-xs text-amber-300 mt-1">Modelo {sig.modelo} não está no catálogo. <button className="underline" onClick={() => onNewModel({ modelo: sig.modelo, categoria: sig.tipo })} data-testid="fw-upload-new-model">cadastrar</button></div>}
              </>
            )}
          </div>
        ) : (
          <>
            <div>
              <Label>Modelo (sem assinatura)</Label>
              <Select value={modelo} onValueChange={setModelo}>
                <SelectTrigger data-testid="fw-model-select"><SelectValue placeholder="Modelo…" /></SelectTrigger>
                <SelectContent>{models.map((m) => <SelectItem key={m.modelo} value={m.modelo}>{m.modelo}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Versão (X.Y.Z)</Label><Input value={versao} onChange={(e) => setVersao(e.target.value)} placeholder="1.4.1" data-testid="fw-version-input" /></div>
          </>
        )}
        <div><Label>Notas</Label><Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="O que mudou" data-testid="fw-notes-input" /></div>
        <Button onClick={submit} disabled={busy || !file || (info && !info.esp32) || (!sig && (!modelo || !versao))} data-testid="fw-upload-btn">{busy ? "Enviando…" : "Salvar"}</Button>
      </div>
      {info && !info.esp32 && <div className="text-xs text-red-400 mt-2" data-testid="fw-upload-invalid">Arquivo não é uma imagem ESP32 válida (1º byte ≠ 0xE9).</div>}
      {info && info.esp32 && !sig && <div className="text-xs text-amber-300 mt-2">Arquivo sem assinatura NXFW — informe o modelo e a versão.</div>}
    </Card>
  );
}

// ---------- Árvore CATEGORIA → MODELO ----------
function TreeItem({ active, onClick, children, dim, testid }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${active ? "bg-sky-500/15 text-sky-200 border border-sky-500/30" : "hover:bg-muted/40 border border-transparent"} ${dim ? "opacity-50" : ""}`}>
      {children}
    </button>
  );
}

function FirmwareTree({ tree, sel, setSel }) {
  if (!tree) return null;
  return (
    <Card className="p-3 space-y-4 h-fit" data-testid="fw-tree">
      {tree.categorias.map((c) => (
        <div key={c.categoria} className={c.modelos.length ? "" : "opacity-40"} data-testid={`fw-tree-cat-${c.categoria}`}>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{c.label}</div>
          {c.modelos.length ? c.modelos.map((m) => (
            <TreeItem key={m.modelo} active={sel.modelo === m.modelo} onClick={() => setSel({ modelo: m.modelo })} testid={`fw-tree-model-${m.modelo}`}>
              <div className="font-mono font-bold">{m.modelo}</div>
              <div className="text-muted-foreground">{m.n_controladoras} controladora(s) · {m.n_versoes} versão(ões)</div>
            </TreeItem>
          )) : <div className="text-xs text-muted-foreground px-3">sem modelos</div>}
        </div>
      ))}
      <div className="border-t border-border pt-3 space-y-1">
        <TreeItem active={sel.grupo === "sem_modelo"} onClick={() => setSel({ grupo: "sem_modelo" })} dim={!tree.sem_modelo} testid="fw-tree-sem-modelo">
          <div className="flex items-center gap-1 font-bold"><HelpCircle className="w-3 h-3" /> Modelo não informado</div>
          <div className="text-muted-foreground">{tree.sem_modelo} controladora(s)</div>
        </TreeItem>
        <TreeItem active={sel.grupo === "nao_catalogado"} onClick={() => setSel({ grupo: "nao_catalogado" })} dim={!tree.nao_catalogados.length} testid="fw-tree-nao-catalogado">
          <div className="flex items-center gap-1 font-bold"><PackageX className="w-3 h-3" /> Modelos não catalogados</div>
          <div className="text-muted-foreground">{tree.nao_catalogados.map((n) => n.modelo).join(", ") || "nenhum"}</div>
        </TreeItem>
      </div>
    </Card>
  );
}

// ---------- Versões do modelo ----------
function VersionsTable({ modelo, batch }) {
  const refresh = useInvalidateAll();
  const { data: fws = [] } = useQuery({ queryKey: ["firmwares", modelo], queryFn: async () => (await api.get("/admin/firmware", { params: { modelo } })).data });
  const del = async (f) => {
    if (!window.confirm(`Excluir ${f.modelo} v${f.versao}?`)) return;
    try { await api.delete(`/admin/firmware/${f.id}`); refresh(); } catch (e) { toast.error(formatApiError(e)); }
  };
  const running = (f) => batch?.status === "executando" && batch.firmware_id === f.id;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-3 border-b border-border font-display text-sm uppercase tracking-widest">Versões · {modelo} ({fws.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-left"><tr>
            <th className="p-2">Versão</th><th className="p-2">Data</th><th className="p-2">Tamanho</th><th className="p-2">MD5</th>
            <th className="p-2">Notas</th><th className="p-2">Controladoras</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {fws.map((f) => (
              <tr key={f.id} className="border-t border-border/60" data-testid={`fw-row-${f.modelo}-${f.versao}`}>
                <td className="p-2 font-mono font-bold text-sky-400 whitespace-nowrap">
                  v{f.versao}
                  {f.mais_recente && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300" data-testid={`fw-latest-${f.modelo}`}>MAIS RECENTE</span>}
                  {!f.assinatura && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">sem assinatura</span>}
                </td>
                <td className="p-2 font-mono">{fmtDate(f.criado_em)}</td>
                <td className="p-2 font-mono">{(f.tamanho / 1024).toFixed(0)} KB</td>
                <td className="p-2 font-mono text-muted-foreground">
                  <span title={f.md5} data-testid={`fw-md5-${f.modelo}-${f.versao}`}>{f.md5.slice(0, 8)}…</span>
                  <button className="ml-1 align-middle hover:text-foreground" onClick={() => { navigator.clipboard.writeText(f.md5); toast.success("MD5 copiado"); }} data-testid={`fw-md5-copy-${f.versao}`}><Copy className="w-3 h-3 inline" /></button>
                </td>
                <td className="p-2">{f.notas || "—"}</td>
                <td className="p-2 font-mono">{f.n_controladoras}</td>
                <td className="p-2">
                  <Button size="sm" variant="outline" disabled={f.mais_recente || running(f)} title={f.mais_recente ? "Não é possível excluir a versão mais recente" : ""} onClick={() => del(f)} data-testid={`fw-delete-${f.modelo}-${f.versao}`}><Trash2 className="w-3 h-3" /></Button>
                </td>
              </tr>
            ))}
            {!fws.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhuma versão deste modelo.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------- Controladoras ----------
function ControllersTable({ ctrls, latest, items, sel, setSel }) {
  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left"><tr>
          <th className="p-2"></th><th className="p-2">Identificação</th><th className="p-2">device_id</th><th className="p-2">Modelo</th><th className="p-2">Versão</th>
          <th className="p-2">Conexão</th><th className="p-2">RSSI</th><th className="p-2">Uptime</th><th className="p-2">Último RESET</th><th className="p-2">OTA</th>
        </tr></thead>
        <tbody>
          {ctrls.map((c) => {
            const item = items[c.device_id];
            const vColor = !c.versao ? "text-muted-foreground" : latest && c.versao === latest ? "text-emerald-400" : latest ? "text-amber-400" : "text-sky-400";
            return (
              <tr key={c.device_id} className="border-t border-border/60" data-testid={`fw-ctrl-row-${c.device_id}`}>
                <td className="p-2"><Checkbox checked={sel.has(c.device_id)} onCheckedChange={() => toggle(c.device_id)} data-testid={`fw-select-${c.device_id}`} /></td>
                <td className="p-2 font-bold">{c.identificacao || <span className="text-muted-foreground font-normal">não cadastrado</span>}</td>
                <td className="p-2 font-mono">{c.device_id}</td>
                <td className="p-2 font-mono">{c.modelo || <span className="text-amber-300">não informado</span>}</td>
                <td className={`p-2 font-mono ${vColor}`} data-testid={`fw-version-${c.device_id}`}>{c.versao ? `v${c.versao}` : "—"}</td>
                <td className="p-2">{c.online ? <span className="text-emerald-400">online</span> : <span className="text-slate-500">offline</span>}</td>
                <td className={`p-2 font-mono ${rssiColor(c.rssi)}`} data-testid={`fw-rssi-${c.device_id}`}>{c.rssi != null ? `${c.rssi} dBm` : "—"}</td>
                <td className="p-2 font-mono">{fmtUptime(c.uptime_min)}</td>
                <td className="p-2 font-mono max-w-[200px] truncate" title={c.reset_reason || ""}>{c.reset_reason || "—"}</td>
                <td className={`p-2 font-mono ${otaStyle[item?.status] || "text-muted-foreground"}`} data-testid={`fw-ota-${c.device_id}`}>
                  {otaLabel(item, c.ota_state)}
                  {/url n[aã]o permitida/i.test(`${c.ota_state || ""} ${item?.msg || ""}`) && (
                    <div className="text-[10px] text-amber-300 font-sans mt-0.5" data-testid={`fw-url-hint-${c.device_id}`}>
                      A controladora não aceita este endereço — confira o endereço base dos firmwares
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {!ctrls.length && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Nenhuma controladora neste grupo.</td></tr>}
        </tbody>
      </table>
    </div>
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
        <b className="uppercase">Lote {batch.modelo} v{batch.versao} — {batch.status}</b> · {done}/{batch.items.length} ok
        {batch.message && <div className="text-xs mt-1">{batch.message}</div>}
        {batch.skipped?.length > 0 && <div className="text-xs mt-1 opacity-80">Ignoradas: {batch.skipped.map((s) => `${s.device_id} (${s.motivo})`).join(", ")}</div>}
      </div>
      {batch.status === "executando" && <Button size="sm" variant="outline" onClick={onCancel} data-testid="ota-cancel-btn"><Square className="w-3 h-3 mr-1" /> Parar lote</Button>}
    </Card>
  );
}

function GroupPanel({ sel, tree, batch, onNewModel }) {
  const refresh = useInvalidateAll();
  const [picked, setPicked] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const params = sel.modelo ? { modelo: sel.modelo } : { grupo: sel.grupo };
  const { data: ctrls = [] } = useQuery({ queryKey: ["fw-ctrls", params], queryFn: async () => (await api.get("/admin/firmware/controladoras", { params })).data, refetchInterval: 3000 });
  const { data: fws = [] } = useQuery({ queryKey: ["firmwares", sel.modelo], queryFn: async () => (await api.get("/admin/firmware", { params: { modelo: sel.modelo } })).data, enabled: !!sel.modelo });
  const latestFw = fws.find((f) => f.mais_recente);
  const items = Object.fromEntries((batch?.items || []).map((i) => [i.device_id, i]));
  const outdated = latestFw ? ctrls.filter((c) => c.online && c.versao !== latestFw.versao) : [];
  const model = tree?.categorias.flatMap((c) => c.modelos).find((m) => m.modelo === sel.modelo);
  const sendOutdated = async () => {
    try {
      const r = await api.post(`/admin/firmware/${latestFw.id}/enviar`, { device_ids: outdated.map((c) => c.device_id) });
      toast.success(`Lote iniciado: ${r.data.items.length} controladora(s)`);
      refresh();
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const title = sel.modelo ? `${sel.modelo} · ${model?.nome || ""}` : sel.grupo === "sem_modelo" ? "Modelo não informado" : "Modelos não catalogados";
  return (
    <div className="space-y-4">
      {sel.modelo && <VersionsTable modelo={sel.modelo} batch={batch} />}
      {sel.grupo === "nao_catalogado" && tree?.nao_catalogados.map((n) => (
        <Card key={n.modelo} className="p-3 flex items-center gap-3 text-sm border-amber-500/30" data-testid={`fw-uncat-${n.modelo}`}>
          <PackageX className="w-4 h-4 text-amber-400" />
          <span className="font-mono font-bold">{n.modelo}</span><span className="text-muted-foreground">{n.n_controladoras} controladora(s) · {CAT_LABEL[n.categoria]}</span>
          <Button size="sm" className="ml-auto gap-1" onClick={() => onNewModel({ modelo: n.modelo, categoria: n.categoria })} data-testid={`fw-uncat-register-${n.modelo}`}><Plus className="w-3 h-3" /> cadastrar</Button>
        </Card>
      ))}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="font-display text-sm uppercase tracking-widest flex items-center gap-2 mr-auto"><Cpu className="w-4 h-4 text-sky-400" /> {title} — controladoras ({ctrls.length})</div>
          <FirmwareUpdateDialog deviceIds={[...picked]} modelo={sel.modelo || null} label={`Atualizar selecionadas (${picked.size})`} onSent={() => { setPicked(new Set()); refresh(); }} testid="fw-update-selected-btn" />
          {sel.modelo && (
            <Button size="sm" disabled={!outdated.length || batch?.status === "executando"} onClick={() => setConfirmOpen(true)} data-testid="fw-update-outdated-btn">
              Atualizar desatualizadas ({outdated.length})
            </Button>
          )}
        </div>
        <div className="px-3 py-2 text-xs bg-amber-500/10 text-amber-300 border-b border-amber-500/30 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Recomendação: atualize primeiro UMA controladora de teste. O lote é escalonado (uma por vez) e pausa na primeira falha. Só versões do mesmo modelo podem ser enviadas.
        </div>
        <ControllersTable ctrls={ctrls} latest={latestFw?.versao} items={items} sel={picked} setSel={setPicked} />
      </Card>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atualizar {outdated.length} controladora(s) {sel.modelo} para v{latestFw?.versao}?</AlertDialogTitle>
            <AlertDialogDescription>
              Somente as ONLINE e desatualizadas: {outdated.map((c) => c.identificacao || c.device_id).join(", ")}. O equipamento continua operando; a controladora reinicia ao final. Envio uma por vez — pausa se alguma falhar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={sendOutdated} data-testid="fw-confirm-outdated">Atualizar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function FirmwareTab() {
  const qc = useQueryClient();
  const [sel, setSel] = useState({ modelo: "FC300" });
  const [modelDlg, setModelDlg] = useState({ open: false, initial: null });
  const { data: tree } = useQuery({ queryKey: ["fw-tree"], queryFn: async () => (await api.get("/admin/firmware/arvore")).data, refetchInterval: 10000 });
  const { data: models = [] } = useQuery({ queryKey: ["controller-models"], queryFn: async () => (await api.get("/admin/controller-models")).data });
  const { data: batch } = useQuery({ queryKey: ["fw-batch"], queryFn: async () => (await api.get("/admin/firmware/lote")).data, refetchInterval: 2000 });
  const { data: cfg } = useQuery({ queryKey: ["fw-config"], queryFn: async () => (await api.get("/admin/firmware/config")).data });
  const cancel = async () => { await api.post("/admin/firmware/lote/cancelar"); qc.invalidateQueries({ queryKey: ["fw-batch"] }); };
  const newModel = (initial) => setModelDlg({ open: true, initial });
  return (
    <div className="space-y-4" data-testid="firmware-tab">
      <div className="text-xs font-mono text-muted-foreground" data-testid="fw-base-url">
        Endereço dos arquivos: <span className="text-sky-300">{cfg?.base_url || "…"}</span>
        {cfg && !cfg.personalizado && <span className="ml-2 text-amber-300">(padrão — defina FIRMWARE_PUBLIC_BASE para usar outro endereço)</span>}
      </div>
      <UploadCard models={models} onNewModel={newModel} />
      <BatchBanner batch={batch} onCancel={cancel} />
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <FirmwareTree tree={tree} sel={sel} setSel={setSel} />
        <GroupPanel key={sel.modelo || sel.grupo} sel={sel} tree={tree} batch={batch} onNewModel={newModel} />
      </div>
      <ModelFormDialog open={modelDlg.open} onOpenChange={(o) => setModelDlg((p) => ({ ...p, open: o }))} initial={modelDlg.initial} editing={false} />
    </div>
  );
}
