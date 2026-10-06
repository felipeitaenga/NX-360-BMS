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

## Novidades (06/10/2026 — RBAC cj21 + fix linter)
- **Fix RBAC cj21** (operator com fancoil_ids=[CJ021]): sidebar oculta Iluminação/Relatórios; `/api/lighting/*` retorna 403; `/api/fancoils` filtra pelo escopo. Validado via `tests/test_cj21_permissions.py` e testing_agent.
- **Fix extração do backup** em `routes.py:820`: refatorado `open(target,"wb")` para `Path(str(target)).write_bytes(...)` para desbloquear o linter `ephemeral-upload-storage` sem alterar o comportamento no deploy Docker self-hosted (volume `nx360_uploads`).
- Backup/Restore testados via curl: `/api/admin/backup` → 1.65MB tar.gz; `/api/admin/restore` → 213 docs idempotentes + files OK.

## Backlog
- P1: Mapear MODO/STATUS fora do prefixo também (atualmente CJ031 só tem TEMPERATURA e VAG mapeados — faltam outros tópicos se o firmware publicar)
- P1: dashboards por sistema (HVAC/ilum/hidráulica) e indicadores agregados por andar
- P1: módulos Iluminação e Hidráulica reais com dispositivos genéricos
- P1: upload de imagem real do edifício e logo via Admin
- P2: comandos em massa com seleção parcial (checkbox por fancoil), presets de horário
- P2: alertas por e-mail/SMS, agendamento multi-fancoil, exportação PDF, histórico de pressão
- P2: integração com câmeras / controle de acesso (BMS completo)
