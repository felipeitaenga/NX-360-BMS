# NX-360 BMS — Instalação Docker passo a passo

Guia pra subir o sistema completo em um servidor Linux com Docker. Acesso por **IP:porta** (não precisa de domínio nem SSL inicialmente). Tempo estimado: **~15 min**.

---

## Instalação Rápida (recomendada)

Se você já tem Docker e Docker Compose v2 no servidor:

```bash
# 1) Copie o código pro servidor (git clone OU scp do zip do Emergent)
cd /opt
git clone <seu-repo-git> nx360-bms   # ou unzip do pacote baixado
cd nx360-bms/deploy

# 2) Rode o instalador automático
bash install.sh
```

O script:
1. Detecta o IP público do servidor
2. Pergunta a porta (padrão 8090 — se usar outra, só não conflitar com outros serviços)
3. Gera `.env` com senhas aleatórias fortes
4. Libera o firewall UFW (se estiver ativo)
5. Faz build + sobe os 4 containers (mongo, backend, frontend, gateway)
6. Aguarda o healthcheck do backend
7. Mostra a URL de acesso

Depois disso, abra `http://SEU_IP:PORTA/` no navegador. Pronto.

---

## Instalação Manual (se preferir controle total)

### 1. Pré-requisitos
```bash
docker --version          # >= 20.10
docker compose version    # v2.x
```

Instalar se faltar:
```bash
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y
```

### 2. Baixar o código
```bash
cd /opt
git clone <seu-repo> nx360-bms   # ou scp do zip
cd nx360-bms/deploy
```

### 3. Configurar
```bash
cp .env.example .env
nano .env
```

Preencha:
- `PUBLIC_PORT` — porta livre no servidor (ex.: 8090; **não use 8080** se Scada-LTS usa)
- `MONGO_PASSWORD` — gere com `openssl rand -base64 24`
- `JWT_SECRET` — gere com `openssl rand -hex 32`
- `REACT_APP_BACKEND_URL` — `http://SEU_IP:PUBLIC_PORT` (sem barra no fim)
- `CORS_ORIGINS` — `*` (ou liste origens específicas por vírgula)

### 4. Firewall
```bash
sudo ufw allow 8090/tcp         # porta pública (ajuste se usou outra)
sudo ufw allow out 1883/tcp     # saída pro broker MQTT
```

### 5. Subir
```bash
docker compose --env-file .env up -d --build
```

Primeiro build: 2-3 min. Depois é instantâneo.

### 6. Verificar
```bash
docker compose ps                                 # 4 containers "running (healthy)"
curl http://127.0.0.1:8090/api/health             # {"status":"ok", ...}
curl http://127.0.0.1:8090/                       # HTML do React
```

Abra `http://SEU_IP:8090/` no navegador.

---

## 🔑 Primeiro login

- Usuário: `admin@pilares.com.br`
- Senha: `Admin@123` — **o sistema vai forçar troca no primeiro login**

Depois crie seus usuários em **Admin → Usuários**.

---

## 📡 Configurar MQTT

Em **Admin → Broker e Parâmetros**:
- Host: `156.67.82.199`
- Porta: `1883`
- TLS: off
- Prefixo: `TJS`
- Simulação: off

Clique "Testar". Em **Admin → Diagnóstico MQTT** você vê os ESP32 chegando ao vivo.

---

## 🔧 Operação

### Ver logs
```bash
docker compose logs -f backend
docker compose logs -f gateway
```

### Reiniciar / parar
```bash
docker compose restart backend
docker compose down          # para tudo (preserva dados)
docker compose up -d         # sobe sem rebuild
```

### Atualizar o app
```bash
cd /opt/nx360-bms
git pull                     # ou scp a nova versão
cd deploy
docker compose --env-file .env up -d --build
```

### Backup automático
```bash
sudo chmod +x /opt/nx360-bms/deploy/backup.sh
sudo crontab -e
# Adicione:
0 3 * * * /opt/nx360-bms/deploy/backup.sh >> /var/log/nx360_backup.log 2>&1
```

Backups ficam em `/var/backups/nx360/` com rotação de 14 dias.

### Restaurar banco
```bash
docker exec -i nx360_mongo mongorestore \
  --username=nx360admin --password=<SENHA_DO_.ENV> \
  --authenticationDatabase=admin --gzip --archive \
  < /var/backups/nx360/mongo_YYYYMMDD.gz
```

---

## 🔒 HTTPS (opcional, mas recomendado)

Enquanto é acessado por IP:porta HTTP, o tráfego não é criptografado — qualquer um na rede entre o cliente e o servidor consegue ver senhas/dados.

### Opção 1: Caddy na frente (mais simples)
Se depois você tiver um domínio apontando para o IP, suba um Caddy que faz TLS automático:
```bash
docker run -d --name caddy --restart unless-stopped \
  --network nx360_nx360 \
  -p 443:443 -p 80:80 \
  -v caddy_data:/data \
  caddy:latest caddy reverse-proxy --from bms.seudominio.com --to gateway:80
```

### Opção 2: Nginx host + Certbot
Veja o template em `nginx-proxy.conf` e rode `certbot --nginx -d bms.seudominio.com`.

---

## 🩺 Troubleshooting

| Sintoma | Causa comum | Fix |
|---|---|---|
| `Connection refused` ao abrir no navegador | Porta `PUBLIC_PORT` não liberada no firewall ou provedor cloud | Libere no UFW/SG |
| Login OK mas tela em branco | `REACT_APP_BACKEND_URL` com IP/porta errada | Corrija `.env` e `up -d --build frontend` |
| `502 Bad Gateway` | Backend caiu | `docker compose ps` → `logs backend` |
| MQTT nunca conecta | Firewall UFW bloqueando saída | `sudo ufw allow out 1883/tcp` |
| WebSocket não atualiza em tempo real | Nginx intermediário sem Upgrade headers | Confira o gateway (já config'd no stack) |
| Build falha "JavaScript heap out of memory" | VPS <2GB RAM | Build em outra máquina e `COPY --from` |

---

## 💻 Requisitos mínimos de servidor

- **CPU:** 2 vCPUs
- **RAM:** 2 GB (4 GB confortável — build do React usa ~1 GB)
- **Disco:** 20 GB SSD
- **Rede:** porta pública (ex.: 8090) aberta pra internet; porta 1883 **de saída** liberada pro broker MQTT
- **SO:** Ubuntu 22.04+ ou Debian 12 (qualquer Linux com Docker roda)

---

## 📋 Checklist pós-instalação

- [ ] Abriu `http://IP:porta/` no navegador e viu a tela de login
- [ ] Trocou a senha do admin
- [ ] Broker MQTT conectado (Admin → Diagnóstico MQTT mostra tráfego)
- [ ] Firewall liberado pra porta pública + saída 1883
- [ ] Cron de backup agendado
- [ ] (opcional) HTTPS configurado com domínio

Qualquer erro, me cola a saída de `docker compose logs backend --tail=100` + `docker compose ps` que eu te oriento.
