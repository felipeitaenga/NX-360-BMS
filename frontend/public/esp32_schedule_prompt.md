# Prompt para o firmware do ESP32 (NX-360 BMS — protocolo v1.4.x)

Preciso que você ajuste meu firmware ESP32 (controlador de fancoil) para o protocolo MQTT do
supervisório **NX-360 BMS** descrito abaixo. Mantenha o restante do firmware funcional.

## 1. Regra geral: COMANDO × ESTADO REAL

- Tópicos terminados em **`/SET`** são **escritos SOMENTE pelo supervisório** (comando/solicitação).
  A controladora **assina** esses tópicos e **NUNCA publica / ecoa** em `/SET`.
- A controladora publica o **estado real** (o que ela realmente aplicou) em tópicos **sem `/SET`**,
  sempre com **retain = true**, logo após cada mudança e no boot/reconexão.

Prefixo: `TJS/{DEVICE_ID}/...` (ex.: `TJS/3054/CMD`). Payloads em texto puro (não JSON).

### Assinados pela controladora (escritos pelo supervisório)

| Tópico | Payload | Observação |
|---|---|---|
| `CMD/SET` | `true` / `false` | Ligar/desligar — só tem efeito em FORÇADO |
| `ESTADO/SET` | `true` / `false` | `true` = AUTOMÁTICO, `false` = FORÇADO |
| `SETPOINT/SET` | número 10..35 (0.5) | °C |
| `PRESSAO/SET` | número 0..100 | % aplicado na AO2 |
| `SCHEDULE/SET` | lista de agendamentos (retido) | ver seção 3 |
| `OTA/SET` | `VERSAO;URL;MD5` (**NÃO retido**) | ver seção 4 |

### Publicados pela controladora (retain = true)

| Tópico | Payload | Quando |
|---|---|---|
| `CMD` | `true` / `false` | estado REAL do relé, a cada mudança |
| `ESTADO` | `true` / `false` | modo REAL (`true` = AUTOMÁTICO), a cada mudança |
| `PRESSAO` | número 0..100 | % realmente aplicado na AO2 |
| `ONLINE`, `STATUS`, `MODO`, `TEMPERATURA`, `VAG` | (inalterados) | como hoje |
| `VERSAO` | ex.: `1.4.0` | no boot / ao conectar |
| `RESET` | motivo do último reinício, ex.: `SW / MQTT_SEM_CONEXAO`, `BROWNOUT / BOOTLOOP 3 / RELE_BLOQUEADO` | no boot |
| `RSSI` | dBm (inteiro, ex.: `-63`) | a cada 60 s |
| `UPTIME` | minutos desde o boot (inteiro) | a cada 60 s |
| `OTA/STATE` | `baixando 1.4.1` / `ok 1.4.1 reiniciando` / `erro: ...` / `ignorado: ...` / `rollback` | durante o OTA |
| `SCHEDULE/STATE` | (opcional) payload de agenda aplicado | após aplicar SCHEDULE/SET |

O supervisório gera alarme crítico se `RESET` contiver `BOOTLOOP` ou `RELE_BLOQUEADO`, e alarme
de aviso se `RSSI` ficar abaixo de -80 dBm por mais de 30 min.

## 2. Modos (ESTADO)

- **FORÇADO (`ESTADO=false`)**: obedece SOMENTE ao `CMD/SET` manual. A programação de `CMD` é ignorada.
  Permanece FORÇADO até receber `ESTADO/SET=true` (manual ou agendamento `ESTADO`).
- **AUTOMÁTICO (`ESTADO=true`)**: segue a programação horária de `CMD` pelo conceito de **estado esperado**.
  `CMD/SET` recebido em AUTOMÁTICO é ignorado (log de aviso).
- Um `CMD` agendado **NUNCA** muda o modo para FORÇADO.
- Após qualquer mudança de modo ou relé, publicar `ESTADO` e `CMD` reais (retidos).

## 3. Programação horária — `TJS/{DEVICE_ID}/SCHEDULE/SET` (QoS 1, retido)

Uma linha por agendamento, separadas por `\n`. Payload vazio = apagar todos.

```
IDX;HH:MM;DIAS;ACAO;VALOR;EN
0;07:00;1,2,3,4,5;CMD;true;1
1;18:00;1,2,3,4,5;CMD;false;1
2;22:00;*;SETPOINT;24;1
```

- HH:MM local (UTC-3). DIAS: `*` ou `0=Dom..6=Sáb`. ACAO: `ESTADO` | `CMD` | `SETPOINT`. EN `0` = ignorar.
- Ao receber: parse robusto, **substituir** a lista, salvar em NVS e, se em AUTOMÁTICO, reavaliar na hora.

### `calcExpectedCmd()` (estado esperado em AUTOMÁTICO)
1. Considerar só linhas ativas `ACAO=CMD` cujo DIAS inclui hoje e `HH:MM <= agora`.
2. Estado esperado = VALOR da linha de **maior HH:MM**.
3. Sem nenhum gatilho de CMD hoje até agora (ou sem linhas CMD) → **DESLIGADO**. Não herdar do dia anterior.

### Loop (a cada 1 s, via `millis()`, só com NTP sincronizado)
- Em AUTOMÁTICO: se `calcExpectedCmd()` ≠ relé atual → aplicar e publicar `CMD` real (retido).
  Cobre gatilhos, reboot, retorno de energia e virada do dia.
- Agendamentos `ESTADO` (no minuto exato, 1×/min): aplicar o modo e publicar `ESTADO` real;
  se virou AUTOMÁTICO, reavaliar o CMD imediatamente.
- Agendamentos `SETPOINT` (no minuto exato, qualquer modo): clamp 10..35 e aplicar.
- Ao receber `ESTADO/SET=true`: entrar em AUTOMÁTICO e aplicar `calcExpectedCmd()` **na hora**.
- Sem NTP: não alterar CMD pela programação (log a cada 60 s).
- Boot: restaurar lista e modo da NVS; após NTP, reavaliar.

## 4. OTA remoto — `TJS/{DEVICE_ID}/OTA/SET` (NÃO retido)

Payload: `VERSAO;URL;MD5` — ex.: `1.4.1;https://.../api/firmware/files/<token>/fw.bin;9e107d9d372bb6826bd81d3542a419d6`

1. Se `VERSAO` == versão atual → publicar `OTA/STATE = ignorado: mesma versão` e não fazer nada.
2. Publicar `OTA/STATE = baixando <versao>`; baixar via HTTPS (Update.h/HTTPUpdate), conferindo o MD5.
3. O fancoil **continua operando** durante o download.
4. Sucesso → `OTA/STATE = ok <versao> reiniciando` e reiniciar. No boot publicar `VERSAO` nova e `RESET`.
5. Falha → `OTA/STATE = erro: <motivo>` (MD5, HTTP, espaço…) e continuar na versão atual.
6. Se a nova versão não validar (ex.: não conectar ao MQTT em X min) → rollback para a partição anterior e
   publicar `OTA/STATE = rollback` após reconectar.

O supervisório envia o OTA para uma controladora por vez e só segue para a próxima quando recebe
`VERSAO` igual à enviada (ou pausa ao receber `erro`/`rollback`, ou após 10 min sem resposta).

## Entrega

Devolva o código Arduino/ESP-IDF completo com: parser de agenda + NVS, `calcExpectedCmd()`, handlers
de `ESTADO/SET`, `CMD/SET`, `SETPOINT/SET`, `PRESSAO/SET`, `OTA/SET`, publicação dos estados reais
(retidos) e de `VERSAO`/`RESET`/`RSSI`/`UPTIME`/`OTA/STATE`, loop via `millis()`, NTP UTC-3 e logs via Serial.
