import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeft, Lightbulb, Maximize, Minus, Plus, Upload, Save, Trash2, Zap, HelpCircle, Search, Eye, Pencil, X } from "lucide-react";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const TIPOS = [
  { id: "lampada", label: "Lâmpada", emoji: "💡" },
  { id: "spot", label: "Spot", emoji: "🔆" },
  { id: "plafon", label: "Plafon", emoji: "⚪" },
  { id: "fita_led", label: "Fita LED", emoji: "〰️" },
  { id: "arandela", label: "Arandela", emoji: "🏮" },
  { id: "refletor", label: "Refletor", emoji: "🔦" },
  { id: "balizador", label: "Balizador", emoji: "🟡" },
  { id: "emergencia", label: "Emergência", emoji: "🚨" },
];

export default function IluminacaoPavimento() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canCommand = isAdmin || user?.role === "operator";
  const [mode, setMode] = useState("view"); // view|edit
  const { lightingState, lightingPending, setLightingState } = useTelemetry();

  const { data: pavimentos = [] } = useQuery({ queryKey: ["pavimentos"], queryFn: async () => (await api.get("/lighting/pavimentos")).data });
  const pav = pavimentos.find((p) => p.id === id);
  const { data: pontos = [], refetch: refetchPontos } = useQuery({
    queryKey: ["lighting-pontos", id],
    queryFn: async () => (await api.get(`/lighting/pontos?pavimento_id=${id}`)).data,
    refetchInterval: 15000,
  });
  const { data: controladoras = [] } = useQuery({ queryKey: ["lighting-controladoras"], queryFn: async () => (await api.get("/lighting/controladoras")).data });
  const ctrlById = useMemo(() => Object.fromEntries(controladoras.map((c) => [c.id, c])), [controladoras]);

  // Hydrate initial snapshot
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/lighting/snapshot");
        setLightingState((prev) => {
          const next = { ...prev };
          data.forEach((c) => {
            next[c.mqtt_id] = {
              mqtt_id: c.mqtt_id, online: c.online, rede: c.rede, ultimo_contato: c.ultimo_contato,
              circuitos: Object.fromEntries(c.circuitos.map((x) => [x.numero, { estado: x.estado, modo: x.modo, last_input: x.last_input }])),
            };
          });
          return next;
        });
      } catch {}
    })();
  }, [setLightingState]);

  // Pan/zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const [filter, setFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [selectedPonto, setSelectedPonto] = useState(null);
  const [sidePanel, setSidePanel] = useState(null); // ponto for right-click sidebar

  const onWheel = (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setZoom((z) => Math.max(0.5, Math.min(5, z + delta * z)));
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (mode === "edit" && e.target.closest("[data-ponto-id]")) return;
    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const onMouseUp = () => { dragRef.current = null; };
  const fitToScreen = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // --- Commands ---
  const sendToggle = async (p) => {
    const ctrl = ctrlById[p.controladora_id];
    if (!ctrl) return;
    const state = lightingState[ctrl.mqtt_id];
    if (!state?.online) { toast.error("Controladora offline"); return; }
    try {
      await api.post(`/lighting/controladoras/${ctrl.id}/circuitos/${p.circuito}/comando`, { value: "TOGGLE" });
    } catch (e) { toast.error(formatApiError(e)); }
  };
  const sendOnOff = async (p, on) => {
    const ctrl = ctrlById[p.controladora_id];
    if (!ctrl) return;
    try { await api.post(`/lighting/controladoras/${ctrl.id}/circuitos/${p.circuito}/comando`, { value: on ? "true" : "false" }); }
    catch (e) { toast.error(formatApiError(e)); }
  };
  const sendMode = async (p, mode) => {
    const ctrl = ctrlById[p.controladora_id];
    if (!ctrl) return;
    try { await api.post(`/lighting/controladoras/${ctrl.id}/circuitos/${p.circuito}/modo`, { mode: mode ? "AUTO" : "MANUAL" }); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  // --- Pending timeout toast ---
  useEffect(() => {
    const keys = Object.keys(lightingPending);
    keys.forEach((k) => { if (lightingPending[k]?.timeout) toast.error("Controladora não respondeu"); });
  }, [lightingPending]);

  const getPointState = (p) => {
    const ctrl = ctrlById[p.controladora_id];
    if (!ctrl) return { estado: null, modo: null, online: false };
    const s = lightingState[ctrl.mqtt_id];
    if (!s) return { estado: null, modo: null, online: false };
    const c = s.circuitos?.[p.circuito] || {};
    return { estado: c.estado, modo: c.modo, online: s.online, ctrl };
  };
  const isPending = (p) => {
    const ctrl = ctrlById[p.controladora_id];
    if (!ctrl) return false;
    return !!lightingPending[`${ctrl.mqtt_id}:estado:${p.circuito}`];
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filteredList = useMemo(() => pontos.filter((p) => {
    if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
    const { estado } = getPointState(p);
    if (filter === "acesos" && estado !== true) return false;
    if (filter === "apagados" && estado === true) return false;
    return true;
  }), [pontos, search, filter, lightingState, ctrlById]);

  if (!pav) return <div className="p-8">Pavimento não encontrado</div>;

  return (
    <div className="p-4 lg:p-6 space-y-4" data-testid="pavimento-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/iluminacao" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="back-to-iluminacao">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <Select value={id} onValueChange={(v) => navigate(`/iluminacao/pavimento/${v}`)}>
          <SelectTrigger className="w-56" data-testid="pavimento-switcher"><SelectValue /></SelectTrigger>
          <SelectContent>{pavimentos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}</SelectContent>
        </Select>
        <h1 className="font-display text-2xl font-black uppercase flex items-center gap-2"><Lightbulb className="w-6 h-6 text-amber-400" />{pav.nome}</h1>
        <div className="ml-auto flex gap-2">
          {isAdmin && (
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="view" data-testid="tab-view"><Eye className="w-4 h-4 mr-1" />Ver</TabsTrigger>
                <TabsTrigger value="edit" data-testid="tab-edit"><Pencil className="w-4 h-4 mr-1" />Editar</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Canvas */}
        <Card className="p-0 overflow-hidden relative" style={{ height: "calc(100vh - 220px)", minHeight: 480 }}>
          <div className="absolute top-2 left-2 z-10 flex gap-1 bg-slate-900/80 rounded p-1">
            <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))} data-testid="zoom-out"><Minus className="w-4 h-4" /></Button>
            <div className="text-xs font-mono px-2 py-1" data-testid="zoom-level">{Math.round(zoom * 100)}%</div>
            <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(5, z * 1.2))} data-testid="zoom-in"><Plus className="w-4 h-4" /></Button>
            <Button size="sm" variant="ghost" onClick={fitToScreen} data-testid="fit-screen"><Maximize className="w-4 h-4" /></Button>
          </div>
          {mode === "edit" && isAdmin && <EditToolbar pavimentoId={id} controladoras={controladoras} onCreated={() => { refetchPontos(); }} onPlantaUploaded={() => { qc.invalidateQueries({ queryKey: ["pavimentos"] }); }} planta_url={pav.planta_url} />}
          <div
            ref={containerRef}
            className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing bg-slate-900"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            data-testid="plant-canvas"
          >
            <div
              className="relative origin-top-left"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: "100%", height: "100%" }}
            >
              {pav.planta_url ? (
                <img src={`${API_URL}${pav.planta_url}`} alt="planta" className="w-full h-full object-contain pointer-events-none select-none" draggable={false} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Upload className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <div className="text-sm">Nenhuma planta carregada {isAdmin && "— vá para 'Editar' e faça upload"}</div>
                  </div>
                </div>
              )}
              {/* Pontos sobre a planta */}
              {pontos.map((p) => (
                <PontoDot key={p.id}
                  p={p}
                  state={getPointState(p)}
                  pending={isPending(p)}
                  selected={selectedPonto === p.id}
                  canCommand={canCommand}
                  editMode={mode === "edit" && isAdmin}
                  onClick={() => { if (mode === "view" && canCommand) sendToggle(p); }}
                  onRightClick={() => setSidePanel(p)}
                  onSelect={() => setSelectedPonto(p.id)}
                  onDragEnd={async (nx, ny) => {
                    try {
                      await api.patch(`/lighting/pontos/${p.id}`, { x: nx, y: ny });
                      refetchPontos();
                    } catch (e) { toast.error(formatApiError(e)); }
                  }}
                  onDelete={async () => {
                    if (!window.confirm(`Excluir "${p.nome}"?`)) return;
                    try { await api.delete(`/lighting/pontos/${p.id}`); refetchPontos(); } catch (e) { toast.error(formatApiError(e)); }
                  }}
                />
              ))}
            </div>
          </div>
        </Card>

        {/* Lateral */}
        <Card className="p-3 flex flex-col gap-2 overflow-hidden">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar ponto…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" data-testid="search-pontos" />
          </div>
          <div className="flex gap-1">
            {[["todos", "Todos"], ["acesos", "Acesos"], ["apagados", "Apagados"]].map(([v, l]) => (
              <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} className="flex-1 h-7 text-xs" onClick={() => setFilter(v)} data-testid={`filter-${v}`}>{l}</Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">{filteredList.length} ponto(s)</div>
          <div className="overflow-auto space-y-1 pr-1 flex-1">
            {filteredList.map((p) => {
              const s = getPointState(p);
              return (
                <button key={p.id}
                  onClick={() => setSelectedPonto(p.id)}
                  onDoubleClick={() => setSidePanel(p)}
                  className={`w-full text-left px-2 py-1.5 rounded border text-xs ${selectedPonto === p.id ? "border-sky-400 bg-sky-500/10" : "border-border hover:bg-accent/10"}`}
                  data-testid={`list-ponto-${p.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.estado === true ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" : s.estado === false ? "bg-slate-500" : "bg-slate-700"}`} />
                    <span className="flex-1 truncate">{p.nome}</span>
                    {s.modo === true && <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1 rounded">A</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{s.ctrl?.nome || "?"} · L{String(p.circuito).padStart(2, "0")}</div>
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-muted-foreground border-t border-border pt-2 flex items-start gap-1">
            <HelpCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>Em <b>AUTOMÁTICO</b> o circuito segue a agenda da controladora. Mesmo em AUTO você pode ligar/desligar; a agenda assume na próxima transição.</span>
          </div>
        </Card>
      </div>

      {/* Sidebar painel direita */}
      {sidePanel && (
        <PointSidebar
          ponto={sidePanel}
          allPontos={pontos}
          state={getPointState(sidePanel)}
          pending={isPending(sidePanel)}
          onClose={() => setSidePanel(null)}
          onOn={() => sendOnOff(sidePanel, true)}
          onOff={() => sendOnOff(sidePanel, false)}
          onModeChange={(auto) => sendMode(sidePanel, auto)}
          canCommand={canCommand}
        />
      )}
    </div>
  );
}

function PontoDot({ p, state, pending, selected, canCommand, editMode, onClick, onRightClick, onSelect, onDragEnd, onDelete }) {
  const [dragging, setDragging] = useState(false);
  const tipoEmoji = TIPOS.find((t) => t.id === p.tipo)?.emoji || "💡";
  const left = `${p.x * 100}%`;
  const top = `${p.y * 100}%`;
  const offline = !state.online;
  const color = pending
    ? "bg-sky-400 animate-pulse"
    : offline
    ? "bg-slate-700 border-2 border-dashed border-rose-500"
    : state.estado === true
    ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]"
    : "bg-slate-500";

  const onMouseDown = (e) => {
    if (!editMode) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const container = e.currentTarget.parentElement;
    const rect = container.getBoundingClientRect();
    let moved = false;
    const move = (ev) => {
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) moved = true;
      if (moved) {
        const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        e.currentTarget.style.left = `${nx * 100}%`;
        e.currentTarget.style.top = `${ny * 100}%`;
        setDragging(true);
      }
    };
    const up = (ev) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (moved) {
        const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        onDragEnd(nx, ny);
      }
      setTimeout(() => setDragging(false), 50);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      data-ponto-id={p.id}
      data-testid={`ponto-${p.id}`}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${color} w-10 h-10 flex items-center justify-center text-lg cursor-pointer transition-all ${selected ? "ring-2 ring-sky-300 ring-offset-2 ring-offset-slate-900" : ""} ${offline ? "pointer-events-none opacity-70" : ""}`}
      style={{ left, top, touchAction: "none" }}
      onClick={(e) => { e.stopPropagation(); if (!dragging) { onSelect(); if (!editMode && canCommand && !offline) onClick(); } }}
      onContextMenu={(e) => { e.preventDefault(); onRightClick(); }}
      onMouseDown={onMouseDown}
      title={`${p.nome} · L${String(p.circuito).padStart(2, "0")} · ${state.estado === true ? "Aceso" : "Apagado"}${state.modo === true ? " · AUTO" : ""}`}
    >
      <span className="pointer-events-none">{tipoEmoji}</span>
      {state.modo === true && (
        <span className="absolute -top-1 -right-1 bg-sky-500 text-white text-[9px] font-black rounded-full w-5 h-5 flex items-center justify-center">A</span>
      )}
      {editMode && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -bottom-1 -right-1 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center" data-testid={`delete-ponto-${p.id}`}>
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function EditToolbar({ pavimentoId, controladoras, onCreated, onPlantaUploaded, planta_url }) {
  const [tipo, setTipo] = useState("lampada");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", controladora_id: "", circuito: 1, x: 0.5, y: 0.5 });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const onDropOnCanvas = async (e) => {
    const target = e.target.closest("[data-testid='plant-canvas']");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setForm({ nome: "", controladora_id: controladoras[0]?.id || "", circuito: 1, x: nx, y: ny });
    setFormOpen(true);
  };

  useEffect(() => {
    const el = document.querySelector("[data-testid='plant-canvas']");
    if (!el) return;
    el.addEventListener("drop", onDropOnCanvas);
    el.addEventListener("dragover", (e) => e.preventDefault());
    return () => { try { el.removeEventListener("drop", onDropOnCanvas); } catch {} };
  });

  const onUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      await api.post(`/lighting/pavimentos/${pavimentoId}/planta`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Planta carregada");
      onPlantaUploaded?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploading(false); }
  };

  const createPonto = async () => {
    if (!form.nome.trim() || !form.controladora_id) { toast.error("Preencha nome e controladora"); return; }
    try {
      await api.post("/lighting/pontos", { pavimento_id: pavimentoId, controladora_id: form.controladora_id, circuito: Number(form.circuito), nome: form.nome, tipo, x: form.x, y: form.y });
      toast.success("Ponto criado");
      setFormOpen(false); onCreated?.();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="absolute top-2 right-2 z-10 bg-slate-900/90 border border-border rounded p-2 w-64 space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Paleta — arraste p/ planta</div>
      <div className="grid grid-cols-4 gap-1">
        {TIPOS.map((t) => (
          <button key={t.id}
            draggable
            onDragStart={(e) => { setTipo(t.id); e.dataTransfer.setData("text/plain", t.id); }}
            className={`p-1.5 rounded border text-lg ${tipo === t.id ? "border-sky-400 bg-sky-500/10" : "border-border hover:bg-accent/10"}`}
            data-testid={`palette-${t.id}`}
            title={t.label}
          >{t.emoji}</button>
        ))}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground pt-1 border-t border-border">Planta baixa</div>
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" data-testid="planta-file-input" onChange={(e) => onUpload(e.target.files?.[0])} />
      <Button size="sm" variant="outline" className="w-full" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="btn-upload-planta">
        <Upload className="w-4 h-4 mr-1" />{planta_url ? "Trocar planta" : "Enviar planta"}
      </Button>
      <div className="text-[10px] text-muted-foreground">PNG, JPG, SVG, WEBP até 15 MB. Pontos existentes são preservados.</div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo ponto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} data-testid="input-ponto-nome" placeholder="Recepção — Spots" /></div>
            <div>
              <Label>Controladora</Label>
              <Select value={form.controladora_id} onValueChange={(v) => setForm({ ...form, controladora_id: v })}>
                <SelectTrigger data-testid="select-ponto-ctrl"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{controladoras.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome} ({c.mqtt_id})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Circuito</Label>
              <Select value={String(form.circuito)} onValueChange={(v) => setForm({ ...form, circuito: v })}>
                <SelectTrigger data-testid="select-ponto-circuito"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => {
                    const ctrl = controladoras.find((c) => c.id === form.controladora_id);
                    const circ = ctrl?.circuitos?.find((c) => c.numero === n);
                    return <SelectItem key={n} value={String(n)}>L{String(n).padStart(2, "0")} — {circ?.nome_circuito || `L${n}`}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={createPonto} data-testid="btn-save-ponto">Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PointSidebar({ ponto, allPontos, state, pending, onClose, onOn, onOff, onModeChange, canCommand }) {
  const { data: eventos = [] } = useQuery({
    queryKey: ["lighting-eventos", state?.ctrl?.mqtt_id, ponto.circuito],
    queryFn: async () => (await api.get(`/lighting/eventos?mqtt_id=${state.ctrl.mqtt_id}&circuito=${ponto.circuito}&limit=10`)).data,
    enabled: !!state?.ctrl?.mqtt_id,
    refetchInterval: 5000,
  });
  const outros = allPontos.filter((p) => p.id !== ponto.id && p.controladora_id === ponto.controladora_id && p.circuito === ponto.circuito);
  return (
    <Dialog open={!!ponto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="point-sidebar">
        <DialogHeader><DialogTitle>{ponto.nome}</DialogTitle></DialogHeader>
        <div className="text-xs font-mono text-muted-foreground">
          {state?.ctrl?.nome || "?"} · L{String(ponto.circuito).padStart(2, "0")} · {state?.ctrl?.mqtt_id || "?"}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${pending ? "bg-sky-400 animate-pulse" : state.estado === true ? "bg-amber-400" : "bg-slate-500"}`} />
          <div className="font-display font-bold">{state.estado === true ? "ACESO" : state.estado === false ? "APAGADO" : "—"}</div>
        </div>
        {canCommand && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={onOn} disabled={!state.online || pending} className="bg-emerald-600 hover:bg-emerald-500" data-testid="sidebar-ligar">Ligar</Button>
              <Button onClick={onOff} disabled={!state.online || pending} className="bg-rose-600 hover:bg-rose-500" data-testid="sidebar-desligar">Desligar</Button>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={state.modo === true} onCheckedChange={(v) => onModeChange(v)} data-testid="sidebar-modo" />
              <span className="text-sm">Modo {state.modo === true ? "AUTOMÁTICO" : "MANUAL"}</span>
            </div>
          </>
        )}
        {outros.length > 0 && (
          <div className="pt-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Outros pontos deste circuito</div>
            <div className="text-xs space-y-0.5">{outros.map((p) => <div key={p.id}>• {p.nome}</div>)}</div>
          </div>
        )}
        <div className="pt-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Últimos eventos</div>
          <div className="text-[11px] font-mono space-y-0.5 max-h-32 overflow-auto">
            {eventos.map((e) => <div key={e.id}><span className="text-slate-500">{e.timestamp.slice(11, 19)}</span> {e.tipo}={e.valor} <span className="text-slate-500">({e.origem})</span></div>)}
            {eventos.length === 0 && <div className="text-muted-foreground">Nenhum</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
