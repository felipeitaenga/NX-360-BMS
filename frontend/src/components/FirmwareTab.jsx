import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { toast } from "sonner";
import { Upload, Trash2, Cpu, AlertTriangle, Square, Copy, HelpCircle, PackageX, Plus, Search } from "lucide-react";
import { rssiColor, fmtUptime, fmtDate, inspectFirmwareFile, otaLabel, otaStyle, CAT_LABEL } from "./firmware/fwUtils";
import { FirmwareUpdateDialog } from "./firmware/FirmwareUpdateDialog";
import { ModelFormDialog } from "./firmware/ControllerModels";
import { OtaWarnings, downgrades } from "./firmware/OtaWarnings";

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

// ---------- Coluna da esquerda: só modelos ----------
function ListItem({ active, onClick, children, testid }) {
  return (
    <button onClick={onClick} data-testid={testid}
      className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors border ${active ? "bg-sky-500/15 text-sky-100 border-sky-500/40" : "hover:bg-muted/40 border-transparent"}`}>
      {children}
    </button>
  );
}

function ModelList({ tree, sel, setSel }) {
  const [q, setQ] = useState("");
  if (!tree) return null;
  const modelos = tree.modelos.filter((m) => !q || `${m.modelo} ${m.nome}`.toLowerCase().includes(q.toLowerCase()));
  const extras = tree.sem_modelo > 0 || tree.nao_catalogados.length > 0;
  return (
    <Card className="p-3 space-y-1 h-fit" data-testid="fw-tree">
      {tree.modelos.length > 6 && (
        <div className="relative mb-2">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo…" className="h-8 pl-7 text-xs" data-testid="fw-model-search" />
        </div>
      )}
      {modelos.map((m) => (
        <ListItem key={m.modelo} active={sel.modelo === m.modelo} onClick={() => setSel({ modelo: m.modelo })} testid={`fw-tree-model-${m.modelo}`}>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm">{m.modelo}</span>
            <span className="ml-auto text-[9px] lowercase px-1.5 py-0.5 rounded border border-border text-muted-foreground">{m.categoria_label}</span>
          </div>
          <div className="text-muted-foreground mt-0.5">{m.n_controladoras} controladora(s) · {m.n_versoes} versão(ões)</div>
          {m.n_desatualizadas > 0 && (
            <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300" data-testid={`fw-tree-outdated-${m.modelo}`}>{m.n_desatualizadas} desatualizada(s)</span>
          )}
        </ListItem>
      ))}
      {!modelos.length && <div className="text-xs text-muted-foreground px-3 py-2">Nenhum modelo com controladoras ou versões.</div>}
      {extras && (
        <div className="border-t border-border pt-2 mt-2 space-y-1">
          {tree.sem_modelo > 0 && (
            <ListItem active={sel.grupo === "sem_modelo"} onClick={() => setSel({ grupo: "sem_modelo" })} testid="fw-tree-sem-modelo">
              <div className="flex items-center gap-1 font-bold"><HelpCircle className="w-3 h-3" /> Modelo não informado</div>
              <div className="text-muted-foreground">{tree.sem_modelo} controladora(s)</div>
            </ListItem>
          )}
          {tree.nao_catalogados.length > 0 && (
            <ListItem active={sel.grupo === "nao_catalogado"} onClick={() => setSel({ grupo: "nao_catalogado" })} testid="fw-tree-nao-catalogado">
              <div className="flex items-center gap-1 font-bold"><PackageX className="w-3 h-3" /> Modelos não catalogados</div>
              <div className="text-muted-foreground">{tree.nao_catalogados.map((n) => n.modelo).join(", ")}</div>
            </ListItem>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Versões do modelo (com escolha da versão a enviar) ----------
function VersionsTable({ modelo, fws, chosenId, setChosenId, batch }) {
  const refresh = useInvalidateAll();
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
            <th className="p-2 w-24">Enviar esta</th><th className="p-2">Versão</th><th className="p-2">Data</th><th className="p-2">Tamanho</th><th className="p-2">MD5</th>
            <th className="p-2">Notas</th><th className="p-2">Controladoras</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {fws.map((f) => (
              <tr key={f.id} className={`border-t border-border/60 ${chosenId === f.id ? "bg-sky-500/5" : ""}`} data-testid={`fw-row-${f.modelo}-${f.versao}`}>
                <td className="p-2 text-center">
                  <input type="radio" name={`fw-choose-${modelo}`} checked={chosenId === f.id} onChange={() => setChosenId(f.id)} className="accent-sky-500 w-4 h-4 cursor-pointer" data-testid={`fw-choose-${f.versao}`} />
                </td>
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
            {!fws.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Nenhuma versão deste modelo.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------- Controladoras ----------
const fmtCurto = (s) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null);

// Data/hora da última troca de versão + histórico (popover)
function UpdatedCell({ c }) {
  const [open, setOpen] = useState(false);
  const { data: hist, isLoading } = useQuery({
    queryKey: ["fw-updates", c.device_id], enabled: open,
    queryFn: async () => (await api.get(`/admin/controllers/${encodeURIComponent(c.device_id)}/firmware-updates`)).data,
  });
  if (!c.fw_updated_at) return <span className="text-muted-foreground">—</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="text-left hover:underline" data-testid={`fw-updated-${c.device_id}`}>
          <div>{fmtCurto(c.fw_updated_at)}</div>
          {c.fw_prev_version && <div className="text-[10px] text-muted-foreground">{c.fw_prev_version} → {c.versao}</div>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 text-xs">
        <div className="font-bold mb-2">Histórico de firmware — {c.identificacao || c.device_id}</div>
        {isLoading ? <div className="text-muted-foreground">Carregando…</div> : !hist?.length ? <div className="text-muted-foreground">Sem registros.</div> : (
          <table className="w-full font-mono">
            <tbody>
              {hist.map((h, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1 pr-2">{fmtCurto(h.em)}</td>
                  <td className="py-1 pr-2">{h.de} → {h.para}</td>
                  <td className={`py-1 ${h.origem === "OTA" ? "text-sky-400" : "text-muted-foreground"}`}>{h.origem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ControllersTable({ ctrls, target, items, sel, setSel }) {
  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left"><tr>
          <th className="p-2"></th><th className="p-2">Identificação</th><th className="p-2">device_id</th><th className="p-2">Modelo</th><th className="p-2">Versão</th>
          <th className="p-2">Conexão</th><th className="p-2">RSSI</th><th className="p-2">Atualizado em</th><th className="p-2">Último reinício</th><th className="p-2">OTA</th>
        </tr></thead>
        <tbody>
          {ctrls.map((c) => {
            const item = items[c.device_id];
            const same = target && c.versao === target;
            const vColor = !c.versao ? "text-muted-foreground" : !target ? "text-sky-400" : same ? "text-emerald-400" : "text-amber-400";
            return (
              <tr key={c.device_id} className="border-t border-border/60" data-testid={`fw-ctrl-row-${c.device_id}`}>
                <td className="p-2" title={same ? "já está nesta versão" : ""}>
                  <Checkbox checked={sel.has(c.device_id)} disabled={same} onCheckedChange={() => toggle(c.device_id)} data-testid={`fw-select-${c.device_id}`} />
                </td>
                <td className="p-2 font-bold">{c.identificacao || <span className="text-muted-foreground font-normal">não cadastrado</span>}</td>
                <td className="p-2 font-mono">{c.device_id}</td>
                <td className="p-2 font-mono">{c.modelo || <span className="text-amber-300">não informado</span>}</td>
                <td className={`p-2 font-mono ${vColor}`} data-testid={`fw-version-${c.device_id}`}>{c.versao ? `v${c.versao}` : "—"}</td>
                <td className="p-2">{c.online ? <span className="text-emerald-400">online</span> : <span className="text-slate-500">offline</span>}</td>
                <td className={`p-2 font-mono ${rssiColor(c.rssi)}`} data-testid={`fw-rssi-${c.device_id}`}>{c.rssi != null ? `${c.rssi} dBm` : "—"}</td>
                <td className="p-2 font-mono whitespace-nowrap"><UpdatedCell c={c} /></td>
                <td className="p-2 font-mono max-w-[220px] truncate" data-testid={`fw-boot-${c.device_id}`}
                  title={[c.uptime_min != null && `Ligada há ${fmtUptime(c.uptime_min)}`, c.reset_reason && `Motivo: ${c.reset_reason}`].filter(Boolean).join(" · ")}>
                  {fmtCurto(c.last_boot_at) || "—"}{c.reset_reason && <span className="text-muted-foreground"> · {c.reset_reason}</span>}
                </td>
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

// ---------- Confirmação do envio da versão escolhida ----------
function SendConfirm({ open, setOpen, fw, targets, onDone }) {
  const [downOk, setDownOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setDownOk(false); }, [open]);
  const needDown = downgrades(fw, targets).length > 0;
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/admin/firmware/${fw.id}/enviar`, { device_ids: targets.map((t) => t.device_id) });
      toast.success(`Lote v${fw.versao} iniciado: ${r.data.items.length} controladora(s)`);
      setOpen(false);
      onDone();
    } catch (e) { toast.error(formatApiError(e)); }
    setBusy(false);
  };
  if (!fw) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="fw-send-confirm">
        <DialogHeader>
          <DialogTitle>Enviar {fw.modelo} v{fw.versao} para {targets.length} controladora(s)?</DialogTitle>
          <DialogDescription>
            {targets.map((t) => `${t.identificacao || t.device_id} (v${t.versao || "?"})`).join(", ")}. O equipamento continua operando; a controladora reinicia ao final. Envio uma por vez — pausa se alguma falhar.
          </DialogDescription>
        </DialogHeader>
        <OtaWarnings fw={fw} targets={targets} confirmed={downOk} setConfirmed={setDownOk} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={busy || (needDown && !downOk)} onClick={send} data-testid="fw-send-confirm-btn">Atualizar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelPanel({ modelo, tree, batch }) {
  const refresh = useInvalidateAll();
  const [picked, setPicked] = useState(new Set());
  const [chosenId, setChosenId] = useState("");
  const [confirm, setConfirm] = useState(null);
  const { data: ctrls = [] } = useQuery({ queryKey: ["fw-ctrls", { modelo }], queryFn: async () => (await api.get("/admin/firmware/controladoras", { params: { modelo } })).data, refetchInterval: 3000 });
  const { data: fws = [] } = useQuery({ queryKey: ["firmwares", modelo], queryFn: async () => (await api.get("/admin/firmware", { params: { modelo } })).data });
  useEffect(() => {
    if (!fws.find((f) => f.id === chosenId) && fws.length) setChosenId((fws.find((f) => f.mais_recente) || fws[0]).id);
  }, [fws, chosenId]);
  const fw = fws.find((f) => f.id === chosenId);
  useEffect(() => {
    setPicked((p) => new Set([...p].filter((id) => ctrls.find((c) => c.device_id === id)?.versao !== fw?.versao)));
  }, [fw, ctrls]);
  const items = Object.fromEntries((batch?.items || []).map((i) => [i.device_id, i]));
  const allTargets = fw ? ctrls.filter((c) => c.online && c.versao !== fw.versao) : [];
  const pickedTargets = ctrls.filter((c) => picked.has(c.device_id));
  const model = tree?.modelos.find((m) => m.modelo === modelo);
  const busyBatch = batch?.status === "executando";
  return (
    <div className="space-y-4">
      <VersionsTable modelo={modelo} fws={fws} chosenId={chosenId} setChosenId={setChosenId} batch={batch} />
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="font-display text-sm uppercase tracking-widest flex items-center gap-2"><Cpu className="w-4 h-4 text-sky-400" /> {modelo} · {model?.nome || ""} — controladoras ({ctrls.length})</div>
          {fw && (
            <div className="mr-auto ml-3 text-sm font-mono px-2 py-1 rounded border border-sky-500/40 bg-sky-500/10" data-testid="fw-chosen-version">
              Versão a enviar: <b className="text-sky-300">v{fw.versao}</b> <span className={fw.mais_recente ? "text-emerald-300" : "text-amber-300"}>({fw.mais_recente ? "mais recente" : "anterior"})</span>
            </div>
          )}
          <Button size="sm" variant="outline" disabled={!fw || !picked.size || busyBatch} onClick={() => setConfirm(pickedTargets)} data-testid="fw-update-selected-btn">
            Atualizar selecionadas ({picked.size})
          </Button>
          <Button size="sm" disabled={!fw || !allTargets.length || busyBatch} onClick={() => setConfirm(allTargets)} data-testid="fw-update-all-btn">
            Atualizar todas para v{fw?.versao || "—"} ({allTargets.length})
          </Button>
        </div>
        <div className="px-3 py-2 text-xs bg-amber-500/10 text-amber-300 border-b border-amber-500/30 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Recomendação: atualize primeiro UMA controladora de teste. O lote é escalonado (uma por vez) e pausa na primeira falha. Só versões do mesmo modelo podem ser enviadas.
        </div>
        <ControllersTable ctrls={ctrls} target={fw?.versao} items={items} sel={picked} setSel={setPicked} />
      </Card>
      <SendConfirm open={!!confirm} setOpen={(o) => !o && setConfirm(null)} fw={fw} targets={confirm || []} onDone={() => { setPicked(new Set()); refresh(); }} />
    </div>
  );
}

function GroupPanel({ grupo, tree, batch, onNewModel }) {
  const refresh = useInvalidateAll();
  const [picked, setPicked] = useState(new Set());
  const { data: ctrls = [] } = useQuery({ queryKey: ["fw-ctrls", { grupo }], queryFn: async () => (await api.get("/admin/firmware/controladoras", { params: { grupo } })).data, refetchInterval: 3000 });
  const items = Object.fromEntries((batch?.items || []).map((i) => [i.device_id, i]));
  const targets = ctrls.filter((c) => picked.has(c.device_id));
  return (
    <div className="space-y-4">
      {grupo === "nao_catalogado" && tree?.nao_catalogados.map((n) => (
        <Card key={n.modelo} className="p-3 flex items-center gap-3 text-sm border-amber-500/30" data-testid={`fw-uncat-${n.modelo}`}>
          <PackageX className="w-4 h-4 text-amber-400" />
          <span className="font-mono font-bold">{n.modelo}</span><span className="text-muted-foreground">{n.n_controladoras} controladora(s) · {CAT_LABEL[n.categoria]}</span>
          <Button size="sm" className="ml-auto gap-1" onClick={() => onNewModel({ modelo: n.modelo, categoria: n.categoria })} data-testid={`fw-uncat-register-${n.modelo}`}><Plus className="w-3 h-3" /> cadastrar</Button>
        </Card>
      ))}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border flex flex-wrap items-center gap-2">
          <div className="font-display text-sm uppercase tracking-widest flex items-center gap-2 mr-auto">
            <Cpu className="w-4 h-4 text-sky-400" /> {grupo === "sem_modelo" ? "Modelo não informado" : "Modelos não catalogados"} — controladoras ({ctrls.length})
          </div>
          {grupo === "sem_modelo" && (
            <FirmwareUpdateDialog targets={targets} modelo={null} label={`Atualizar selecionadas (${picked.size})`} onSent={() => { setPicked(new Set()); refresh(); }} testid="fw-update-selected-btn" />
          )}
        </div>
        <ControllersTable ctrls={ctrls} target={null} items={items} sel={picked} setSel={setPicked} />
      </Card>
    </div>
  );
}

export function FirmwareTab() {
  const qc = useQueryClient();
  const [sel, setSel] = useState(null);
  const [modelDlg, setModelDlg] = useState({ open: false, initial: null });
  const { data: tree } = useQuery({ queryKey: ["fw-tree"], queryFn: async () => (await api.get("/admin/firmware/arvore")).data, refetchInterval: 10000 });
  const { data: models = [] } = useQuery({ queryKey: ["controller-models"], queryFn: async () => (await api.get("/admin/controller-models")).data });
  const { data: batch } = useQuery({ queryKey: ["fw-batch"], queryFn: async () => (await api.get("/admin/firmware/lote")).data, refetchInterval: 2000 });
  const { data: cfg } = useQuery({ queryKey: ["fw-config"], queryFn: async () => (await api.get("/admin/firmware/config")).data });
  const effectiveSel = useMemo(() => {
    if (sel) return sel;
    if (tree?.modelos.length) return { modelo: tree.modelos[0].modelo };
    if (tree?.sem_modelo) return { grupo: "sem_modelo" };
    return {};
  }, [sel, tree]);
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
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <ModelList tree={tree} sel={effectiveSel} setSel={setSel} />
        {effectiveSel.modelo && <ModelPanel key={effectiveSel.modelo} modelo={effectiveSel.modelo} tree={tree} batch={batch} />}
        {effectiveSel.grupo && <GroupPanel key={effectiveSel.grupo} grupo={effectiveSel.grupo} tree={tree} batch={batch} onNewModel={newModel} />}
      </div>
      <ModelFormDialog open={modelDlg.open} onOpenChange={(o) => setModelDlg((p) => ({ ...p, open: o }))} initial={modelDlg.initial} editing={false} />
    </div>
  );
}
