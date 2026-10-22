# Hidráulica — contrato MQTT (NX-360 v1.16.1)

Prefixo `TJS`, "device" `HID`. Nível dos reservatórios **só por boias** (3 níveis).

| Sistema | Reservatórios | Bombas |
|---|---|---|
| `POT` água potável | `CIS` cisterna/inferior, `SUP` superior | `BR1`, `BR2` (recalque) |
| `ESG` esgoto | `POCO` poço de esgoto | `BE1`, `BE2` (submersas) |
| `PLU` pluviais/reúso | `CAP` captação, `REU` reúso | `BP1`, `BP2` |## As 3 boias de cada reservatório
- **Boia 1 (baixa)**: alarme / proteção
- **Boia 2 (média)**: controle da bomba — usar boia **pendular** (faixa liga/desliga pelo comprimento do cabo) e tempo mínimo ligada/desligada na controladora
- **Boia 3 (alta)**: alarme

| Tipo | Reservatórios | Boia 1 desacionada | Boia 2 | Boia 3 acionada |
|---|---|---|---|---|
| ABASTECIDO (a bomba enche) | SUP, REU | alarme NÍVEL BAIXO — bomba não está repondo | abaixo liga · acima desliga | alarme NÍVEL ALTO — bomba não desligou |
| FONTE (a bomba tira) | CIS, CAP | bloqueia as bombas (seco) + alarme | só indicação | alarme EXTRAVASANDO |
| ESGOTAMENTO (a bomba esvazia) | POCO | desliga a bomba (submersa coberta); se seguir ligada → alarme | acima liga · abaixo desliga | liga a 2ª bomba + alarme NÍVEL ALTO |

Nível exibido: BAIXO (boia 1 desacionada) · NORMAL (entre 1 e 3) · ALTO (boia 3) · FALHA BOIA (combinação impossível, ex.: boia 3 acionada com a 1 desacionada).

Bomba sem vazão: ligada há mais de 20 min sem a boia 2 mudar → alarme e, em AUTO, a próxima partida usa a bomba reserva.



## Controladora → NX-360 (retidos)
| Tópico | Valor |
|---|---|
| `TJS/HID/ONLINE` | `1`/`0` (LWT) |
| `TJS/HID/<TANQUE>/BOIA_BAIXA` · `BOIA_MEDIA` · `BOIA_ALTA` | `1` acionada / `0` |
| `TJS/HID/<BOMBA>/STATUS` · `FALHA` · `REMOTO` | `1`/`0` |
| `TJS/HID/<BOMBA>/HORAS` | horímetro (h) |
| `TJS/HID/<SISTEMA>/MODO` | `AUTO` / `MANUAL` |

## NX-360 → controladora (retidos)
| Tópico | Valor | Quando |
|---|---|---|
| `TJS/HID/<SISTEMA>/MODO/SET` | `AUTO` / `MANUAL` | sempre |
| `TJS/HID/<BOMBA>/CMD/SET` | `true` / `false` | só em MANUAL e REMOTO=1 |

## Lógica esperada na controladora (AUTO)
Conforme a tabela acima, com rodízio das bombas a cada partida e troca para a reserva em caso de falha.

## Alarmes no NX-360
Nível baixo, nível alto, falha de boia, falha de bomba e bomba sem vazão — com a mensagem do motivo conforme o tipo do reservatório.

Sem controladora, ligue "Dados simulados" na Visão geral da Hidráulica (admin).
