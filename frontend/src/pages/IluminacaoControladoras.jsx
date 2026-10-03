import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { toast } from "sonner";
import { ArrowLeft, Settings2, Plus, Trash2, Wifi, WifiOff, Power, PowerOff, Pencil, Save } from "lucide-react";

export default function IluminacaoControladoras() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ mqtt_id: "", nome: "", local: "" });
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [circRename, setCircRename] = useState({ open: false, numero: 1, nome_circuito: "" });

  const { data: controladoras = [] } = useQuery({ queryKey: ["lighting-controladoras"], queryFn: async () => (await api.get("/lighting/controladoras")).data, refetchInterval: 5000 });
  const { data: descobertas = [] } = useQuery({ queryKey: ["lighting-descobertas"], queryFn: async () => (await api.get("/lighting/controladoras/descobertas")).data, refetchInterval: 5000 });

  const create = async () => {
    try {
      await api.post("/lighting/controladoras", form);
      toast.success("Controladora cadastrada");
      setForm({ mqtt_id: "", nome: "", local: "" });
      qc.invalidateQueries({ queryKey: ["lighting-controladoras"] });
      qc.invalidateQueries({ queryKey: ["lighting-descobertas"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const cadastrarDescoberta = async (mqtt_id) => {
    const nome = window.prompt(`Nome para controladora ${mqtt_id}:`, `Quadro ${mqtt_id}`);
    if (!nome) return;
    try {
      await api.post("/lighting/controladoras", { mqtt_id, nome, local: "" });
      toast.success("Cadastrada");
      qc.invalidateQueries({ queryKey: ["lighting-controladoras"] });
      qc.invalidateQueries({ queryKey: ["lighting-descobertas"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const deleteCtrl = async (c) => {
    try {
      await api.delete(`/lighting/controladoras/${c.id}`);
      toast.success("Removida");
      qc.invalidateQueries({ queryKey: ["lighting-controladoras"] });
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (typeof d === "object" && d?.pontos) {
        toast.error(`${d.msg} ${d.pontos.map((p) => p.nome).join(", ")}`);
      } else toast.error(formatApiError(e));
    }
  };

  const saveEdit = async () => {
    try {
      await api.patch(`/lighting/controladoras/${editing.id}`, { nome: editing.nome, local: editing.local });
      toast.success("Atualizada");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["lighting-controladoras"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const commandAll = async (ctrl, on) => {
    try {
      await api.post(`/lighting/controladoras/${ctrl.id}/todos?on=${on}`);
      toast.success(`${on ? "Ligar" : "Desligar"} todos enviado`);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const saveCircName = async () => {
    try {
      await api.patch(`/lighting/controladoras/${selected.id}/circuitos`, { numero: circRename.numero, nome_circuito: circRename.nome_circuito });
      toast.success("Nome do circuito salvo");
      setCircRename({ ...circRename, open: false });
      qc.invalidateQueries({ queryKey: ["lighting-controladoras"] });
      const updated = (await api.get("/lighting/controladoras")).data.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="controladoras-page">
      <div className="flex items-center gap-3">
        <Link to="/iluminacao" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="back-to-iluminacao">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <h1 className="font-display text-3xl font-black uppercase flex items-center gap-2"><Settings2 className="w-7 h-7 text-sky-400" />Controladoras</h1>
      </div>

      {descobertas.length > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5" data-testid="descobertas-card">
          <div className="font-display text-sm uppercase tracking-widest text-amber-400 mb-2">Novas controladoras encontradas ({descobertas.length})</div>
          <div className="space-y-1">
            {descobertas.map((d) => (
              <div key={d.mqtt_id} className="flex items-center gap-3 text-sm font-mono" data-testid={`descoberta-${d.mqtt_id}`}>
                <span className="font-bold">{d.mqtt_id}</span>
                <span className={d.online ? "text-emerald-400" : "text-rose-400"}>{d.online ? "online" : "offline"}</span>
                <span className="text-muted-foreground text-xs">{d.rede}</span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => cadastrarDescoberta(d.mqtt_id)} data-testid={`btn-cadastrar-${d.mqtt_id}`}>Cadastrar</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="font-display text-sm uppercase tracking-widest mb-3">Nova controladora manualmente</div>
        <div className="grid grid-cols-1 md:grid-cols-[150px_1fr_1fr_auto] gap-2 items-end">
          <div><Label className="text-[10px]">ID MQTT (4 hex)</Label><Input value={form.mqtt_id} onChange={(e) => setForm({ ...form, mqtt_id: e.target.value.toUpperCase().slice(0, 4) })} placeholder="A1F3" data-testid="input-ctrl-id" /></div>
          <div><Label className="text-[10px]">Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Quadro QL-1" data-testid="input-ctrl-nome" /></div>
          <div><Label className="text-[10px]">Local</Label><Input value={form.local} onChange={(e) => setForm({ ...form, local: e.target.value })} placeholder="Casa de máquinas" data-testid="input-ctrl-local" /></div>
          <Button onClick={create} data-testid="btn-add-ctrl"><Plus className="w-4 h-4 mr-1" />Adicionar</Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border font-display text-sm uppercase tracking-widest">Cadastradas ({controladoras.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr>
              <th className="p-2">ID MQTT</th><th className="p-2">Nome</th><th className="p-2">Local</th><th className="p-2">Status</th><th className="p-2">Rede</th><th className="p-2">Ligados</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {controladoras.map((c) => {
              const ligados = c.circuitos.filter((x) => x.estado === true).length;
              return (
                <tr key={c.id} className="border-t border-border/60 hover:bg-accent/5" data-testid={`ctrl-row-${c.id}`}>
                  <td className="p-2 font-mono font-bold">{c.mqtt_id}</td>
                  <td className="p-2">{c.nome}</td>
                  <td className="p-2 text-muted-foreground">{c.local}</td>
                  <td className="p-2">{c.online ? <span className="flex items-center gap-1 text-emerald-400 text-xs"><Wifi className="w-3 h-3" />online</span> : <span className="flex items-center gap-1 text-rose-400 text-xs"><WifiOff className="w-3 h-3" />offline</span>}</td>
                  <td className="p-2 font-mono text-xs">{c.rede || "—"}</td>
                  <td className="p-2 font-mono">{ligados}/16</td>
                  <td className="p-2 flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setSelected(c)} data-testid={`btn-ver-${c.id}`}>Ver circuitos</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c })} data-testid={`btn-edit-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="sm" variant="ghost" data-testid={`btn-del-${c.id}`}><Trash2 className="w-4 h-4 text-rose-400" /></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>Excluir {c.nome}?</AlertDialogTitle><AlertDialogDescription>Falha se houver pontos vinculados.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteCtrl(c)}>Excluir</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              );
            })}
            {controladoras.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nenhuma controladora</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* Detalhe de controladora */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{selected?.nome} — Circuitos</DialogTitle></DialogHeader>
          {selected && (
            <>
              <div className="flex gap-2 mb-3">
                <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={() => commandAll(selected, true)} data-testid="btn-all-on"><Power className="w-4 h-4 mr-1" />Ligar todos</Button>
                <Button className="bg-rose-600 hover:bg-rose-500" onClick={() => commandAll(selected, false)} data-testid="btn-all-off"><PowerOff className="w-4 h-4 mr-1" />Desligar todos</Button>
              </div>
              <div className="grid grid-cols-4 gap-2" data-testid="circuits-grid">
                {selected.circuitos.map((c) => (
                  <div key={c.numero} className={`border rounded p-2 ${c.estado === true ? "border-amber-500/60 bg-amber-500/10" : "border-border"}`}>
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs">L{String(c.numero).padStart(2, "0")}</div>
                      <button onClick={() => setCircRename({ open: true, numero: c.numero, nome_circuito: c.nome_circuito })} data-testid={`rename-circ-${c.numero}`}><Pencil className="w-3 h-3" /></button>
                    </div>
                    <div className="text-xs font-bold truncate">{c.nome_circuito}</div>
                    <div className="flex items-center gap-1 text-[10px] font-mono mt-1">
                      <span className={c.estado === true ? "text-amber-400" : "text-slate-400"}>●</span>
                      {c.estado === true ? "ACESO" : c.estado === false ? "APAGADO" : "—"}
                      {c.modo === true && <span className="ml-auto bg-sky-500/20 text-sky-300 px-1 rounded">A</span>}
                    </div>
                    {c.last_input && <div className="text-[9px] text-muted-foreground font-mono truncate">Xnn: {new Date(c.last_input).toLocaleTimeString("pt-BR")}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={circRename.open} onOpenChange={(o) => setCircRename({ ...circRename, open: o })}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renomear circuito L{String(circRename.numero).padStart(2, "0")}</DialogTitle></DialogHeader>
          <Input value={circRename.nome_circuito} onChange={(e) => setCircRename({ ...circRename, nome_circuito: e.target.value })} data-testid="input-circ-nome" />
          <DialogFooter><Button variant="outline" onClick={() => setCircRename({ ...circRename, open: false })}>Cancelar</Button><Button onClick={saveCircName} data-testid="btn-save-circ"><Save className="w-4 h-4 mr-1" />Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar controladora</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={editing.nome} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} /></div>
              <div><Label>Local</Label><Input value={editing.local} onChange={(e) => setEditing({ ...editing, local: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button onClick={saveEdit}><Save className="w-4 h-4 mr-1" />Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
