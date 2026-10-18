import React from "react";
import { AlertTriangle } from "lucide-react";
import { cmpVer } from "./fwUtils";

export const downgrades = (fw, targets) =>
  fw ? targets.filter((t) => t.versao && cmpVer(fw.versao, t.versao) < 0) : [];

// Avisos de confirmação do OTA: downgrade (exige marcar) e versão sem assinatura
export function OtaWarnings({ fw, targets, confirmed, setConfirmed }) {
  if (!fw) return null;
  const down = downgrades(fw, targets);
  return (
    <div className="space-y-2">
      {down.length > 0 && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-200 space-y-2" data-testid="ota-downgrade-warning">
          <div className="font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Voltar versão (downgrade):</div>
          {down.map((t) => <div key={t.device_id} className="font-mono">{t.identificacao || t.device_id} v{t.versao} → v{fw.versao}</div>)}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="ota-downgrade-confirm" /> Confirmo voltar a versão
          </label>
        </div>
      )}
      {!fw.assinatura && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200" data-testid="ota-unsigned-warning">
          Esta versão não tem assinatura de modelo — confirme que o arquivo é do {fw.modelo}.
        </div>
      )}
    </div>
  );
}
