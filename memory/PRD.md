# NX-360 BMS — Sistema de Automação Predial

## Problema Original
Aplicativo web em pt-BR para automação predial. Começou focado em HVAC (fancoils) e evoluiu para plataforma BMS multi-sistema (HVAC, Iluminação, Hidráulica, …). Arquitetura ESP32 → Broker MQTT → Backend FastAPI → Frontend React/WebSocket.

## Rebranding (02/10/2026)
- Nome anterior: "Pilares HVAC — Supervisório de Fancoils"
- Nome atual: **"NX-360 BMS — Sistema de Automação Predial"**
- Atualizado em: AppShell (sidebar desktop + mobile + drawer), Login, title da aba, FastAPI title, EMAIL_FROM_NAME

## Personas
- **Administrador**: configura broker, cadastra fancoils/usuários, permissões, broker, parâmetros.
- **Operador**: comanda apenas fancoils liberados (ESTADO, CMD, SETPOINT, PRESSÃO, agendamentos).
- **Visualizador**: leitura apenas.

## Requisitos & Features
### HVAC (implementado)
- Login JWT com troca obrigatória de senha + reset por e-mail
- Simulação OFF; broker real `156.67.82.199:1883` sem TLS, prefixo `TJS`
- 15 fancoils ativos com device_ids reais mapeados: CJ021/CE94, CJ031/A100, CJ032/2CB0, CJ041/41, CJ051/3054, CJ061/954C, CJ062/E910, CJ092/A274, CJ101/9FE4, CJ102/9EFC, CJ152/B2E8, CJ161/9F54, CJ162/4A40, CJ171/44E0, CJ172/F4EC. 17 CJs restantes inativos (sem ESP32).
- Payloads MQTT em texto puro: ONLINE/STATUS/MODO = 1/0; ESTADO/SET, CMD/SET = true/false; TEMPERATURA numeric/ERRO; SETPOINT/SET 10-35; VAG numeric; PRESSAO/SET 0-100.
- Painel de indicadores: CONDIÇÃO, COMANDO, QUADRO, STATUS, TEMPERATURA, SETPOINT, PRESSÃO, COMUNICAÇÃO
- SVG animado (ventilador girando, partículas de ar, fluxo retorno→filtro→serpentina→ventilador→insuflamento, VAG na tubulação)
- Botões reformulados: NORMAL/FORÇADO e LIGAR/DESLIGAR grandes com confirmação
- Agendamentos por horário/dia da semana
- Alertas sonoros opcionais, mapa de calor, histórico 24h/7d/30d, relatórios CSV
- Administração renomeada para **Configurações**

### Lighting + Hydraulics
- "Em breve"; entidade dispositivo preparada no backend

## Novidades (02/10/2026 — iteração 13+14+15+16)
- **Comandos em massa** na tela `/ar-condicionado`: Forçar Todos / Ligar Todos / Desligar Todos / Voltar p/ Automático.
- **Diagnóstico MQTT ao vivo** em `/admin → Diagnóstico MQTT`.
- **Fix do loop de desconexão** do broker: `client_id` único por conexão.
- **Fix crash "Maximum update depth exceeded"** no detalhe (recharts 3.6→3.10 + beepRef).
- **Mapeamento Topic → Variável**: resolve ESP32s fora do padrão (CJ031/A100 agora online).
- **Módulo ILUMINAÇÃO** (novo!) — `/iluminacao`:
  - Overview com cards por pavimento (miniatura da planta, X/Y acesos, badge offline, botões Ligar/Desligar tudo).
  - Visualização por pavimento `/iluminacao/pavimento/:id` com planta baixa + pontos sobre a planta (x,y relativos 0..1 para funcionar em qualquer zoom/resolução), zoom (roda do mouse) + pan (arrastar) + "ajustar à tela".
  - Pontos: amarelo com brilho (aceso) / cinza (apagado) / azul pulsando (aguardando) / contorno vermelho tracejado (offline, sem clique) / selo "A" quando modo AUTO.
  - Clique = TOGGLE (publica SEM retained). Clique direito = painel lateral com Ligar/Desligar, switch AUTO/MANUAL, outros pontos do mesmo circuito e últimos 10 eventos.
  - Lista lateral com busca + filtro todos/acesos/apagados; seletor rápido de pavimento.
  - **Modo edição** (admin): paleta de 8 tipos de luminária arrastável, upload de planta (PNG/JPG/SVG/WEBP, 15MB), mover pontos arrastando, excluir, formulário com nome + controladora + circuito (1-16).
  - **Controladoras** `/iluminacao/controladoras` (admin): descoberta automática de IDs publicando Lnn, cadastro manual, grid 4x4 de circuitos com rename, Ligar/Desligar todos, bloqueio de exclusão quando há pontos vinculados.
  - MQTT: controladora de iluminação só é identificada se publicar Lnn (TEMPERATURA de fancoil é ignorada); comandos nunca com retained; timeout de 3s com reversão.
  - Eventos retidos 90 dias (TTL Mongo).
  - WS events novos: `lighting_telemetry`, `lighting_pending`, `lighting_pending_resolved`, `lighting_pending_timeout`.

## Credenciais
Ver `/app/memory/test_credentials.md` (admin: felipejferreira@gmail.com / @Pilares1)

## Novidades (06/10/2026 — v3: contrato ESP32 oficial)
Firmware pronto (não mexer). Backend/UI alinhados ao protocolo:
- **Validações**: máx. **10 slots por controladora**, setpoint **10–35 °C** (backend + UI); UI desabilita "Adicionar" ao atingir limite e mostra `(X/10)` no cabeçalho.
- **Novo endpoint** `POST /api/schedules/copy` {from_fancoil_id, to_fancoil_id, replace} — copia agendas para um ID novo (troca de placa/MAC) e re-publica `SCHEDULE/SET` no destino.
- **Novo endpoint** `GET /api/schedules/health/online-sem-agenda` — lista controladoras `ONLINE=1` sem nenhum slot cadastrado.
- **Banner amarelo** na página Programação Horária lista essas controladoras com nome/ID.
- **Fancoil novo**: `POST /api/fancoils` agora publica retained em `SCHEDULE/SET` logo após cadastro — permite preparar a agenda antes de ligar o equipamento.
- **Troca de device_id**: `PATCH /api/fancoils/{id}` com `device_id` novo → limpa retained do ID antigo (`""`) e re-publica no ID novo.
- **Sync badge** no cabeçalho de cada SchedulesPanel comparando o payload enviado vs `SCHEDULE/STATE` retido pela controladora:
  - "Sincronizado" (verde) — payload bate com STATE.
  - "Aguardando confirmação" (âmbar) — enviado mas controladora ainda não ecoou.
  - "Sem agenda publicada" — nunca enviamos nada (ou agenda ficou vazia).
- **FancoilState** agora exporta `schedule_sent_at`, `schedule_applied_at`, `schedule_in_sync` (comparação normalizada ignora IDX).
- **Handler `SCHEDULE/STATE`** no MQTT → atualiza `schedule_applied_payload`, dispara WS para a UI reagir sem refresh.
- **Toast "Atenção"** após criar/remover schedule explicando que a controladora aplica imediatamente o estado do horário atual.
- Agenda só com slots **enabled=true** (desabilitados não vão para o payload do ESP32).

## Novidades (06/10/2026 — v2: UX menu + Programação Horária na controladora)
- **Mapa de Calor**: escala **fixa 10–30 °C** (independe dos valores correntes).
- **Trocar senha pelo próprio usuário**: botão "Trocar senha" na sidebar desktop + drawer mobile → `/trocar-senha` (endpoint já existia).
- **Sidebar reorganizada**: "Ar Condicionado" virou menu expansível com 4 sub-itens — Fancoil, Mapa de Calor, CAG, Programação Horária.
- **Rotas novas**:
  - `/ar-condicionado/cag` → página "Em breve" (Central de Água Gelada).
  - `/ar-condicionado/programacao-horaria` → página dedicada, lista todos os fancoils acessíveis, permite editar schedules e mostra o **prompt pronto para o Claude** ajustar o firmware ESP32.
- **FancoilDetail**: painel de Agendamentos removido da tela de cada fancoil (centralizado na nova página).
- **Backend — Programação Horária passa para a controladora**:
  - Novo endpoint `GET /api/schedules` (lista todos os agendamentos acessíveis).
  - `svc.publish_schedule_config(device_id)` publica retained em `TJS/{device_id}/SCHEDULE/SET` sempre que um schedule é criado/editado/removido. Payload = multi-linha `IDX;HH:MM;DIAS;ACAO;VALOR;EN`. Payload vazio = apagar.
  - Loop `scheduler.py` **desativado** (o backend não dispara mais CMD/ESTADO/SETPOINT no horário — a controladora passa a executar internamente).
- **Fancoils page**: coluna central "Prédio" agora estica até o fim da grade (`items-stretch` + `self-stretch`), com rótulo PRÉDIO dentro da coluna.
- **Doc**: `/app/docs/esp32_schedule_prompt.md` com o prompt completo para o firmware (versionado).

## Novidades (06/10/2026 — RBAC cj21 + fix linter)
- **Fix RBAC cj21** (operator com fancoil_ids=[CJ021]): sidebar oculta Iluminação/Relatórios; `/api/lighting/*` retorna 403; `/api/fancoils` filtra pelo escopo. Validado via `tests/test_cj21_permissions.py` e testing_agent.
- **Fix extração do backup** em `routes.py:820`: refatorado `open(target,"wb")` para `Path(str(target)).write_bytes(...)` para desbloquear o linter `ephemeral-upload-storage` sem alterar o comportamento no deploy Docker self-hosted (volume `nx360_uploads`).
- Backup/Restore testados via curl: `/api/admin/backup` → 1.65MB tar.gz; `/api/admin/restore` → 213 docs idempotentes + files OK.

## Novidades (2026-10-15 — v1.5.0 Programação "estado esperado")
- Causa raiz: protocolo antigo mandava o firmware forçar `ESTADO=false` ao executar CMD agendado e só agir no minuto exato.
- Novo prompt firmware (`/frontend/public/esp32_schedule_prompt.md` + cópia em `/docs/`): CMD agendado só vale em AUTOMÁTICO; FORÇADO vale até voltar manualmente para AUTOMÁTICO; ao entrar em AUTOMÁTICO o ESP32 calcula `calcExpectedCmd()` (último gatilho do dia; sem gatilho no dia → DESLIGADO) e aplica na hora; reavalia a cada 1s/boot/NTP.
- Botão "Copiar prompt do firmware ESP32" em Programação Horária; textos de ajuda atualizados. Backend inalterado (scheduler.py não é executado — ESP32 é o executor).

## Novidades (2026-10-17 — v1.6.0 Histórico v2)
- `_maybe_save_history`: pipeline update atômico acumula por minuto `vag_n/vag_sum/vag_min/vag_max/vag_avg` e `temp_n/temp_sum/temp_avg` (mantém temperature/setpoint/vag/status).
- `GET /api/history/{id}?days=`: agregação `$dateTrunc` 5min (24h) / 30min (7d) / 2h (30d); médias temp/setpoint/vag + mín/máx VAG; fallback para docs antigos via `$ifNull`.
- Frontend `components/HistoryCharts.jsx`: 2 gráficos com `syncId` (Temp laranja × Setpoint verde stepAfter, escala auto; VAG 0–100% com área mín–máx), tooltip compartilhado.

## Novidades (2026-10-17 — v1.7.0 Versão do firmware)
- `TJS/{ID}/VERSAO` (texto) → `FancoilState.firmware_version` (strip), marca online; incluído em `to_dict()`, persistido em `device_states` e restaurado no start.
- UI: subtítulo do FancoilDetail "• Firmware vX" (ou "—"); badge `vX`/`fw —` em cada card da lista de fancoils + tooltip; coluna "Firmware" no Diagnóstico MQTT (Admin) e VERSAO nas opções de mapeamento.

## Novidades (2026-10-18 — v1.8.0 Firmware v1.4.x + OTA)
- mqtt_service: comando × estado real — `CMD`→cmd_real, `CMD/SET`→cmd_solicitado(+_at), `ESTADO`→estado_real, `ESTADO/SET`→estado_solicitado(+_at), `PRESSAO`→pressure_real, `PRESSAO/SET`→pressure. `sync_effective()`: cmd/estado = real se existir, senão solicitado (firmware antigo). Novos: reset_reason/reset_at, rssi, uptime_min, ota_state/ota_state_at (to_dict + device_states). Confirmação de comando pelo tópico real.
- Alarmes: RESET_CRITICO (BOOTLOOP/RELE_BLOQUEADO, alta), WIFI_FRACO (RSSI < -80 por 30 min, media), OTA_FALHA (media).
- Broker: senha nunca devolvida (`password_set`); em branco = mantém; opção "remover senha"; teste usa a salva.
- `firmware_routes.py`: POST/GET/DELETE `/api/admin/firmware` (multipart .bin ≤4 MB, X.Y.Z, md5/sha256, token 32 hex, `backend/uploads/firmware/<token>/`), GET público `/api/firmware/files/{token}/{nome}`, GET `/api/admin/firmware/controladoras`, POST `/api/admin/firmware/{id}/enviar` (lote escalonado, 1 por vez, sucesso=VERSAO igual, falha=OTA/STATE erro/rollback/ignorado ou 10 min → pausa + alarme), GET `/api/admin/firmware/lote`, POST `/api/admin/firmware/lote/cancelar`. Lote em memória (perde-se ao reiniciar backend).
- UI: aba Admin "Firmware das controladoras" (`components/FirmwareTab.jsx`); FancoilDetail "(solicitado: X)" âmbar após 30 s; Diagnóstico MQTT com Firmware/RSSI/Uptime/RESET e tópicos reais.
- Prompt firmware reescrito (protocolo v1.4.x completo).

## Novidades (2026-10-18 — v1.9.0 Catálogo de controladoras)
- `controllers.py`: catálogo `controller_models` (seed FC300 · FANCOIL · KinCony KC868-A4; CRUD admin `/api/admin/controller-models`), registro `controllers` (TIPO/MODELO/VERSAO/ONLINE/RESET/RSSI/UPTIME/OTA/STATE de qualquer device; ONLINE sozinho não cria), `inventory()` une fancoils + lighting_controllers + registro; categoria = TIPO → catálogo → origem.
- `firmware_routes.py`: firmwares com modelo/categoria/assinatura, índice único (modelo, versao), migração antiga → FC300; upload lê assinatura `NXFW|TIPO|MODELO|VERSAO|`, exige 0xE9, modelo no catálogo, salva `<modelo>-<versao>.bin`; `GET /admin/firmware?categoria=&modelo=`, `GET /admin/firmware/arvore`, controladoras `?modelo=|grupo=sem_modelo|nao_catalogado`; envio 409 `modelo_incompativel` / `sem_modelo` (aceita `forcar_sem_modelo`, registrado no command_log); não exclui versão mais recente.
- Frontend: `FirmwareTab.jsx` (árvore + versões + controladoras + "Atualizar desatualizadas"), `firmware/ControllerModels.jsx` (aba Modelos + dialog cadastrar), `firmware/FirmwareUpdateDialog.jsx` reutilizável (FancoilDetail admin), `firmware/fwUtils.js` (pré-visualização da assinatura no navegador). Subtítulo FancoilDetail mostra modelo.

## Novidades (2026-10-18 — endereço público dos firmwares)
- `FIRMWARE_PUBLIC_BASE` (opcional): URL do OTA = base + token/arquivo; sem ela, `FRONTEND_URL/api/firmware/files/`. `GET /api/admin/firmware/config`. Topo da página de firmware mostra o endereço em uso; dica na linha quando OTA/STATE = "erro: url nao permitida".

## Novidades (2026-10-18 — v1.10.0 Firmware: lista por modelo + escolha da versão)
- Árvore: `GET /admin/firmware/arvore` agora devolve `modelos` (lista plana com categoria_label, n_versoes, n_controladoras, n_desatualizadas). Coluna esquerda só modelos (selo categoria, selo âmbar desatualizadas, busca >6), grupos "Modelo não informado"/"não catalogados" só quando houver; 1º modelo auto-selecionado.
- Versões com radio "Enviar esta" (padrão mais recente); "Versão a enviar: vX (mais recente|anterior)"; botões "Atualizar selecionadas" e "Atualizar todas para vX (N)"; checkbox desabilitado se já na versão; confirmação com aviso de downgrade (exige marcar) e "sem assinatura" (`firmware/OtaWarnings.jsx`). FirmwareUpdateDialog recebe `targets` e pré-seleciona a mais recente.
- command_log do OTA: firmware_id, versao_origem, versao_destino.

## Novidades (2026-10-19 — v1.11.0 PID no modal Editar fancoil)
- Contrato MQTT do PID (FC300 ≥ 1.4.4, JSON): `PID/SET` (retain=false; `{"perfil":X}` ou PERSONALIZADO com kp/ti/taxa/zm), `PID/CONFIG` (retido; confirmação; campo `erro` só em erro), `PID/STATE` (retido, a cada 30 s: sp, temp, bruta, erro, pid, vag, zm, rele), `SETPOINT/STATE` (texto "18.0"). Perfis: MUITO_LENTO 30/720/5/0.20 · LENTO 35/480/7/0.20 · NORMAL 40/300/10/0.20 · RAPIDO 50/200/15/0.15 · MUITO_RAPIDO 60/120/20/0.15. Faixas: kp 5–100, ti 60–3600, taxa 1–20, zm 0.10–1.00.
- `backend/pid.py`: POST `/api/devices/{fancoil_id|device_id}/pid` (admin; valida faixas, salva `pid_desejado`, publica PID/SET, command_log); auto-reenvio quando ONLINE 0→1 ou PID/CONFIG ≠ desejado (máx. 1×/5 min, não reenvia se CONFIG tem erro ou firmware sem suporte). FancoilState: pid_config, pid_state, setpoint_state (+ _at), persistidos; histórico grava `pid` (média por intervalo).
- Frontend: `PidSection.jsx` no modal (padrão NORMAL), `usePidWatcher` (toasts de confirmação/erro/timeout 60 s), `PidRealtimePanel.jsx` no detalhe, série "Saída PID (%)" no gráfico VAG, selo "PID: <perfil>" na lista.

## Backlog
- P1: Mapear MODO/STATUS fora do prefixo também (atualmente CJ031 só tem TEMPERATURA e VAG mapeados — faltam outros tópicos se o firmware publicar)
- P1: dashboards por sistema (HVAC/ilum/hidráulica) e indicadores agregados por andar
- P1: módulos Iluminação e Hidráulica reais com dispositivos genéricos
- P1: upload de imagem real do edifício e logo via Admin
- P2: comandos em massa com seleção parcial (checkbox por fancoil), presets de horário
- P2: alertas por e-mail/SMS, agendamento multi-fancoil, exportação PDF, histórico de pressão
- P2: integração com câmeras / controle de acesso (BMS completo)
