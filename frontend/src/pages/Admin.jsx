import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API, formatApiError } from "../lib/api";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import { Checkbox } from "../components/ui/checkbox";
import { toast } from "sonner";
import { UserPlus, Trash2, KeyRound, Upload, RefreshCw, Settings as SettingsIcon, Pencil } from "lucide-react";

const MODULES = [
  { id: "home", label: "Início" },
  { id: "ar_condicionado", label: "Ar Condicionado" },
  { id: "iluminacao", label: "Iluminação" },
  { id: "hidraulica", label: "Hidráulica" },
  { id: "relatorios", label: "Relatórios" },
  { id: "alarmes", label: "Alarmes" },
];

function UsersTab() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: async () => (await api.get("/users")).data });
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "viewer", active: true });
  const [pwUser, setPwUser] = useState(null);
  const [pwValue, setPwValue] = useState("");
  const [permUser, setPermUser] = useState(null);

  const createUser = async () => {
    try {
      await api.post("/users", form);
      toast.success("Usuário criado");
      setForm({ name: "", email: "", password: "", role: "viewer", active: true });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const toggleActive = async (u) => {
    await api.patch(`/users/${u.id}`, { active: !u.active });
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const changeRole = async (u, role) => {
    await api.patch(`/users/${u.id}`, { role });
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const resetPassword = async () => {
    try {
      await api.post("/users/reset-password", { user_id: pwUser.id, new_password: pwValue });
      toast.success("Senha redefinida");
      setPwUser(null); setPwValue("");
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const removeUser = async (u) => {
    if (!window.confirm(`Remover ${u.email}?`)) return;
    await api.delete(`/users/${u.id}`);
    qc.invalidateQueries({ queryKey: ["users"] });
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h3 className="font-display text-sm uppercase tracking-widest mb-3">Novo usuário</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="new-user-name" />
          <Input placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="new-user-email" />
          <Input placeholder="Senha inicial" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="new-user-password" />
          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
            <SelectTrigger data-testid="new-user-role"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Administrador</SelectItem>
              <SelectItem value="operator">Operador</SelectItem>
              <SelectItem value="viewer">Visualizador</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={createUser} data-testid="create-user-button"><UserPlus className="w-4 h-4 mr-2" />Criar</Button>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40"><tr>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Nome</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">E-mail</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Perfil</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Ativo</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Último login</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Ações</th>
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                  <td className="px-3 py-2">
                    <Select value={u.role} onValueChange={(v) => changeRole(u, v)}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="operator">Operador</SelectItem>
                        <SelectItem value="viewer">Visualizador</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2"><Switch checked={u.active} onCheckedChange={() => toggleActive(u)} /></td>
                  <td className="px-3 py-2 text-xs font-mono">{u.last_login ? new Date(u.last_login).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td>
                  <td className="px-3 py-2 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setPwUser(u); setPwValue(""); }}><KeyRound className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setPermUser(u)} data-testid={`perms-${u.id}`}>Permissões</Button>
                    <Button size="sm" variant="outline" onClick={() => removeUser(u)}><Trash2 className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!pwUser} onOpenChange={() => setPwUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Redefinir senha — {pwUser?.email}</DialogTitle></DialogHeader>
          <Input type="password" placeholder="Nova senha" value={pwValue} onChange={(e) => setPwValue(e.target.value)} />
          <DialogFooter><Button onClick={resetPassword}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <PermissionsDialog user={permUser} onClose={() => setPermUser(null)} />
    </div>
  );
}

function PermissionsDialog({ user, onClose }) {
  const [modules, setModules] = useState([]);
  const [fancoilIds, setFancoilIds] = useState([]);
  const { data: fancoils = [] } = useQuery({ queryKey: ["fancoils-all"], queryFn: async () => (await api.get("/fancoils")).data, enabled: !!user });
  React.useEffect(() => {
    if (!user) return;
    api.get(`/permissions/${user.id}`).then((r) => {
      setModules(r.data.modules || []);
      setFancoilIds(r.data.fancoil_ids || []);
    });
  }, [user]);

  const toggleModule = (id) => setModules((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const toggleFan = (id) => setFancoilIds((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const selectAll = () => setFancoilIds(fancoils.map((f) => f.id));
  const selectFloor = (floor) => {
    const ids = fancoils.filter((f) => f.floor === floor).map((f) => f.id);
    setFancoilIds((m) => Array.from(new Set([...m, ...ids])));
  };
  const save = async () => {
    try {
      await api.put("/permissions", { user_id: user.id, modules, fancoil_ids: fancoilIds });
      toast.success("Permissões atualizadas");
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const floors = Array.from(new Set(fancoils.map((f) => f.floor))).sort((a, b) => b - a);

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Permissões — {user?.email}</DialogTitle></DialogHeader>
        <div className="space-y-6">
          <div>
            <div className="font-display text-xs uppercase tracking-widest text-muted-foreground mb-2">Módulos</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {MODULES.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={modules.includes(m.id)} onCheckedChange={() => toggleModule(m.id)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="font-display text-xs uppercase tracking-widest text-muted-foreground">Fancoils</div>
              <Button size="sm" variant="outline" onClick={selectAll}>Selecionar todos</Button>
            </div>
            <div className="space-y-2">
              {floors.map((floor) => (
                <div key={floor} className="border border-border rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-mono text-xs uppercase">Andar {floor}</div>
                    <Button size="sm" variant="ghost" onClick={() => selectFloor(floor)}>Todos do andar</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fancoils.filter((f) => f.floor === floor).map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-xs">
                        <Checkbox checked={fancoilIds.includes(f.id)} onCheckedChange={() => toggleFan(f.id)} />
                        {f.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={save} data-testid="save-perms">Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FancoilsTab() {
  const qc = useQueryClient();
  const { data: fancoils = [] } = useQuery({ queryKey: ["fancoils-admin"], queryFn: async () => (await api.get("/fancoils")).data });
  const { data: detected = [] } = useQuery({ queryKey: ["detected"], queryFn: async () => (await api.get("/admin/detected-devices")).data });
  const [form, setForm] = useState({ name: "", device_id: "", floor: "", side: 1, description: "" });
  const [editing, setEditing] = useState(null);

  const create = async () => {
    try {
      await api.post("/fancoils", { ...form, floor: parseInt(form.floor), side: parseInt(form.side) });
      toast.success("Fancoil criado");
      setForm({ name: "", device_id: "", floor: "", side: 1, description: "" });
      qc.invalidateQueries({ queryKey: ["fancoils-admin"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const remove = async (id) => {
    if (!window.confirm("Remover fancoil?")) return;
    await api.delete(`/fancoils/${id}`);
    qc.invalidateQueries({ queryKey: ["fancoils-admin"] });
  };

  const onUploadCsv = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await api.post("/fancoils/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${r.data.inserted} fancoils importados`);
      if (r.data.errors?.length) toast.error(`${r.data.errors.length} erros`);
      qc.invalidateQueries({ queryKey: ["fancoils-admin"] });
    } catch (e2) { toast.error(formatApiError(e2)); }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h3 className="font-display text-sm uppercase tracking-widest mb-3">Cadastrar fancoil</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Input placeholder="Nome (ex CJ171)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="device_id (ex 2CB0)" value={form.device_id} onChange={(e) => setForm({ ...form, device_id: e.target.value })} />
          <Input placeholder="Andar" type="number" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
          <Select value={String(form.side)} onValueChange={(v) => setForm({ ...form, side: parseInt(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Lado 1</SelectItem>
              <SelectItem value="2">Lado 2</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Descrição" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Button onClick={create} data-testid="create-fancoil-button">Criar</Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm bg-muted/40 px-3 py-2 rounded border border-border">
            <Upload className="w-4 h-4" /> Importar CSV
            <input type="file" accept=".csv" onChange={onUploadCsv} className="hidden" data-testid="import-csv-input" />
          </label>
          <div className="text-xs text-muted-foreground font-mono">Formato: name,device_id,floor,side,description</div>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40"><tr>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Nome</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Device ID</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Andar</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Lado</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Descrição</th>
              <th className="px-3 py-2 text-left text-xs uppercase font-mono">Ações</th>
            </tr></thead>
            <tbody>
              {fancoils.map((f) => (
                <tr key={f.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{f.name}</td>
                  <td className="px-3 py-2 font-mono">{f.device_id}</td>
                  <td className="px-3 py-2">{f.floor}</td>
                  <td className="px-3 py-2">{f.side}</td>
                  <td className="px-3 py-2">{f.description}</td>
                  <td className="px-3 py-2 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(f)} data-testid={`edit-fancoil-${f.name.toLowerCase()}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(f.id)} data-testid={`delete-fancoil-${f.name.toLowerCase()}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-display text-sm uppercase tracking-widest mb-3">Dispositivos detectados não cadastrados</h3>
        {detected.length === 0 && <div className="text-xs text-muted-foreground">Nenhum dispositivo não cadastrado detectado no broker.</div>}
        {detected.map((d) => (
          <div key={d.device_id} className="flex items-center justify-between py-2 border-t border-border">
            <div className="font-mono text-sm">{d.device_id}</div>
            <div className="text-xs text-muted-foreground font-mono">{d.last_seen}</div>
          </div>
        ))}
      </Card>

      <EditFancoilDialog fancoil={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["fancoils-admin"] })} />
    </div>
  );
}

function EditFancoilDialog({ fancoil, onClose, onSaved }) {
  const [form, setForm] = useState({});
  React.useEffect(() => {
    if (fancoil) {
      setForm({
        name: fancoil.name,
        floor: fancoil.floor,
        side: fancoil.side,
        description: fancoil.description || "",
        setpoint_min: fancoil.setpoint_min,
        setpoint_max: fancoil.setpoint_max,
        temp_alarm_min: fancoil.temp_alarm_min,
        temp_alarm_max: fancoil.temp_alarm_max,
        active: fancoil.active !== false,
      });
    }
  }, [fancoil]);

  const save = async () => {
    try {
      await api.patch(`/fancoils/${fancoil.id}`, {
        name: form.name,
        floor: parseInt(form.floor),
        side: parseInt(form.side),
        description: form.description,
        setpoint_min: parseFloat(form.setpoint_min),
        setpoint_max: parseFloat(form.setpoint_max),
        temp_alarm_min: parseFloat(form.temp_alarm_min),
        temp_alarm_max: parseFloat(form.temp_alarm_max),
        active: form.active,
      });
      toast.success("Fancoil atualizado");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  if (!fancoil) return null;

  return (
    <Dialog open={!!fancoil} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="edit-fancoil-dialog">
        <DialogHeader>
          <DialogTitle>Editar fancoil — {fancoil.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-xs font-mono uppercase bg-muted/40 border border-border rounded p-2">
            Device ID: <b>{fancoil.device_id}</b> (não editável — se mudou o ESP32, remova e cadastre novamente)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase">Nome</Label>
              <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="edit-fancoil-name" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Descrição</Label>
              <Input value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="edit-fancoil-description" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Andar</Label>
              <Input type="number" value={form.floor ?? ""} onChange={(e) => setForm({ ...form, floor: e.target.value })} data-testid="edit-fancoil-floor" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Lado</Label>
              <Select value={String(form.side || 1)} onValueChange={(v) => setForm({ ...form, side: parseInt(v) })}>
                <SelectTrigger data-testid="edit-fancoil-side"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Lado 1 (esquerda)</SelectItem>
                  <SelectItem value="2">Lado 2 (direita)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase">Setpoint mínimo (°C)</Label>
              <Input type="number" step="0.5" value={form.setpoint_min ?? ""} onChange={(e) => setForm({ ...form, setpoint_min: e.target.value })} data-testid="edit-fancoil-sp-min" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Setpoint máximo (°C)</Label>
              <Input type="number" step="0.5" value={form.setpoint_max ?? ""} onChange={(e) => setForm({ ...form, setpoint_max: e.target.value })} data-testid="edit-fancoil-sp-max" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Alarme temp. mínima (°C)</Label>
              <Input type="number" step="0.5" value={form.temp_alarm_min ?? ""} onChange={(e) => setForm({ ...form, temp_alarm_min: e.target.value })} data-testid="edit-fancoil-alarm-min" />
            </div>
            <div>
              <Label className="text-[10px] uppercase">Alarme temp. máxima (°C)</Label>
              <Input type="number" step="0.5" value={form.temp_alarm_max ?? ""} onChange={(e) => setForm({ ...form, temp_alarm_max: e.target.value })} data-testid="edit-fancoil-alarm-max" />
            </div>
          </div>
          <label className="flex items-center gap-2">
            <Switch checked={!!form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="edit-fancoil-active" />
            <span className="text-sm">Fancoil ativo</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} data-testid="save-fancoil-button">Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/admin/settings")).data });
  const [form, setForm] = useState({});
  React.useEffect(() => {
    if (s) setForm(s);
  }, [s]);

  if (!s || !form.broker) return <div>Carregando...</div>;

  const save = async () => {
    try {
      const payload = {
        broker: form.broker,
        simulation_enabled: form.simulation_enabled,
        offline_timeout_seconds: parseInt(form.offline_timeout_seconds),
        command_timeout_seconds: parseInt(form.command_timeout_seconds),
        temp_out_of_range_minutes: parseInt(form.temp_out_of_range_minutes),
        forced_mode_alarm_hours: parseInt(form.forced_mode_alarm_hours),
        history_retention_months: parseInt(form.history_retention_months),
        hide_unauthorized_fancoils: form.hide_unauthorized_fancoils,
        building_image_url: form.building_image_url,
        logo_url: form.logo_url,
      };
      await api.put("/admin/settings", payload);
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const updBroker = (k, v) => setForm((p) => ({ ...p, broker: { ...p.broker, [k]: v } }));

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm uppercase tracking-widest">Broker MQTT</h3>
          <div className={`font-mono text-xs uppercase px-3 py-1 rounded border ${s.broker_connected ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" : "border-red-500 text-red-400 bg-red-500/10"}`}>
            {s.broker_connected ? "● Conectado" : "● Desconectado"}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Host</Label><Input value={form.broker.host || ""} onChange={(e) => updBroker("host", e.target.value)} /></div>
          <div><Label>Porta</Label><Input type="number" value={form.broker.port} onChange={(e) => updBroker("port", parseInt(e.target.value))} /></div>
          <div><Label>Client ID</Label><Input value={form.broker.client_id || ""} onChange={(e) => updBroker("client_id", e.target.value)} /></div>
          <div><Label>Usuário</Label><Input value={form.broker.username || ""} onChange={(e) => updBroker("username", e.target.value)} /></div>
          <div><Label>Senha</Label><Input type="password" value={form.broker.password || ""} onChange={(e) => updBroker("password", e.target.value)} /></div>
          <div><Label>Prefixo tópicos</Label><Input value={form.broker.topic_prefix || ""} onChange={(e) => updBroker("topic_prefix", e.target.value)} /></div>
          <label className="flex items-center gap-2 mt-2 col-span-full">
            <Switch checked={form.broker.tls} onCheckedChange={(v) => updBroker("tls", v)} />
            <span>TLS (porta 8883)</span>
          </label>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-display text-sm uppercase tracking-widest mb-3">Simulação</h3>
        <label className="flex items-center gap-3">
          <Switch checked={form.simulation_enabled} onCheckedChange={(v) => upd("simulation_enabled", v)} data-testid="simulation-mode-switch" />
          <div><div className="font-semibold">Modo simulação ativo</div>
          <div className="text-xs text-muted-foreground">Fancoils virtuais publicam dados fictícios e respondem a comandos.</div></div>
        </label>
      </Card>

      <Card className="p-4">
        <h3 className="font-display text-sm uppercase tracking-widest mb-3">Parâmetros</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Timeout offline (s)</Label><Input type="number" value={form.offline_timeout_seconds} onChange={(e) => upd("offline_timeout_seconds", e.target.value)} /></div>
          <div><Label>Tempo falha partida/parada (s)</Label><Input type="number" value={form.command_timeout_seconds} onChange={(e) => upd("command_timeout_seconds", e.target.value)} /></div>
          <div><Label>Minutos fora da faixa</Label><Input type="number" value={form.temp_out_of_range_minutes} onChange={(e) => upd("temp_out_of_range_minutes", e.target.value)} /></div>
          <div><Label>Horas em forçado (0=off)</Label><Input type="number" value={form.forced_mode_alarm_hours} onChange={(e) => upd("forced_mode_alarm_hours", e.target.value)} /></div>
          <div><Label>Retenção (meses)</Label><Input type="number" value={form.history_retention_months} onChange={(e) => upd("history_retention_months", e.target.value)} /></div>
          <label className="flex items-center gap-2 mt-6"><Switch checked={form.hide_unauthorized_fancoils} onCheckedChange={(v) => upd("hide_unauthorized_fancoils", v)} /> Ocultar fancoils sem permissão</label>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-display text-sm uppercase tracking-widest mb-3">Imagens</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>URL imagem edifício</Label><Input value={form.building_image_url || ""} onChange={(e) => upd("building_image_url", e.target.value)} /></div>
          <div><Label>URL logo</Label><Input value={form.logo_url || ""} onChange={(e) => upd("logo_url", e.target.value)} /></div>
        </div>
      </Card>

      <Button onClick={save} data-testid="save-settings-button"><RefreshCw className="w-4 h-4 mr-2" />Salvar e reconectar</Button>
    </div>
  );
}

export default function Admin() {
  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="admin-page">
      <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
        <SettingsIcon className="w-8 h-8 text-sky-400" /> Administração
      </h1>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" data-testid="admin-tab-users">Usuários</TabsTrigger>
          <TabsTrigger value="fancoils" data-testid="admin-tab-fancoils">Fancoils</TabsTrigger>
          <TabsTrigger value="settings" data-testid="admin-tab-settings">Broker e Parâmetros</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="fancoils"><FancoilsTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
