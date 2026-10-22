# CAG — contrato MQTT (NX-360 v1.15)

Prefixo `TJS`, "device" `CAG`.

| Tag | Equipamento |
|---|---|
| `CH1`, `CH2` | chillers parafuso (condensação a ar) |
| `VCH1`, `VCH2` | válvulas atuadas on/off na entrada de água de cada chiller |
| `BAP1`–`BAP3` | bombas primárias (BAP1→CH1, BAP2→CH2, BAP3 reserva) |
| `BAS1`–`BAS3` | bombas secundárias com inversor (BAS3 reserva) |

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
| `TJS/CAG/BAS<n>/VELOCIDADE` | % inversor |
| `TJS/CAG/VCH<n>/ABERTA` · `FECHADA` | fins de curso `1`/`0` (os dois `0` = em curso) |

## NX-360 → controladora/CLP (retidos)
| Tópico | Valor | Quando |
|---|---|---|
| `TJS/CAG/GERAL/MODO/SET` | `AUTO` / `MANUAL` | sempre |
| `TJS/CAG/GERAL/CMD/SET` | `true` partir / `false` parar a central | só em AUTO |
| `TJS/CAG/GERAL/LIDER/SET` | `CH1` / `CH2` | sempre (vale em AUTO) |
| `TJS/CAG/GERAL/SETPOINT/SET` | 5.0–12.0 °C | sempre |
| `TJS/CAG/GERAL/DP_SETPOINT/SET` | 20–300 kPa | sempre |
| `TJS/CAG/<EQ>/CMD/SET` | `true`/`false` (válvula: `true` = abrir) | só em MANUAL e com REMOTO=1 |

## Lógica esperada na controladora
- **AUTO**: ao partir, abre a VCH do líder → liga a primária dedicada (BAP3 se ela estiver em falha) → liga o chiller; liga 2 secundárias e controla a velocidade pela ΔP. Ao parar: chiller → espera → bomba e válvula. Líder em falha → assume o outro.
- **MANUAL**: executa os comandos individuais, mantendo os intertravamentos: chiller só liga com VCH aberta e primária rodando; VCH só fecha com o chiller parado.
- O NX-360 já bloqueia na tela os comandos que violam esses intertravamentos, mas a proteção definitiva é da controladora.

Sem controladora, ligue "Dados simulados" na tela da CAG (admin). Com a simulação ligada, mensagens reais de `TJS/CAG/...` são ignoradas.
