import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../../lib/api";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../ui/dialog";
import { toast } from "sonner";
import { Cpu, AlertTriangle } from "lucide-react";

/**
 * Reutilizável (fancoil, iluminação, CAG…): atualiza 1+ controladoras com uma versão do MESMO modelo.
 * Se modelo for null, lista todas as versões e exige confirmação "forçar sem modelo".
 */
export function FirmwareUpdateDialog({ deviceIds, modelo, versaoAtual, label = "Atualizar firmware", size = "sm", onSent, testid = "fw-update-dialog-btn" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fwId, setFwId] = useState("");
  const [forceAsk, setForceAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: fws = [] } = useQuery({
    queryKey: ["firmwares", modelo || "*"],
    queryFn: async () => (await api.get("/admin/firmware", { params: modelo ? { modelo } : {} })).data,
    enabled: open,
  });
  const fw = fws.find((f) => f.id === fwId);

  const send = async (forcar = false) => {
    setBusy(true);
    try {
      const r = await api.post(`/admin/firmware/${fwId}/enviar`, { device_ids: deviceIds, forcar_sem_modelo: forcar });
      toast.success(`Atualização iniciada: ${r.data.items.length} controladora(s)`);
      qc.invalidateQueries({ queryKey: ["fw-batch"] });
      setOpen(false); setForceAsk(null);
      onSent?.();
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (d?.code === "sem_modelo") setForceAsk(d.message);
      else toast.error(formatApiError(e));
    }
    setBusy(false);
  };

  return (
    <>
      <Button size={size} variant="outline" className="gap-2" disabled={!deviceIds?.length} onClick={() => { setOpen(true); setForceAsk(null); setFwId(""); }} data-testid={testid}>
        <Cpu className="w-4 h-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="fw-update-dialog">
          <DialogHeader>
            <DialogTitle>Atualizar firmware {modelo ? `· ${modelo}` : "· modelo não informado"}</DialogTitle>
            <DialogDescription>
              {deviceIds?.length} controladora(s){versaoAtual ? ` · atual v${versaoAtual}` : ""}. O equipamento continua operando durante o download; a controladora reinicia ao final.
            </DialogDescription>
          </DialogHeader>
          <Select value={fwId} onValueChange={setFwId}>
            <SelectTrigger data-testid="fw-update-version-select"><SelectValue placeholder={fws.length ? "Escolha a versão…" : "Nenhuma versão disponível"} /></SelectTrigger>
            <SelectContent>
              {fws.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.modelo} v{f.versao}{f.mais_recente ? " · mais recente" : ""}{f.versao === versaoAtual ? " · atual" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fw?.notas && <div className="text-xs text-muted-foreground">Notas: {fw.notas}</div>}
          {!modelo && (
            <div className="text-xs text-amber-300 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> A controladora não informou o MODELO — o envio exige confirmação e fica registrado.</div>
          )}
          {forceAsk && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2" data-testid="fw-force-confirm">
              <div>{forceAsk}</div>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => send(true)} data-testid="fw-force-send-btn">Forçar envio sem modelo</Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={!fwId || busy || !!forceAsk} onClick={() => send(false)} data-testid="fw-update-send-btn">Atualizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
