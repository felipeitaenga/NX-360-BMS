# Pilares HVAC — Supervisório de Fancoils

## Problema Original
Aplicativo web responsivo em pt-BR para monitoramento e controle de fancoils em edifício comercial, com arquitetura ESP32 → Broker MQTT → Backend (FastAPI) → Frontend (React, WebSocket). Payloads MQTT em texto puro, perfis Admin/Operator/Viewer, modo simulação para testes sem hardware.

## Personas
- **Administrador**: configura broker, cadastra fancoils/usuários, define permissões por módulo e por fancoil, upload de imagens.
- **Operador**: visualiza e comanda os fancoils liberados (ESTADO, CMD, SETPOINT).
- **Visualizador**: apenas leitura dos fancoils liberados.

## Requisitos Centrais (estáticos)
- Login JWT com troca obrigatória de senha no 1º login
- Modo simulação (padrão) + MQTT real via paho (TLS 8883) com broker configurável na admin
- 32 fancoils seed CJ011..CJ172 (sem 13º andar), IDs SIM0101..SIM1702
- Payloads MQTT exatamente conforme firmware: ONLINE/STATUS/MODO '1'/'0', ESTADO/SET e CMD/SET 'true'/'false', TEMPERATURA numeric ou 'ERRO', SETPOINT/SET 10–35 °C
- Alarmes automáticos: OFFLINE, SENSOR_FAIL, START_FAIL, STOP_FAIL, TEMP_OUT_OF_RANGE, FORCED_TOO_LONG, BROKER_DOWN
- Histórico de telemetria amostrado a cada minuto; log de comandos com confirmação por eco MQTT
- Validação de permissões no backend em TODA requisição (comandos, listagens, WS)
- Interface em português (BRT), tema claro/escuro

## Já Implementado (01/10/2026)
- Backend FastAPI: auth, usuários, fancoils, permissões por módulo+fancoil, comandos (ESTADO/CMD/SETPOINT), alarmes, histórico, relatórios CSV, WebSocket `/api/ws`, settings/broker, dispositivos detectados
- Simulador integrado: janela 07h–21h, STATUS lags cmd ~3s, VAG=0 off, ignora SP fora de 10–35
- Frontend React: Login + troca de senha, Início com imagem do edifício + cards resumo, Ar Condicionado (view 2 colunas por lado), Detalhe do fancoil com SVG animado (ventilador girando, setas de ar), controles com confirmação, chart Recharts 24h/7d/30d, Alarmes com ack, Relatórios (log comandos, horas ligado, log acesso), Administração completa (usuários, fancoils, importação CSV, permissões, broker, parâmetros)
- Design SCADA industrial (Chivo + IBM Plex, azul petróleo, status verde/âmbar/vermelho/cinza)
- Testes backend 24/24 pass, fluxos de frontend testados

## Backlog / Próximas (P1/P2)
- P1: Reset de senha por e-mail (Resend/Emergent email key) e logs de acesso detalhados por fancoil
- P1: Notificação sonora opcional ao surgir alarme
- P2: Módulos Iluminação e Hidráulica reais (hoje "Em breve")
- P2: Exportação PDF (CSV disponível) e filtros avançados em relatórios
- P2: Agendamento de setpoints por horário / por dia da semana diretamente no app
- P2: Dashboard com mapa de calor dos andares (temperatura)

## Credenciais de Teste
Ver `/app/memory/test_credentials.md` (admin: felipejferreira@gmail.com, senha atual: NovaSenha123 após o teste; para reseed, drop db.users).
