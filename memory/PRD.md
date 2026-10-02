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

## Credenciais
Ver `/app/memory/test_credentials.md` (admin: felipejferreira@gmail.com / @Pilares1)

## Backlog
- P1: dashboards por sistema (HVAC/ilum/hidráulica) e indicadores agregados por andar
- P1: módulos Iluminação e Hidráulica reais com dispositivos genéricos
- P2: alertas por e-mail/SMS, agendamento multi-fancoil, exportação PDF, histórico de pressão
- P2: integração com câmeras / controle de acesso (BMS completo)
