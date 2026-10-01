import React from "react";
import { Card } from "../components/ui/card";
import { Construction } from "lucide-react";

export default function EmBreve({ title, icon: Icon = Construction }) {
  return (
    <div className="p-6 lg:p-8" data-testid="em-breve-page">
      <Card className="p-16 flex flex-col items-center justify-center text-center gap-4">
        <Icon className="w-16 h-16 text-sky-400" strokeWidth={1.2} />
        <h1 className="font-display text-3xl font-black uppercase tracking-tight">{title}</h1>
        <div className="text-muted-foreground max-w-md">
          Este módulo está em desenvolvimento. O backend já suporta a entidade genérica de dispositivos — basta cadastrar novos tipos para iniciar.
        </div>
        <div className="text-xs font-mono uppercase tracking-widest text-sky-400 bg-sky-500/10 border border-sky-500/40 px-3 py-1 rounded">
          Em breve
        </div>
      </Card>
    </div>
  );
}
