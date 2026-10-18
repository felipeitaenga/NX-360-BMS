import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../../lib/api";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { CAT_LABEL } from "./fwUtils";

const EMPTY = { modelo: "", categoria: "FANCOIL", nome: "", hardware: "", descricao: "", ativo: true };

export function ModelFormDialog({ open, onOpenChange, initial, editing }) {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (open) setF({ ...EMPTY, ...(initial || {}) });
  }, [open, initial]);
  const upd = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      if (editing) await api.put(`/admin/controller-models/${f.modelo}`, f);
      else await api.post("/admin/controller-models", f);
      toast.success(`Modelo ${f.modelo.toUpperCase()} salvo`);
      ["controller-models", "fw-tree", "fw-ctrls"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    } catch (e) { toast.error(formatApiError(e)); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="model-form-dialog">
        <DialogHeader><DialogTitle>{editing ? `Editar ${f.modelo}` : "Novo modelo de controladora"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Modelo</Label><Input value={f.modelo} disabled={editing} onChange={(e) => upd("modelo", e.target.value.toUpperCase())} placeholder="FC300" data-testid="model-code-input" /></div>
          <div>
            <Label>Categoria</Label>
            <Select value={f.categoria} onValueChange={(v) => upd("categoria", v)}>
              <SelectTrigger data-testid="model-category-select"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CAT_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>Nome amigável</Label><Input value={f.nome} onChange={(e) => upd("nome", e.target.value)} placeholder="Controladora de fancoil" data-testid="model-name-input" /></div>
          <div className="col-span-2"><Label>Hardware base</Label><Input value={f.hardware} onChange={(e) => upd("hardware", e.target.value)} placeholder="KinCony KC868-A4" data-testid="model-hw-input" /></div>
          <div className="col-span-2"><Label>Descrição</Label><Input value={f.descricao} onChange={(e) => upd("descricao", e.target.value)} data-testid="model-desc-input" /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.ativo} onCheckedChange={(v) => upd("ativo", v)} data-testid="model-active-switch" /> Ativo</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={busy || !f.modelo} onClick={save} data-testid="model-save-btn">Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ControllerModelsTab() {
  const [dlg, setDlg] = useState({ open: false, initial: null, editing: false });
  const { data: models = [] } = useQuery({ queryKey: ["controller-models"], queryFn: async () => (await api.get("/admin/controller-models")).data });
  return (
    <Card className="p-0 overflow-hidden" data-testid="controller-models-tab">
      <div className="p-3 border-b border-border flex items-center">
        <div className="font-display text-sm uppercase tracking-widest mr-auto">Modelos de controladora ({models.length})</div>
        <Button size="sm" className="gap-1" onClick={() => setDlg({ open: true, initial: null, editing: false })} data-testid="model-new-btn"><Plus className="w-4 h-4" /> Novo modelo</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs"><tr>
            <th className="p-2">Modelo</th><th className="p-2">Categoria</th><th className="p-2">Nome</th><th className="p-2">Hardware base</th><th className="p-2">Descrição</th><th className="p-2">Ativo</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.modelo} className="border-t border-border/60" data-testid={`model-row-${m.modelo}`}>
                <td className="p-2 font-mono font-bold text-sky-400">{m.modelo}</td>
                <td className="p-2">{CAT_LABEL[m.categoria] || m.categoria}</td>
                <td className="p-2">{m.nome || "—"}</td>
                <td className="p-2 font-mono text-xs">{m.hardware || "—"}</td>
                <td className="p-2 text-xs text-muted-foreground">{m.descricao || "—"}</td>
                <td className="p-2">{m.ativo ? <span className="text-emerald-400">sim</span> : <span className="text-muted-foreground">não</span>}</td>
                <td className="p-2"><Button size="sm" variant="outline" onClick={() => setDlg({ open: true, initial: m, editing: true })} data-testid={`model-edit-${m.modelo}`}><Pencil className="w-3 h-3" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ModelFormDialog open={dlg.open} onOpenChange={(o) => setDlg((p) => ({ ...p, open: o }))} initial={dlg.initial} editing={dlg.editing} />
    </Card>
  );
}
