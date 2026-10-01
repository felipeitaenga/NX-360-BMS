# Pilares HVAC — Supervisório de Fancoils

## Problema Original
Aplicativo web responsivo em pt-BR para monitoramento e controle de fancoils em edifício comercial. Arquitetura ESP32 → Broker MQTT → Backend (FastAPI) → Frontend (React, WebSocket). Payloads MQTT em texto puro, perfis Admin/Operator/Viewer, modo simulação para testes sem hardware.

## Personas
- **Administrador**: configura broker, cadastra fancoils/usuários, define permissões por módulo e por fancoil, upload de imagens.
- **Operador**: visualiza e comanda os fancoils liberados (ESTADO, CMD, SETPOINT, agendamentos).
- **Visualizador**: apenas leitura dos fancoils liberados.

## Requisitos Centrais
- Login JWT com troca obrigatória de senha no 1º login + reset por e-mail (link 1h, uso único)
- Modo simulação (padrão) + MQTT real via paho (TLS 8883) configurável
- 32 fancoils seed CJ011..CJ172 (sem 13º andar), IDs SIM0101..SIM1702
- Payloads MQTT exatamente conforme firmware
- Alarmes automáticos com alerta sonoro opcional
- Agendamento de comandos por horário/dias da semana
- Mapa de calor por andar/lado
- Permissões validadas sempre no backend
- Interface em pt-BR, tema claro/escuro

## Implementado (01/10/2026)
### Fase 1 — MVP
- Backend: auth JWT, CRUD usuários/fancoils/permissões, comandos, alarmes, histórico, relatórios CSV, WebSocket, settings, import CSV
- Simulador fiel ao firmware (janela 07h-21h, STATUS lag 3s, VAG=0 off)
- Frontend: Login, troca senha, Início, Ar Condicionado (2 colunas), Detalhe com SVG animado, Alarmes, Relatórios, Administração completa

### Fase 2 — Enhancements
- **Reset de senha por e-mail** (Emergent email key): `/api/auth/forgot-password` + `/api/auth/reset-password`, páginas `/esqueci-senha` e `/redefinir-senha`, link no login. Token sha256, expira em 1h, rate-limit 5/15min, resposta genérica contra enumeração
- **Agendamento de comandos**: collection `schedules`, scheduler no backend (loop 30s, double-run guard), rotas CRUD `/api/schedules*`, `SchedulesPanel.jsx` com shadcn AlertDialog
- **Alerta sonoro de alarme**: `SoundContext` com Web Audio API, botão `sound-toggle-button` no sidebar (desktop+mobile), persiste em localStorage, dispara beep de pitch e repetição variável por prioridade
- **Mapa de calor**: endpoint `/api/heatmap`, página `/mapa-calor` com grade por andar/lado, gradiente dinâmico azul→verde→vermelho e legenda

## Backlog
- P1: Logs detalhados por fancoil, export PDF em relatórios
- P2: Módulos Iluminação e Hidráulica reais (hoje "Em breve")
- P2: Multi-site (vários edifícios por conta)
- P2: Dashboard mobile-first dedicado

## Testes
- 24/24 cases MVP (iteração 1)
- 14/14 cases novas features (iteração 2)
- Zero issues críticos; dois minor cosmetics já corrigidos

## Credenciais
Ver `/app/memory/test_credentials.md` (admin: felipejferreira@gmail.com / NovaSenha123).
