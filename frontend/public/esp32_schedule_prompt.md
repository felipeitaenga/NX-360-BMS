# Prompt para ajustar o firmware do ESP32 (NX-360 BMS — Programação Horária v2 "estado esperado")

Preciso que você ajuste meu firmware ESP32 (controlador de fancoil) para que ele receba,
armazene e execute a programação horária enviada pelo supervisório **NX-360 BMS** via MQTT.

> ATENÇÃO — MUDANÇA DE LÓGICA EM RELAÇÃO À VERSÃO ANTERIOR:
> - Um `CMD` agendado **NÃO deve mais forçar `ESTADO=false`**. A programação só atua em modo AUTOMÁTICO.
> - A programação deixa de ser apenas "gatilho no minuto exato" e passa a ser **estado esperado**:
>   em AUTOMÁTICO o firmware calcula continuamente se o fancoil deveria estar LIGADO ou DESLIGADO.

## Protocolo MQTT (inalterado)

**Tópico (RECEIVE, assinatura obrigatória):**

```
TJS/{DEVICE_ID}/SCHEDULE/SET            (QoS 1, retained = true)
```

`{DEVICE_ID}` é o ID atual do fancoil (ex.: `CE94`, `A100`, `2CB0`).

**Payload:** texto puro (NÃO é JSON). Uma linha por agendamento, separadas por `\n`.
Payload vazio (`""`) = apagar TODOS os agendamentos.

Formato de cada linha (6 campos separados por `;`):

```
IDX;HH:MM;DIAS;ACAO;VALOR;EN
```

- **IDX**: índice do slot (0..9), apenas informativo.
- **HH:MM**: hora local 24h (Brasília, UTC-3).
- **DIAS**: `*` = todos os dias, ou lista `0=Dom,1=Seg,…,6=Sáb` separada por vírgula (ex.: `1,2,3,4,5`).
- **ACAO**: `ESTADO` | `CMD` | `SETPOINT`
  - `ESTADO` → modo (`true` = AUTOMÁTICO, `false` = FORÇADO).
  - `CMD` → ventilador (`true` = LIGAR, `false` = DESLIGAR).
  - `SETPOINT` → °C, faixa 10..35, resolução 0.5.
- **VALOR**: `true`/`false` para ESTADO/CMD; número para SETPOINT.
- **EN**: `1` ativo, `0` desativado (ignorar `0`).

Exemplo:

```
0;07:00;1,2,3,4,5;CMD;true;1
1;18:00;1,2,3,4,5;CMD;false;1
2;22:00;*;SETPOINT;24;1
```

## Regras de modo (IMPORTANTE)

- **ESTADO = false (FORÇADO / manual)**: o fancoil obedece SOMENTE ao `CMD/SET` manual vindo do supervisório.
  A programação de `CMD` é **ignorada** enquanto estiver em FORÇADO.
  O FORÇADO **permanece indefinidamente** até alguém mudar para AUTOMÁTICO (manualmente ou por um agendamento `ESTADO=true`).
- **ESTADO = true (AUTOMÁTICO)**: o fancoil segue a programação horária de `CMD` pelo conceito de **estado esperado**.

## Cálculo do "estado esperado" de CMD (função `calcExpectedCmd()`)

1. Considere apenas as linhas ativas com `ACAO = CMD`.
2. Para o **dia atual**, pegue as linhas cujo DIAS inclui hoje e cujo `HH:MM <= hora atual`.
3. Se houver alguma, o estado esperado = VALOR da linha com o **maior HH:MM** (o último gatilho já ocorrido hoje).
4. Se **não houver** nenhum gatilho de CMD até agora no dia atual (inclusive se não houver nenhum agendamento para hoje),
   o estado esperado é **DESLIGADO (false)**.
   (Não herdar do dia anterior — antes do primeiro horário do dia, o equipamento fica desligado.)
5. Se não existir NENHUMA linha CMD na lista inteira → estado esperado = **DESLIGADO (false)**.

## O que o firmware deve fazer

1. **Assinar** `TJS/{DEVICE_ID}/SCHEDULE/SET` com QoS 1 (retained — o broker reenvia ao reconectar).
2. **Ao receber o payload**: parse robusto (ignorar linhas malformadas com warning), **substituir completamente**
   a lista interna (sem merge), persistir em NVS/Preferences. Depois, se estiver em AUTOMÁTICO, **reavaliar imediatamente** (passo 4).
3. **Ao receber `ESTADO/SET`**:
   - `false` → entrar em FORÇADO, manter o CMD atual, passar a obedecer apenas CMD manual.
   - `true` → entrar em AUTOMÁTICO e **imediatamente** executar `calcExpectedCmd()` e aplicar o resultado
     (ex.: estava desligado em FORÇADO, horário atual está dentro de um período LIGADO → liga na hora).
4. **Loop a cada 1s** (via `millis()`), apenas se NTP sincronizado:
   - Se em AUTOMÁTICO: calcular `calcExpectedCmd()`; se diferente do estado atual do ventilador,
     aplicar e publicar `TJS/{DEVICE_ID}/CMD/SET = true|false` (retained) para o supervisório refletir.
     (Isso cobre gatilhos no minuto exato, retorno de energia, reboot e virada de dia.)
   - Agendamentos `ESTADO` (no minuto exato, uma vez por minuto): publicar `TJS/{DEVICE_ID}/ESTADO/SET` (retained)
     e aplicar a regra do passo 3 (se for `true`, reavaliar o CMD imediatamente).
   - Agendamentos `SETPOINT` (no minuto exato, uma vez por minuto, em qualquer modo): clamp 10..35,
     publicar `TJS/{DEVICE_ID}/SETPOINT/SET` (retained).
   - Marcar "executado neste minuto" para ESTADO/SETPOINT para evitar re-trigger.
5. **Boot / reconexão**: restaurar lista e modo (ESTADO) da NVS; ao obter NTP, se em AUTOMÁTICO, reavaliar imediatamente.
   Re-assinar `SCHEDULE/SET` ao reconectar.
6. Sem NTP sincronizado: **não** alterar CMD pela programação; logar warning a cada 60s.
7. **CMD/SET manual recebido enquanto em AUTOMÁTICO**: ignorar (logar warning) — o supervisório só permite
   comando manual em FORÇADO. Exceção: mensagens CMD/SET que o próprio firmware publicou (eco) devem ser ignoradas sem warning.
8. (Opcional) Publicar em `TJS/{DEVICE_ID}/SCHEDULE/STATE` (retained) o payload aplicado — confirmação para o supervisório.

## Observações

- Tudo plain text — não JSON. Fuso UTC-3, sem horário de verão.
- O supervisório é a fonte da verdade da lista de agendamentos (retained, sempre sobrescreve).
- Os tópicos de leitura atuais (ONLINE, STATUS, MODO, TEMPERATURA, VAG) continuam iguais;
  `MODO` deve refletir o ESTADO atual (`1` = AUTOMÁTICO, `0` = FORÇADO) logo após cada mudança.

Me devolva o código Arduino/ESP-IDF completo com:
- Parser do payload + persistência em NVS (lista e modo)
- Função `calcExpectedCmd()` conforme as regras acima
- Handler de `ESTADO/SET` com reavaliação imediata ao voltar para AUTOMÁTICO
- Loop via `millis()`, sync NTP UTC-3, logs via Serial

Mantenha o restante do firmware funcional (TEMPERATURA, CMD, ESTADO, SETPOINT, VAG…) — este é um ajuste no ADD-ON de programação existente.
