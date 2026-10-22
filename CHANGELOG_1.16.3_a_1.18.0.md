# NX-360 BMS — alterações da v1.16.3 até a v1.18.1

## v1.18.1 — Pacote acumulado
- Reúne num único envio tudo da v1.16.3, v1.17.0 e v1.18.0 (sem mudanças de funcionamento)

## v1.16.3 — Setpoint por chiller
- Setpoint de água gelada individual no card do CH1/CH2 (5 a 12 °C)
- Setpoint da central aplica o mesmo valor nos dois chillers
- Aviso "aguardando confirmação" até a controladora confirmar
- Sinótico mostra "SP x,x °C" ao lado de cada chiller
- MQTT: TJS/CAG/CHn/SETPOINT/SET (NX-360 → CLP) e TJS/CAG/CHn/SETPOINT (CLP → NX-360)

## v1.17.0 — Programação horária e sequenciador da CAG
- Menu: Ar Condicionado → CAG → Sinótico e comandos | Programação horária
- Programação geral: dentro dos períodos a central parte com o chiller líder; fora, para
- Alternância diária CH1/CH2, com troca à meia-noite sem parar a central
- Horário de pico: liga o 2º chiller junto (só dentro do período geral)
- Gráfico dos próximos 7 dias (líder do dia + faixa de pico)
- Sequenciador no NX-360, por linha (CH1 = VCH1+BAP1+BAS1, CH2 = VCH2+BAP2+BAS2):
  - Partida: válvula → 60 s → primária → 60 s → secundária → 60 s → chiller
  - Parada: ordem inversa, com as mesmas esperas (configuráveis de 5 a 900 s)
- Reserva BAP3/BAS3 entra quando a bomba dedicada está em falha
- Falha ou falta de confirmação: a linha para, o outro chiller assume e a linha fica bloqueada até "Rearmar linha"
- Tela de comandos: andamento de cada linha, botões Ligar/Desligar 2º chiller, líder bloqueado com alternância ativa
- MQTT: em AUTO o NX-360 publica TJS/CAG/<EQ>/CMD/SET etapa por etapa; GERAL/CMD/SET deixou de ser usado

## v1.18.0 — Alarmes, relatórios com usuário e LGPD
- Alarmes:
  - Indicadores e filtros por sistema (Fancoils/CAG/Hidráulica/Sistema), período, prioridade e busca
  - Nome e local reais do equipamento, link para a tela, duração, quem reconheceu e quando
  - "Reconhecer todos"; visualizador não reconhece; versão para celular em cartões
  - Alarmes de CAG e hidráulica respeitam a permissão de módulo do usuário
- Relatórios:
  - Nova aba Alterações (auditoria): quem, quando, ação, alvo, resultado, detalhe e IP de tudo que é alterado ou comandado
  - Comandos com usuário, incluindo CAG e hidráulica; ações automáticas aparecem como "sequenciador" e "programação CAG"
  - Acessos com tentativas de senha incorreta
  - Filtros por período, usuário, sistema e busca; CSV compatível com o Excel
- LGPD:
  - E-mail, IP e detalhe visíveis só para admin; os outros perfis veem só o nome
  - Senhas e tokens nunca são gravados nos registros
  - Retenção com expurgo automático diário: acessos 180 dias, alterações 365, comandos 365 (configurável)
  - Aba Privacidade (LGPD) com inventário de dados, finalidade, base legal e "Expurgar agora"
  - Exportações de CSV ficam registradas
