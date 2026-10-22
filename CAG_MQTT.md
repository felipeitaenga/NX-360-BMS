# CAG — contrato MQTT (NX-360 v1.17)

Prefixo `TJS`, "device" `CAG`.

| Tag | Equipamento |
|---|---|
| `CH1`, `CH2` | chillers parafuso (condensação a ar) |
| `VCH1`, `VCH2` | válvulas atuadas on/off na entrada de água de cada chiller |
| `BAP1`–`BAP3` | bombas primárias (BAP1→CH1, BAP2→CH2, BAP3 reserva) |
| `BAS1`–`BAS3` | bombas secundárias com inversor (BAS1→CH1, BAS2→CH2, BAS3 reserva) |

## Controladora/CLP → NX-360 (retidos)
| Tópico | Valor |
|---|---|
| `TJS/CAG/ONLINE` | `1`/`0` (LWT) |
| `TJS/CAG/GERAL/MODO` | `AUTO` / `MANUAL` |
| `TJS/CAG/GERAL/CENTRAL` | `1` central em operação / `0` parada |
| `TJS/CAG/GERAL/LIDER` | `CH1` / `CH2` |
| `TJS/CAG/GERAL/TEMP_IDA` · `TEMP_RETORNO` | °C |
| `TJS/CAG/GERAL/DP` | kPa pressão diferencial do secundário |
| `TJS/CAG/GERAL/SETPOINT` · `DP_SETPOINT` | setpoints em uso |
| `TJS/CAG/<CH/BAP/BAS>/STATUS` | `1` rodando / `0` parado |
| `TJS/CAG/<EQ>/FALHA` | `1`/`0` |
| `TJS/CAG/<EQ>/REMOTO` | `1` aceita comando do BMS / `0` local |
| `TJS/CAG/<CH/BAP/BAS>/HORAS` | horímetro (h) |
| `TJS/CAG/CH<n>/TEMP_SAIDA` · `TEMP_ENTRADA` · `CARGA` | °C, °C, % |
| `TJS/CAG/CH<n>/SETPOINT` | °C setpoint de água gelada em uso no chiller (confirma o SET) |
| `TJS/CAG/BAS<n>/VELOCIDADE` | % inversor |
| `TJS/CAG/VCH<n>/ABERTA` · `FECHADA` | fins de curso `1`/`0` (os dois `0` = em curso) |

## NX-360 → controladora/CLP (retidos)
| Tópico | Valor | Quando |
|---|---|---|
| `TJS/CAG/GERAL/MODO/SET` | `AUTO` / `MANUAL` | sempre |
| `TJS/CAG/GERAL/LIDER/SET` | `CH1` / `CH2` | sempre (vale em AUTO) |
| `TJS/CAG/GERAL/SETPOINT/SET` | 5.0–12.0 °C | sempre (o NX-360 também publica o mesmo valor em `CH1` e `CH2/SETPOINT/SET`) |
| `TJS/CAG/CH<n>/SETPOINT/SET` | 5.0–12.0 °C setpoint individual do chiller | sempre |
| `TJS/CAG/GERAL/DP_SETPOINT/SET` | 20–300 kPa | sempre |
| `TJS/CAG/<EQ>/CMD/SET` | `true`/`false` (válvula: `true` = abrir) | MANUAL (operador) e AUTO (sequenciador do NX-360), com REMOTO=1 |

## Sequenciamento (v1.17 — feito pelo NX-360)
Em **AUTO** quem faz a sequência é o NX-360, publicando `<EQ>/CMD/SET` etapa por etapa. A controladora só executa
os comandos e mantém os intertravamentos de segurança.

Cada chiller é uma linha: `CHn = VCHn + BAPn + BASn` (BAP3/BAS3 entram se a dedicada estiver em falha/local).

- **Partida**: abre VCHn → espera (padrão 60 s) → liga BAP → espera → liga BAS → espera → liga CHn.
  Cada etapa só avança com a confirmação da anterior (ABERTA / STATUS=1); sem confirmação em espera + 120 s → falha da linha.
- **Parada**: desliga CHn → espera → BAS → espera → BAP → espera → fecha VCHn.
- **Falha** de equipamento em uso ou chiller que desarma → a linha para (sequência de parada) e o outro chiller assume.
  A linha fica bloqueada até "Rearmar linha" na tela de comandos.
- **Troca de líder** (alternância à meia-noite ou manual): o novo líder parte e o antigo só para quando o novo estiver rodando.
- Tempos de espera configuráveis em CAG → Programação horária (5 a 900 s).

## Programação horária da CAG
- **Geral**: dentro dos períodos a central fica em operação com o chiller líder; fora, para.
- **Alternância diária**: dia par CH1, dia ímpar CH2 (data ordinal), troca à meia-noite.
- **Horário de pico**: liga o 2º chiller junto (só dentro do período geral).
- Partir/Parar e Ligar/Desligar 2º chiller manuais valem até a próxima mudança de horário.
- Só atua com a central em AUTO.

## MANUAL
Executa os comandos individuais, mantendo os intertravamentos: chiller só liga com VCH aberta e primária rodando;
VCH só fecha com o chiller parado. O NX-360 bloqueia na tela os comandos que violam isso, mas a proteção definitiva é da controladora.

Sem controladora, ligue "Dados simulados" na tela da CAG (admin). Com a simulação ligada, mensagens reais de `TJS/CAG/...` são ignoradas.
