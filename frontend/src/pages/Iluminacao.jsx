import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTelemetry } from "../context/TelemetryContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { toast } from "sonner";
import { Lightbulb, Plus, Settings2, Power, PowerOff, Trash2, AlertTriangle, WifiOff, Wifi, Pencil } from "lucide-react";

const API_URL = process.env.REACT_APP_BACKEND_URL;

export default function Iluminacao() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [newPavOpen, setNewPavOpen] = useState(false);
  const [newPavName, setNewPavName] = useState("");
  const [newPavOrdem, setNewPavOrdem] = useState(0);
  const [busyPav, setBusyPav] = useState(null);

  const { data: overview, refetch } = useQuery({
    queryKey: ["lighting-overview"],
    queryFn: async () => (await api.get("/lighting/overview")).data,
    refetchInterval: 5000,
  });

  const pavimentos = overview?.pavimentos || [];

  const createPav = async () => {
    try {
      await api.post("/lighting/pavimentos", { nome: newPavName, ordem: Number(newPavOrdem) || 0 });
      toast.success("Pavimento criado");
      setNewPavOpen(false);
      setNewPavName(""); setNewPavOrdem(0);
      qc.invalidateQueries({ queryKey: ["lighting-overview"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const bulkPav = async (pid, on) => {
    setBusyPav(pid);
    try {
      const { data } = await api.post(`/lighting/pavimentos/${pid}/todos?on=${on}`);
      const sent = data?.sent?.length || 0;
      toast.success(`${on ? "Ligar" : "Desligar"} tudo: ${sent} circuito(s)`);
      setTimeout(() => refetch(), 500);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusyPav(null); }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="iluminacao-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
            <Lightbulb className="w-8 h-8 text-amber-400" /> Iluminação
          </h1>
          <div className="text-muted-foreground text-sm mt-1">Supervisão por pavimento</div>
        </div>
        <div className="flex gap-2">
          {user?.role === "admin" && (
            <>
              <Button variant="outline" asChild data-testid="btn-controladoras">
                <Link to="/iluminacao/controladoras"><Settings2 className="w-4 h-4 mr-2" />Controladoras</Link>
              </Button>
              <Button onClick={() => setNewPavOpen(true)} data-testid="btn-new-pavimento"><Plus className="w-4 h-4 mr-2" />Novo pavimento</Button>
            </>
          )}
        </div>
      </div>

      {/* Resumo topo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Pavimentos", pavimentos.length, "text-slate-300"],
          ["Controladoras online", `${overview?.controladoras_online || 0}/${overview?.controladoras_total || 0}`, "text-emerald-400"],
          ["Circuitos ligados", overview?.circuitos_ligados || 0, "text-amber-400"],
          ["Offline", (overview?.controladoras_total || 0) - (overview?.controladoras_online || 0), "text-rose-400"],
        ].map(([label, val, cls]) => (
          <Card key={label} className="p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
            <div className={`font-display text-2xl font-black ${cls}`}>{val}</div>
          </Card>
        ))}
      </div>

      {/* Cards de pavimento */}
      {pavimentos.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground" data-testid="no-pavimentos">
          <Lightbulb className="w-10 h-10 mx-auto mb-3 opacity-40" />
          Nenhum pavimento cadastrado. {isAdmin && <>Clique em <b>Novo pavimento</b> para começar.</>}
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pavimentos.map((pav) => (
          <Card key={pav.id} className="overflow-hidden" data-testid={`pavimento-card-${pav.id}`}>
            <Link to={`/iluminacao/pavimento/${pav.id}`} className="block">
              <div className="aspect-video bg-slate-800/60 relative border-b border-border">
                {pav.planta_url ? (
                  <img src={`${API_URL}${pav.planta_url}`} alt={pav.nome} className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem planta</div>
                )}
                {pav.offline && (
                  <div className="absolute top-2 right-2 bg-rose-500/90 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1 font-mono uppercase">
                    <AlertTriangle className="w-3 h-3" />Controladora offline
                  </div>
                )}
              </div>
            </Link>
            <div className="p-3">
              <div className="flex items-center justify-between">
                <div className="font-display font-bold">{pav.nome}</div>
                <div className="text-xs font-mono text-amber-400">{pav.pontos_acesos} de {pav.pontos_total} acesos</div>
              </div>
              <div className="flex gap-2 mt-3">
                <BulkBtn testid={`btn-ligar-tudo-${pav.id}`} icon={Power} label="Ligar tudo" variant="emerald"
                  busy={busyPav === pav.id}
                  confirmTitle={`Ligar tudo em ${pav.nome}?`}
                  confirmDesc="Envia comando LIGAR para todos os circuitos de pontos deste pavimento."
                  onConfirm={() => bulkPav(pav.id, true)} />
                <BulkBtn testid={`btn-desligar-tudo-${pav.id}`} icon={PowerOff} label="Desligar tudo" variant="rose"
                  busy={busyPav === pav.id}
                  confirmTitle={`Desligar tudo em ${pav.nome}?`}
                  confirmDesc="Envia comando DESLIGAR para todos os circuitos de pontos deste pavimento."
                  onConfirm={() => bulkPav(pav.id, false)} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={newPavOpen} onOpenChange={setNewPavOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo pavimento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input data-testid="input-pavimento-nome" value={newPavName} onChange={(e) => setNewPavName(e.target.value)} placeholder="Térreo, 1º Andar, Garagem G1" /></div>
            <div><Label>Ordem (menor = em cima)</Label><Input data-testid="input-pavimento-ordem" type="number" value={newPavOrdem} onChange={(e) => setNewPavOrdem(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPavOpen(false)}>Cancelar</Button>
            <Button onClick={createPav} data-testid="btn-save-pavimento" disabled={!newPavName.trim()}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const VBG = { emerald: "bg-emerald-600 hover:bg-emerald-500 text-white", rose: "bg-rose-600 hover:bg-rose-500 text-white" };
function BulkBtn({ testid, icon: Icon, label, variant, busy, confirmTitle, confirmDesc, onConfirm }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button data-testid={testid} disabled={busy} className={`flex-1 h-9 text-xs font-display uppercase tracking-wider ${VBG[variant]}`}>
          <Icon className="w-4 h-4 mr-1" />{label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{confirmDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${testid}-cancel`}>Cancelar</AlertDialogCancel>
          <AlertDialogAction data-testid={`${testid}-confirm`} onClick={onConfirm}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
