# Prompt para ajustar o firmware do ESP32 (NX-360 BMS — Programação Horária)

Este arquivo é a mesma mensagem que fica dentro da tela
`/ar-condicionado/programacao-horaria` (botão "Prompt para ajustar o firmware ESP32").
Guardado aqui para versionamento.

---

Preciso que você ajuste meu firmware ESP32 (controlador de fancoil) para que ele receba,
armazene e execute a programação horária enviada pelo supervisório **NX-360 BMS** via MQTT.

## Protocolo MQTT definido pelo supervisório

**Tópico (RECEIVE, assinatura obrigatória):**

```
TJS/{DEVICE_ID}/SCHEDULE/SET            (QoS 1, retained = true)
```

Onde `{DEVICE_ID}` é o ID atual do fancoil (ex.: `CE94`, `A100`, `2CB0` — o mesmo usado
nos tópicos TEMPERATURA, CMD/SET, ESTADO/SET, etc.).

**Payload:** texto puro (NÃO é JSON). Uma linha por agendamento. Linhas separadas por `\n`.
Payload vazio (`""`) significa "apagar TODOS os agendamentos deste dispositivo".

Formato de cada linha (6 campos separados por `;`):

```
IDX;HH:MM;DIAS;ACAO;VALOR;EN
```

- **IDX**: índice do slot (0..9), apenas informativo.
- **HH:MM**: hora local 24h (horário de Brasília, UTC-3). Ex.: `07:00`, `18:30`.
- **DIAS**: dias da semana em que o agendamento vale.
  - `*` = todos os dias.
  - Lista: dígitos separados por vírgula, `0=Domingo`, `1=Segunda`, …, `6=Sábado`.
  - Ex.: `1,2,3,4,5` (apenas dias úteis).
- **ACAO**: uma das três palavras maiúsculas: `ESTADO` | `CMD` | `SETPOINT`
  - `ESTADO` → modo (true = AUTOMÁTICO, false = FORÇADO).
  - `CMD` → ligar/desligar ventilador (true = LIGAR, false = DESLIGAR).
    > **IMPORTANTE**: para CMD surtir efeito, o controlador deve estar em modo FORÇADO
    > (`ESTADO = false`). Portanto, ao executar um CMD agendado, o firmware deve
    > PRIMEIRO forçar `ESTADO=false` e depois aplicar o CMD.
  - `SETPOINT` → ajusta o setpoint (°C, faixa 10..35, aceita 0.5 de resolução).
- **VALOR**: para `ESTADO`/`CMD` = `"true"` ou `"false"`; para `SETPOINT` = número.
- **EN**: `"1"` = ativo, `"0"` = desativado (o supervisório já filtra `0`, mas pode chegar — ignore).

### Exemplo de payload com 3 agendamentos

```
0;07:00;1,2,3,4,5;CMD;true;1
1;18:00;1,2,3,4,5;CMD;false;1
2;22:00;*;SETPOINT;24;1
```

## O que o firmware ESP32 deve fazer

1. **Assinar** `TJS/{DEVICE_ID}/SCHEDULE/SET` com QoS 1 (retained — o broker reenvia ao reconectar).
2. **Ao receber um payload**:
   - Parse robusto (ignorar linhas em branco/malformadas; logar warning).
   - **Substituir COMPLETAMENTE** a lista interna (sem merge). Payload vazio → zera.
   - Persistir em NVS/Preferences/SPIFFS.
3. **Loop de verificação** (a cada 1s): hora local Brasília (NTP, UTC-3, sem DST).
   Para cada agendamento ativo cujo DIAS inclui o dia atual, se `HH:MM` bate e ainda não executou nesse minuto:
   - `ESTADO` → publicar em `TJS/{DEVICE_ID}/ESTADO/SET` (`true`/`false`, retained).
   - `CMD` → publicar PRIMEIRO `ESTADO/SET=false`, aguardar 500ms, publicar `CMD/SET=<valor>` (retained).
   - `SETPOINT` → clamp 10..35, publicar `SETPOINT/SET=<num>` (retained).
   - Marcar "executado no minuto" para evitar re-trigger.
4. Sem NTP sincronizado, **não executar** agendamentos; logar warning a cada 60s.
5. Reconexão MQTT: re-assinar `SCHEDULE/SET` (retained resync).
6. (Opcional) Publicar em `TJS/{DEVICE_ID}/SCHEDULE/STATE` (retained) o resumo aplicado — serve de confirmação para o supervisório.

## Observações

- Tudo é plain text — não JSON (compatível com o restante do firmware atual).
- O retained significa que o supervisório é a **fonte da verdade**. Sempre sobrescreva o estado total.
- Fuso UTC-3, sem horário de verão.
- Setpoint em °C, faixa 10..35, resolução 0.5.
- Comandos manuais via `CMD/SET` continuam funcionando — só não resistem ao próximo trigger agendado.

Me devolva o código Arduino/ESP-IDF completo com:
- Parser do payload
- Persistência em NVS
- Loop via `millis()`
- Sync NTP UTC-3
- Logs via Serial

Mantenha o restante do firmware funcional (TEMPERATURA, CMD, ESTADO, SETPOINT, VAG…) — este é um **ADD-ON** à base de código existente.
