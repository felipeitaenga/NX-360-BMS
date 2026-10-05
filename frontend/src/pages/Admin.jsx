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
import { UserPlus, Trash2, KeyRound, Upload, RefreshCw, Settings as SettingsIcon, Pencil, Radio, Activity, Link2, ArrowDownToLine, Plus, Download, Database, AlertTriangle } from "lucide-react";

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
        device_id: fancoil.device_id,
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
    const payload = {
      name: form.name,
      floor: parseInt(form.floor),
      side: parseInt(form.side),
      description: form.description,
      setpoint_min: parseFloat(form.setpoint_min),
      setpoint_max: parseFloat(form.setpoint_max),
      temp_alarm_min: parseFloat(form.temp_alarm_min),
      temp_alarm_max: parseFloat(form.temp_alarm_max),
      active: form.active,
    };
    const newDid = (form.device_id || "").trim();
    if (newDid && newDid !== fancoil.device_id) {
      const ok = window.confirm(
        `Alterar o Device ID de "${fancoil.device_id}" para "${newDid}"?\n\n` +
        `O histórico, alarmes e logs de comando serão migrados automaticamente para o novo ID.`
      );
      if (!ok) return;
      payload.device_id = newDid;
    }
    try {
      await api.patch(`/fancoils/${fancoil.id}`, payload);
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase">Nome</Label>
              <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="edit-fancoil-name" />
            </div>
            <div>
              <Label className="text-[10px] uppercase flex items-center gap-2">
                Device ID (ESP32)
                <span className="text-[9px] text-amber-400 font-normal normal-case">migra histórico automaticamente</span>
              </Label>
              <Input value={form.device_id || ""} onChange={(e) => setForm({ ...form, device_id: e.target.value })} data-testid="edit-fancoil-device-id" className="font-mono" />
            </div>
            <div className="md:col-span-2">
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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const r = await api.post("/admin/broker/test", {
                    host: form.broker.host, port: parseInt(form.broker.port) || 1883,
                    username: form.broker.username || "", password: form.broker.password || "",
                    tls: !!form.broker.tls, client_id: form.broker.client_id || "pilares-backend",
                  });
                  if (r.data.ok) toast.success("Conexão com broker OK");
                  else toast.error(r.data.error || "Falha na conexão");
                } catch (e) { toast.error(formatApiError(e)); }
              }}
              data-testid="test-broker-button"
            >
              Testar conexão
            </Button>
            <div className={`font-mono text-xs uppercase px-3 py-1 rounded border ${s.broker_connected ? "border-emerald-500 text-emerald-400 bg-emerald-500/10" : "border-red-500 text-red-400 bg-red-500/10"}`} data-testid="broker-status">
              {s.broker_connected ? "● Conectado" : "● Desconectado"}
            </div>
          </div>
        </div>
        {!s.broker_connected && s.broker_last_error && (
          <div className="mb-3 bg-red-500/10 border border-red-500/40 text-red-300 text-xs px-3 py-2 rounded" data-testid="broker-last-error">
            {s.broker_last_error}
          </div>
        )}
        {form.simulation_enabled && (
          <div className="mb-3 bg-sky-500/10 border border-sky-500/40 text-sky-300 text-xs px-3 py-2 rounded">
            Modo simulação está ligado. Desative-o abaixo para o backend tentar conectar no broker real.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Host</Label><Input value={form.broker.host || ""} onChange={(e) => updBroker("host", e.target.value)} data-testid="broker-host" placeholder="156.67.82.199" /></div>
          <div>
            <Label>Porta</Label>
            <Input type="number" value={form.broker.port} onChange={(e) => updBroker("port", parseInt(e.target.value) || 0)} data-testid="broker-port" />
            <div className="text-[10px] text-muted-foreground font-mono mt-1">1883 sem TLS · 8883 com TLS</div>
          </div>
          <div><Label>Client ID</Label><Input value={form.broker.client_id || ""} onChange={(e) => updBroker("client_id", e.target.value)} data-testid="broker-client-id" /></div>
          <div><Label>Usuário</Label><Input value={form.broker.username || ""} onChange={(e) => updBroker("username", e.target.value)} data-testid="broker-username" /></div>
          <div><Label>Senha</Label><Input type="password" value={form.broker.password || ""} onChange={(e) => updBroker("password", e.target.value)} data-testid="broker-password" /></div>
          <div><Label>Prefixo tópicos</Label><Input value={form.broker.topic_prefix || ""} onChange={(e) => updBroker("topic_prefix", e.target.value)} data-testid="broker-prefix" /></div>
          <label className="flex items-center gap-2 mt-2 col-span-full">
            <Switch
              checked={!!form.broker.tls}
              onCheckedChange={(v) => setForm((p) => ({
                ...p,
                broker: {
                  ...p.broker, tls: v,
                  port: (!v && (p.broker.port === 8883 || !p.broker.port)) ? 1883
                       : (v && (p.broker.port === 1883 || !p.broker.port)) ? 8883
                       : p.broker.port,
                },
              }))}
              data-testid="broker-tls-toggle"
            />
            <span>TLS/SSL ({form.broker.tls ? "porta padrão 8883" : "porta padrão 1883"})</span>
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
        <SettingsIcon className="w-8 h-8 text-sky-400" /> Configurações
      </h1>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" data-testid="admin-tab-users">Usuários</TabsTrigger>
          <TabsTrigger value="fancoils" data-testid="admin-tab-fancoils">Fancoils</TabsTrigger>
          <TabsTrigger value="settings" data-testid="admin-tab-settings">Broker e Parâmetros</TabsTrigger>
          <TabsTrigger value="diag" data-testid="admin-tab-diag">Diagnóstico MQTT</TabsTrigger>
          <TabsTrigger value="backup" data-testid="admin-tab-backup">Backup</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="fancoils"><FancoilsTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
        <TabsContent value="diag"><MqttDiagTab /></TabsContent>
        <TabsContent value="backup"><BackupTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function BackupTab() {
  const [downloading, setDownloading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [wipe, setWipe] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const fileRef = React.useRef(null);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get("/admin/backup", { responseType: "blob" });
      // Extract filename from Content-Disposition
      let name = "nx360-backup.tar.gz";
      const cd = res.headers["content-disposition"];
      if (cd) {
        const m = cd.match(/filename="([^"]+)"/);
        if (m) name = m[1];
      }
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("Backup gerado");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally { setDownloading(false); }
  };

  const upload = async (file) => {
    if (!file) return;
    if (!window.confirm(wipe
      ? `ATENÇÃO: a opção "Apagar tudo antes" está LIGADA. Isso vai REMOVER todos os dados atuais (usuários, fancoils, pavimentos, plantas, alarmes…) e substituir pelo backup. Continuar?`
      : `Restaurar backup "${file.name}"? Registros duplicados serão ignorados.`)) return;
    setUploading(true); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/admin/restore?wipe=${wipe}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      toast.success("Backup restaurado — recarregue a página pra ver os dados");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div className="space-y-4" data-testid="backup-tab">
      {/* Download */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-display font-bold uppercase tracking-wider text-sm">Fazer backup</div>
            <div className="text-xs text-muted-foreground mt-1">
              Gera um arquivo <span className="font-mono">.tar.gz</span> contendo todas as coleções do banco (usuários, fancoils, pavimentos, pontos, alarmes, histórico, agendamentos, configurações, mapeamentos MQTT) <b>+ todas as plantas baixas</b> e logos do servidor.
              Guarde em local seguro — contém dados sensíveis.
            </div>
            <Button onClick={download} disabled={downloading} className="mt-3" data-testid="btn-backup-download">
              <Download className="w-4 h-4 mr-2" /> {downloading ? "Gerando..." : "Baixar backup agora"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Upload */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Upload className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-display font-bold uppercase tracking-wider text-sm">Restaurar backup</div>
            <div className="text-xs text-muted-foreground mt-1">
              Carrega um arquivo <span className="font-mono">.tar.gz</span> gerado por esta tela. As plantas baixas e logos são restauradas no servidor automaticamente.
            </div>

            <label className="flex items-center gap-2 mt-3 text-xs">
              <Switch checked={wipe} onCheckedChange={setWipe} data-testid="backup-wipe-switch" />
              <span className={wipe ? "text-rose-400 font-bold" : ""}>Apagar TUDO antes de restaurar (modo migração)</span>
            </label>
            {wipe && (
              <div className="mt-2 flex gap-2 items-start text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/40 rounded p-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Modo migração vai <b>deletar todos os dados atuais</b> antes de inserir os do backup. Use só pra migrar entre servidores ou restaurar de um estado limpo.</span>
              </div>
            )}

            <input ref={fileRef} type="file" accept=".tar.gz,.tgz,.gz" className="hidden" data-testid="backup-file-input"
              onChange={(e) => upload(e.target.files?.[0])} />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} variant="outline" className="mt-3" data-testid="btn-backup-restore">
              <Upload className="w-4 h-4 mr-2" /> {uploading ? "Restaurando..." : "Escolher arquivo e restaurar"}
            </Button>
          </div>
        </div>

        {result && (
          <div className="mt-4 text-xs bg-muted/40 border border-border rounded p-3" data-testid="backup-restore-result">
            <div className="font-bold uppercase text-[10px] tracking-widest mb-2 text-emerald-400">Restauração concluída</div>
            <div className="font-mono space-y-0.5">
              <div>Arquivos restaurados: <b>{result.files_restored}</b></div>
              <div>Modo: {result.wipe ? "wipe (apagou tudo)" : "merge"}</div>
              <div className="mt-1">Coleções:</div>
              {Object.entries(result.collections || {}).map(([k, v]) => (
                <div key={k} className="pl-3">
                  <span className="text-sky-300">{k}</span>:{" "}
                  {typeof v === "object" ? `${v.inserted} inseridos, ${v.skipped} ignorados` : v}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function MqttDiagTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState(null);
  const [mapForm, setMapForm] = React.useState({ topic: "", target_device_id: "", target_var: "TEMPERATURA" });
  const { data: summary } = useQuery({
    queryKey: ["mqtt-sniff"],
    queryFn: async () => (await api.get("/admin/mqtt/sniff")).data,
    refetchInterval: 3000,
  });
  const { data: devEvents } = useQuery({
    queryKey: ["mqtt-sniff-device", selected],
    queryFn: async () => (await api.get(`/admin/mqtt/sniff/${selected}`)).data,
    enabled: !!selected,
    refetchInterval: 2000,
  });
  const { data: mappings = [] } = useQuery({
    queryKey: ["topic-mappings"],
    queryFn: async () => (await api.get("/admin/topic-mappings")).data,
  });
  const { data: fancoilsList = [] } = useQuery({
    queryKey: ["fancoils-for-mapping"],
    queryFn: async () => (await api.get("/fancoils")).data,
  });
  const devices = summary?.devices || [];
  const EXPECTED = ["STATUS", "MODO", "TEMPERATURA", "VAG", "CMD/SET", "ESTADO/SET", "SETPOINT/SET", "PRESSAO/SET"];
  const VAR_OPTIONS = ["ONLINE", "STATUS", "MODO", "TEMPERATURA", "VAG", "ESTADO/SET", "CMD/SET", "SETPOINT/SET", "PRESSAO/SET"];

  const addMapping = async () => {
    try {
      if (!mapForm.topic || !mapForm.target_device_id) {
        toast.error("Informe o tópico e o device_id destino");
        return;
      }
      await api.post("/admin/topic-mappings", mapForm);
      toast.success("Mapeamento criado");
      setMapForm({ topic: "", target_device_id: "", target_var: "TEMPERATURA" });
      qc.invalidateQueries({ queryKey: ["topic-mappings"] });
      qc.invalidateQueries({ queryKey: ["mqtt-sniff"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const toggleMapping = async (m) => {
    try {
      await api.patch(`/admin/topic-mappings/${m.id}`, { enabled: !m.enabled });
      qc.invalidateQueries({ queryKey: ["topic-mappings"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const deleteMapping = async (m) => {
    try {
      await api.delete(`/admin/topic-mappings/${m.id}`);
      toast.success("Mapeamento removido");
      qc.invalidateQueries({ queryKey: ["topic-mappings"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const prefillFromUnknown = (e) => {
    // Try to extract device_id and var from topic like "/A100/TEMPERATURA" or "foo/A100/CMD"
    const parts = e.topic.split("/").filter(Boolean);
    let guessedDid = "";
    let guessedVar = "TEMPERATURA";
    if (parts.length >= 2) {
      guessedDid = parts[0];
      const varCandidate = parts.slice(1).join("/");
      if (VAR_OPTIONS.includes(varCandidate)) guessedVar = varCandidate;
    }
    setMapForm({ topic: e.topic, target_device_id: guessedDid, target_var: guessedVar });
    // scroll to form
    document.getElementById("mapping-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <div className="space-y-4" data-testid="mqtt-diag">
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${summary?.connected ? "text-emerald-400" : "text-rose-400"}`} />
            <span className="text-sm font-mono">Broker: {summary?.connected ? "CONECTADO" : "OFFLINE"}</span>
          </div>
          <div className="text-sm font-mono text-muted-foreground">
            Prefixo: <b>{summary?.prefix || "—"}</b> · Modo: {summary?.simulation ? "SIMULAÇÃO" : "REAL"}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            Atualiza a cada 3s · Buffer: 50 msgs/device
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b border-border font-display text-sm uppercase tracking-widest flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-400" />
          Tópicos recebidos por device_id ({devices.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">device_id</th>
                {EXPECTED.map((v) => <th key={v} className="p-2 font-mono">{v}</th>)}
                <th className="p-2">Última msg</th>
                <th className="p-2">#</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const varMap = Object.fromEntries((d.vars || []).map((v) => [v.var, v]));
                return (
                  <tr key={d.device_id} className="border-t border-border/60 hover:bg-accent/5" data-testid={`diag-row-${d.device_id}`}>
                    <td className="p-2 font-mono font-bold">{d.device_id}</td>
                    {EXPECTED.map((v) => (
                      <td key={v} className="p-2">
                        {varMap[v] ? (
                          <span className="text-emerald-400 font-mono" title={varMap[v].ts}>
                            {String(varMap[v].last_payload).slice(0, 10)}
                          </span>
                        ) : (
                          <span className="text-rose-500/70">—</span>
                        )}
                      </td>
                    ))}
                    <td className="p-2 font-mono text-muted-foreground">
                      {d.last_seen ? new Date(d.last_seen).toLocaleTimeString("pt-BR") : "—"}
                    </td>
                    <td className="p-2 font-mono">{d.msg_count}</td>
                    <td className="p-2">
                      <Button size="sm" variant="outline" onClick={() => setSelected(d.device_id)} data-testid={`diag-view-${d.device_id}`}>
                        Ver bruto
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {devices.length === 0 && (
                <tr><td colSpan={EXPECTED.length + 4} className="p-6 text-center text-muted-foreground">Nenhum tópico recebido ainda. Aguarde ~5s...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {summary?.unknown_sample && summary.unknown_sample.length > 0 && (
        <Card className="p-3">
          <div className="font-display text-xs uppercase tracking-widest text-amber-400 mb-2">
            Mensagens fora do prefixo {summary.prefix} ({summary.unknown_sample.length} recentes)
          </div>
          <div className="font-mono text-[11px] space-y-0.5 max-h-56 overflow-auto">
            {summary.unknown_sample.slice().reverse().map((e, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 border-b border-border/30 last:border-0">
                <span className="text-slate-500 shrink-0 w-16">{e.ts?.slice(11, 19)}</span>
                <span className="text-amber-300 flex-1 truncate">{e.topic}</span>
                <span className="text-emerald-400 truncate max-w-[160px]">= {e.payload}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => prefillFromUnknown(e)}
                  data-testid={`map-prefill-${i}`}
                >
                  <ArrowDownToLine className="w-3 h-3 mr-1" /> Mapear
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* === Topic → Variable Mappings === */}
      <Card className="p-4" id="mapping-form">
        <div className="font-display text-sm uppercase tracking-widest flex items-center gap-2 mb-3">
          <Link2 className="w-4 h-4 text-sky-400" />
          Mapeamento Tópico → Variável ({mappings.length})
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          Use para firmwares que publicam fora do padrão <span className="font-mono">{summary?.prefix || "TJS"}/&lt;device_id&gt;/&lt;VAR&gt;</span>.
          Ex.: um ESP32 que publica <span className="font-mono text-amber-300">/A100/TEMPERATURA</span> → mapeie para device_id <b>A100</b>, variável <b>TEMPERATURA</b>.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px_120px] gap-2 items-end">
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest">Tópico MQTT exato</Label>
            <Input
              data-testid="mapping-topic-input"
              placeholder="/A100/TEMPERATURA"
              value={mapForm.topic}
              onChange={(e) => setMapForm((f) => ({ ...f, topic: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest">Fancoil / device_id destino</Label>
            <Select value={mapForm.target_device_id} onValueChange={(v) => setMapForm((f) => ({ ...f, target_device_id: v }))}>
              <SelectTrigger data-testid="mapping-did-select"><SelectValue placeholder="Selecione o fancoil" /></SelectTrigger>
              <SelectContent>
                {fancoilsList.filter((f) => f.active !== false).map((f) => (
                  <SelectItem key={f.id} value={f.device_id} data-testid={`mapping-did-opt-${f.device_id}`}>
                    {f.name} <span className="text-muted-foreground font-mono">({f.device_id})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest">Variável interna</Label>
            <Select value={mapForm.target_var} onValueChange={(v) => setMapForm((f) => ({ ...f, target_var: v }))}>
              <SelectTrigger data-testid="mapping-var-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VAR_OPTIONS.map((v) => <SelectItem key={v} value={v} data-testid={`mapping-var-opt-${v.replace("/","-")}`}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={addMapping} data-testid="mapping-add-button" className="h-10">
            <Plus className="w-4 h-4 mr-1" /> Adicionar
          </Button>
        </div>

        {mappings.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs" data-testid="mappings-table">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-2">Tópico MQTT</th>
                  <th className="p-2">→ device_id</th>
                  <th className="p-2">→ Variável</th>
                  <th className="p-2">Ativo</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="border-t border-border/60" data-testid={`mapping-row-${m.id}`}>
                    <td className="p-2 font-mono text-amber-300">{m.topic}</td>
                    <td className="p-2 font-mono font-bold">{m.target_device_id}</td>
                    <td className="p-2 font-mono text-sky-300">{m.target_var}</td>
                    <td className="p-2"><Switch checked={m.enabled} onCheckedChange={() => toggleMapping(m)} data-testid={`mapping-toggle-${m.id}`} /></td>
                    <td className="p-2">
                      <Button variant="ghost" size="sm" onClick={() => deleteMapping(m)} data-testid={`mapping-delete-${m.id}`}>
                        <Trash2 className="w-4 h-4 text-rose-400" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Tráfego bruto · {selected}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto font-mono text-xs space-y-0.5" data-testid="diag-raw-list">
            {(devEvents?.events || []).slice().reverse().map((e, i) => (
              <div key={i} className="grid grid-cols-[90px_1fr_1fr] gap-3 border-b border-border/40 py-1">
                <span className="text-slate-500">{e.ts?.slice(11, 19)}</span>
                <span className="text-sky-300">{e.var}</span>
                <span className="text-emerald-400">{e.payload}</span>
              </div>
            ))}
            {(!devEvents?.events || devEvents.events.length === 0) && (
              <div className="text-muted-foreground p-4 text-center">Sem mensagens no buffer para este device.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
