import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Clock, Wind, ChevronDown, ChevronRight } from "lucide-react";
import SchedulesPanel from "../components/SchedulesPanel";

export default function ProgramacaoHoraria() {
  const { user } = useAuth();
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
    refetchInterval: 60000,
  });
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState({});

  const canCommand = user?.role !== "viewer";

  const visibleFancoils = useMemo(() => {
    const act = fancoils.filter((f) => f.active !== false && f.authorized !== false);
    if (!filter) return act;
    const q = filter.toLowerCase();
    return act.filter((f) => f.name.toLowerCase().includes(q) || String(f.floor).includes(q));
  }, [fancoils, filter]);

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="programacao-horaria-page">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
          <Clock className="w-8 h-8 text-sky-400" /> Programação Horária
        </h1>
        <div className="text-muted-foreground text-sm mt-1">
          A programação é <b>enviada à controladora via MQTT</b> (tópico <code className="font-mono text-xs">SCHEDULE/SET</code>, retained).
          O ESP32 armazena e executa internamente.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Buscar fancoil (ex.: CJ171, 17)..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="prog-horaria-search"
          className="max-w-sm"
        />
        <div className="text-xs text-muted-foreground">
          {visibleFancoils.length} fancoil(s) acessível(is)
        </div>
      </div>

      <div className="space-y-3">
        {visibleFancoils.map((fc) => {
          const open = !!expanded[fc.id];
          return (
            <Card key={fc.id} data-testid={`prog-fc-${fc.name.toLowerCase()}`} className="overflow-hidden">
              <button
                onClick={() => setExpanded((p) => ({ ...p, [fc.id]: !p[fc.id] }))}
                className="w-full flex items-center gap-3 p-4 hover:bg-accent/10 text-left"
                data-testid={`prog-fc-toggle-${fc.name.toLowerCase()}`}
              >
                <Wind className={`w-5 h-5 ${fc.online ? "text-sky-400" : "text-slate-600"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-base">{fc.name}</div>
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    {fc.floor}º andar • Lado {fc.side} • {fc.device_id}
                  </div>
                </div>
                {open ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
              </button>
              {open && (
                <div className="px-4 pb-4 pt-2 border-t border-border/60">
                  <SchedulesPanel fancoilId={fc.id} canEdit={canCommand} />
                </div>
              )}
            </Card>
          );
        })}
        {visibleFancoils.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            Nenhum fancoil disponível para programação.
          </Card>
        )}
      </div>
    </div>
  );
}
