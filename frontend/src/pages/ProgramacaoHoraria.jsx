import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Clock, Wind, Code, ChevronDown, ChevronRight, Copy, CheckCircle2 } from "lucide-react";
import SchedulesPanel from "../components/SchedulesPanel";
import { toast } from "sonner";

const ESP32_PROMPT = `Preciso que você ajuste meu firmware ESP32 (controlador de fancoil) para que ele receba, armazene e execute a programação horária enviada pelo supervisório NX-360 BMS via MQTT.

== Protocolo MQTT definido pelo supervisório ==

Tópico (RECEIVE, assinatura obrigatória):
  TJS/{DEVICE_ID}/SCHEDULE/SET            (QoS 1, retained = true)

Onde {DEVICE_ID} é o ID atual do fancoil (ex.: CE94, A100, 2CB0 — o mesmo usado nos tópicos TEMPERATURA, CMD/SET, ESTADO/SET, etc.).

Payload: texto puro (NÃO é JSON). Uma linha por agendamento. Linhas separadas por "\\n". Payload vazio ("") significa "apagar TODOS os agendamentos deste dispositivo".

Formato de cada linha (6 campos separados por ";"):
  IDX;HH:MM;DIAS;ACAO;VALOR;EN

  - IDX:  índice do slot (0..9), apenas informativo.
  - HH:MM: hora local 24h (horário de Brasília, UTC-3). Ex.: "07:00", "18:30".
  - DIAS: dias da semana em que o agendamento vale.
          "*" = todos os dias.
          Lista: dígitos separados por vírgula, 0=Domingo, 1=Segunda, ..., 6=Sábado.
          Ex.: "1,2,3,4,5" (apenas dias úteis).
  - ACAO: uma das três palavras maiúsculas: ESTADO | CMD | SETPOINT
          * ESTADO -> controla modo (true = AUTOMÁTICO, false = FORÇADO).
          * CMD    -> liga/desliga ventilador (true = LIGAR, false = DESLIGAR).
                     IMPORTANTE: para CMD surtir efeito, o controlador deve estar em modo FORÇADO (ESTADO = false).
                     Portanto, ao executar um CMD agendado, o firmware deve PRIMEIRO forçar ESTADO=false e depois aplicar o CMD.
          * SETPOINT -> ajusta o setpoint (°C, faixa 10..35, aceita 0.5 de resolução).
  - VALOR: para ESTADO/CMD = "true" ou "false"; para SETPOINT = número (ex.: "22" ou "22.5").
  - EN:   "1" = agendamento ativo, "0" = desativado. (Agendamentos desativados são omitidos pelo supervisório, mas pode chegar com EN=0 em alguns casos — ignore-os.)

Exemplo de payload com 3 agendamentos:
  0;07:00;1,2,3,4,5;CMD;true;1
  1;18:00;1,2,3,4,5;CMD;false;1
  2;22:00;*;SETPOINT;24;1

== O que o firmware ESP32 deve fazer ==

1. Assinar o tópico TJS/{DEVICE_ID}/SCHEDULE/SET com QoS 1. Como ele é retained, o broker já envia a última configuração assim que o ESP32 conectar.

2. Ao receber um payload:
   a) Fazer um parse robusto (ignorar linhas em branco e linhas malformadas, logar warning).
   b) Substituir COMPLETAMENTE a lista interna de agendamentos (não "mergear"). Se payload == "" -> zerar.
   c) Persistir a lista em memória não-volátil (NVS / Preferences / SPIFFS, à sua escolha) para sobreviver a reset / queda de rede.

3. Loop de verificação (a cada 1s é mais que suficiente): obter hora local atual (hora de Brasília, UTC-3). O ESP32 deve manter sincronismo via NTP (pool.ntp.org, fuso -03:00, sem DST). Para cada agendamento ativo cujo DIAS inclui o dia-da-semana atual, se a hora atual == HH:MM E ainda não foi executado nesse minuto, executar:
   - ESTADO -> publicar em TJS/{DEVICE_ID}/ESTADO/SET  o valor "true" ou "false" (retained=true).
   - CMD    -> publicar PRIMEIRO em TJS/{DEVICE_ID}/ESTADO/SET valor "false" (coloca em FORÇADO), aguardar 500ms, depois publicar em TJS/{DEVICE_ID}/CMD/SET  o valor "true"/"false" (retained=true).
   - SETPOINT -> publicar em TJS/{DEVICE_ID}/SETPOINT/SET  o número como string (retained=true), fazendo clamp 10..35.
   Marcar "já executado nesse minuto" para evitar re-trigger.

4. Caso o relógio NTP esteja perdido, NÃO executar agendamentos até sincronizar — logar warning a cada 60s.

5. Reconexão MQTT: ao reconectar, re-assinar SCHEDULE/SET (o retained resync tudo automaticamente). Não precisa salvar na flash se preferir — mas é recomendado para funcionar offline do broker.

6. (Opcional, bom para debug) Publicar em TJS/{DEVICE_ID}/SCHEDULE/STATE  (retained=true) um resumo da lista aplicada, no mesmo formato recebido. Serve para o supervisório confirmar que o ESP32 absorveu a configuração.

== Observações ==

- Tudo é plain text (sem JSON) para manter compatibilidade com o restante do firmware atual (TEMPERATURA, CMD/SET, etc. já são plain text).
- Payload vem como "retained": significa que o supervisório é a fonte da verdade — sempre que o usuário edita a programação, o backend publica novamente o payload completo. O ESP32 deve sempre aceitar como "estado total" e sobrescrever.
- Fuso horário fixo UTC-3 (Brasília), sem horário de verão.
- A faixa de setpoint é 10..35 °C (clamp).
- Mesmo com agendamento, comandos manuais vindos de CMD/SET continuam funcionando normalmente — eles só não resistirão ao próximo trigger agendado (que é o comportamento desejado).

Me devolva o código Arduino/ESP-IDF completo com:
- Parser do payload
- Persistência em NVS
- Loop de execução via millis()
- Sync NTP com UTC-3
- Logs via Serial

Mantenha o restante do firmware funcional (TEMPERATURA, CMD, ESTADO, SETPOINT, VAG etc.) — este é um ADD-ON à base de código existente.`;

export default function ProgramacaoHoraria() {
  const { user } = useAuth();
  const { data: fancoils = [] } = useQuery({
    queryKey: ["fancoils"],
    queryFn: async () => (await api.get("/fancoils")).data,
    refetchInterval: 60000,
  });
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState({});
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const canCommand = user?.role !== "viewer";

  const visibleFancoils = useMemo(() => {
    const act = fancoils.filter((f) => f.active !== false && f.authorized !== false);
    if (!filter) return act;
    const q = filter.toLowerCase();
    return act.filter((f) => f.name.toLowerCase().includes(q) || String(f.floor).includes(q));
  }, [fancoils, filter]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(ESP32_PROMPT);
      setCopied(true);
      toast.success("Prompt copiado para a área de transferência");
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      toast.error("Falha ao copiar — selecione manualmente");
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6" data-testid="programacao-horaria-page">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl font-black tracking-tight uppercase flex items-center gap-3">
          <Clock className="w-8 h-8 text-sky-400" /> Programação Horária
        </h1>
        <div className="text-muted-foreground text-sm mt-1">
          A programação é <b>enviada à controladora via MQTT</b> (tópico <code className="font-mono text-xs">SCHEDULE/SET</code>, retained).
          O ESP32 armazena e executa internamente — o backend não dispara mais os comandos no horário.
        </div>
      </div>

      <Card className="p-4 border-sky-500/30 bg-sky-500/5">
        <button
          data-testid="toggle-esp32-prompt"
          onClick={() => setShowPrompt((v) => !v)}
          className="w-full flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3">
            <Code className="w-5 h-5 text-sky-400" />
            <div>
              <div className="font-display font-bold text-sm uppercase tracking-wider text-sky-300">
                Prompt para ajustar o firmware ESP32
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Copie e cole no Claude (ou GPT) para gerar o patch da controladora e aceitar a programação enviada por esta tela.
              </div>
            </div>
          </div>
          {showPrompt ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>
        {showPrompt && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={copyPrompt}
                data-testid="copy-esp32-prompt"
                className="bg-sky-600 hover:bg-sky-500 text-white"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copiado!" : "Copiar prompt"}
              </Button>
            </div>
            <pre
              data-testid="esp32-prompt-text"
              className="font-mono text-[11px] leading-relaxed p-4 rounded border border-sky-500/20 bg-slate-900/60 text-slate-200 whitespace-pre-wrap max-h-[480px] overflow-auto"
            >
              {ESP32_PROMPT}
            </pre>
          </div>
        )}
      </Card>

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
