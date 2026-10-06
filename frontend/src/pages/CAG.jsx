import React from "react";
import { Snowflake } from "lucide-react";
import { Card } from "../components/ui/card";

export default function CAG() {
  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="cag-page">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
          <Snowflake className="w-8 h-8 text-cyan-400" /> CAG — Central de Água Gelada
        </h1>
        <div className="text-muted-foreground text-sm mt-1">
          Supervisão de chillers, torres e bombas da central de água gelada.
        </div>
      </div>
      <Card className="p-10 flex flex-col items-center justify-center gap-4 border-dashed">
        <Snowflake className="w-14 h-14 text-cyan-400/60" strokeWidth={1.5} />
        <div className="font-display text-xl font-black tracking-widest uppercase text-slate-300">
          Em breve
        </div>
        <div className="text-sm text-muted-foreground text-center max-w-md">
          O módulo CAG permitirá monitorar chillers, bombas primárias/secundárias, torres de resfriamento, pressão
          hidráulica e consumo elétrico da planta de água gelada. Entre em contato para priorizar.
        </div>
      </Card>
    </div>
  );
}
