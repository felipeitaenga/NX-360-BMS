# NX-360 BMS — Instalação Docker passo a passo

Guia pra subir o sistema completo em um servidor Linux com Docker + Docker Compose, atrás de um Nginx que já roteia outros apps. Tempo estimado: **~20 min**.

---

## 1. Pré-requisitos no servidor

Confirme que já tem instalado:
```bash
docker --version          # >= 20.10
docker compose version    # v2.x  (ou docker-compose se for v1)
nginx -v                  # já serve os outros apps
```

Se ainda não tiver Docker Compose v2:
```bash
sudo apt install docker-compose-plugin -y
```

---

## 2. Copiar os arquivos pro servidor

Opção A — via `git` (recomendado se você vai dar push a partir do Emergent / GitHub):
```bash
cd /opt
git clone https://github.com/<seu-usuario>/nx360-bms.git
cd nx360-bms
```

Opção B — via `scp` do zip do Emergent:
```bash
# No seu PC, após baixar o zip:
scp nx360-bms.zip usuario@seu-servidor:/opt/
# No servidor:
cd /opt && unzip nx360-bms.zip -d nx360-bms && cd nx360-bms
```

> O diretório deve ter: `backend/`, `frontend/`, `deploy/`.

---

## 3. Configurar variáveis de ambiente

```bash
cd /opt/nx360-bms/deploy
cp .env.example .env
nano .env
```

Preencha **todos** os campos `<...>`:

- `MONGO_PASSWORD` — senha aleatória forte do Mongo
- `JWT_SECRET` — gere com `openssl rand -hex 32`
- `CORS_ORIGINS` — origens permitidas no CORS (lista separada por vírgula). Em produção use só a URL pública, ex.: `https://bms.suaempresa.com.br`
- `REACT_APP_BACKEND_URL` — a mesma URL pública (o React faz chamadas `/api/...` relativas a ela)

> ⚠️ A `REACT_APP_BACKEND_URL` é **compilada no build do React** — se mudar depois, precisa rebuildar o container frontend.

---

## 4. Subir os containers

```bash
cd /opt/nx360-bms/deploy
docker compose --env-file .env up -d --build
```

Vai levar ~2-3 min no primeiro build (compila React + instala Python). Depois é instantâneo.

Verifique:
```bash
docker compose ps                     # 3 containers "running (healthy)"
docker compose logs -f backend        # Veja "MQTT conectado em..."
curl http://127.0.0.1:8001/api/health # {"status":"ok"} (ou similar)
curl http://127.0.0.1:8080/           # HTML do React
```

Os containers expõem portas **apenas em `127.0.0.1`** — nada vaza pra internet direto. O Nginx do host faz o acesso público.

---

## 5. DNS + Nginx (proxy público)

### 5.1 Apontar o subdomínio

No seu painel DNS (Registro.br, Cloudflare etc.), crie um registro:

| Tipo | Nome | Valor |
|------|------|-------|
| A    | bms  | IP público do servidor |

### 5.2 Virtual host do Nginx

Copie o template:
```bash
sudo cp /opt/nx360-bms/deploy/nginx-proxy.conf /etc/nginx/sites-available/nx360
sudo nano /etc/nginx/sites-available/nx360
```

Troque `bms.suaempresa.com.br` pelo seu domínio real. Habilite:
```bash
sudo ln -s /etc/nginx/sites-available/nx360 /etc/nginx/sites-enabled/nx360
sudo nginx -t && sudo systemctl reload nginx
```

Teste pelo HTTP: `http://bms.suaempresa.com.br` já deve carregar.

### 5.3 HTTPS com Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d bms.suaempresa.com.br
```

O Certbot edita o seu arquivo automaticamente adicionando SSL. Teste `https://bms.suaempresa.com.br`.

> ⚠️ Depois do HTTPS: **se `REACT_APP_BACKEND_URL` não começar com `https://`**, atualize o `.env` e rode `docker compose up -d --build frontend` pra reconstruir.

---

## 6. Primeiro login

- URL: `https://bms.suaempresa.com.br`
- E-mail: `admin@pilares.local` *(ou o padrão do seed — ver `backend/seed.py`)*
- Senha inicial: `Admin@123` — **o sistema vai forçar troca no primeiro login**

Depois crie seus usuários em **Admin → Usuários**.

---

## 7. Configurar o broker MQTT

Entre em **Admin → Broker e Parâmetros** e informe:
- Host: `156.67.82.199` (seu broker atual)
- Porta: `1883`
- TLS: desligado
- Prefixo: `TJS`
- Simulação: **off**

Clique "Testar conexão" — deve mostrar sucesso. Em "Diagnóstico MQTT" você vê os ESP32 chegando ao vivo.

---

## 8. Operação do dia-a-dia

### Atualizar o app (puxar nova versão):
```bash
cd /opt/nx360-bms
git pull                                                     # ou scp o novo zip
cd deploy
docker compose --env-file .env up -d --build
```

### Ver logs:
```bash
docker compose logs -f backend | tail -200
docker compose logs -f frontend
```

### Parar / reiniciar:
```bash
docker compose restart backend
docker compose down         # para tudo
docker compose up -d        # sobe sem rebuild
```

### Backup automático

Agende o `backup.sh`:
```bash
sudo chmod +x /opt/nx360-bms/deploy/backup.sh
sudo crontab -e
# Adicione: 0 3 * * * /opt/nx360-bms/deploy/backup.sh >> /var/log/nx360_backup.log 2>&1
```

Backups ficam em `/var/backups/nx360/` com rotação de 14 dias.

### Restaurar banco:
```bash
docker exec -i nx360_mongo mongorestore --username=nx360admin --password=<SENHA> \
  --authenticationDatabase=admin --gzip --archive < /var/backups/nx360/mongo_YYYYMMDD.gz
```

---

## 9. Troubleshooting rápido

| Sintoma | Causa comum | Fix |
|---|---|---|
| `502 Bad Gateway` ao abrir o domínio | Container caiu | `docker compose ps` + `logs backend` |
| Frontend abre mas API dá CORS | `CORS_ORIGINS` ou `REACT_APP_BACKEND_URL` errado no `.env` | Corrija, `up -d --build frontend` |
| MQTT nunca conecta | Firewall UFW bloqueando saída | `sudo ufw allow out 1883/tcp` |
| Login OK, mas WebSocket não atualiza | Nginx sem `Upgrade` headers | Confira o bloco `/api/ws` do `nginx-proxy.conf` |
| Build do frontend falha "memory" | VPS com <2GB RAM | Rode `yarn build` em outra máquina e copie o `/build` |

---

## 10. Requisitos mínimos de servidor

- **CPU:** 2 vCPUs
- **RAM:** 2 GB (4 GB confortável — build do React usa ~1 GB)
- **Disco:** 20 GB SSD
- **Rede:** porta 80/443 aberta na internet; porta 1883 **de saída** liberada pro broker MQTT
- **SO:** Ubuntu 22.04 LTS ou Debian 12 (qualquer Linux com Docker roda)

Pronto! Qualquer dúvida ou erro durante a instalação, me cola a saída do `docker compose logs` que eu te oriento.
