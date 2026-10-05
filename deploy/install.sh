#!/usr/bin/env bash
# ============================================================
# NX-360 BMS — Instalador automático
# Uso: bash install.sh
# Precisa rodar NO SEU SERVIDOR (não na sua máquina local)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

say() { echo -e "\033[1;36m==> $1\033[0m"; }
err() { echo -e "\033[1;31m[ERRO] $1\033[0m" >&2; exit 1; }

# ---------- 1) Checagem de pré-requisitos ----------
say "Checando pré-requisitos…"
command -v docker >/dev/null 2>&1 || err "Docker não instalado. Instale com: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || err "Docker Compose v2 não instalado. Rode: apt install docker-compose-plugin"
command -v openssl >/dev/null 2>&1 || err "openssl não encontrado. apt install openssl"

# ---------- 2) Detectar IP público ----------
say "Detectando IP público do servidor…"
PUBLIC_IP="${PUBLIC_IP:-}"
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(curl -s --max-time 5 ifconfig.me || curl -s --max-time 5 icanhazip.com || true)"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  read -rp "Não consegui detectar o IP público. Digite o IP ou domínio que os usuários usarão: " PUBLIC_IP
fi
echo "   IP detectado: $PUBLIC_IP"

# ---------- 3) Perguntar a porta ----------
DEFAULT_PORT=8090
read -rp "Porta pública (ENTER para padrão $DEFAULT_PORT): " PUBLIC_PORT_IN
PUBLIC_PORT="${PUBLIC_PORT_IN:-$DEFAULT_PORT}"

# Checar se porta está livre
if ss -tnl 2>/dev/null | grep -q ":$PUBLIC_PORT "; then
  err "A porta $PUBLIC_PORT já está em uso. Escolha outra ou pare o serviço que está usando."
fi

# ---------- 4) Gerar .env ----------
if [[ -f .env ]]; then
  read -rp "Já existe .env. Sobrescrever? [s/N] " ans
  [[ "${ans,,}" == "s" ]] || { echo "Mantendo .env existente."; }
fi

if [[ ! -f .env || "${ans,,}" == "s" ]]; then
  say "Gerando .env com senhas aleatórias…"
  MONGO_PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)
  JWT_SECRET=$(openssl rand -hex 32)
  cat > .env <<EOF
PUBLIC_PORT=$PUBLIC_PORT
MONGO_USER=nx360admin
MONGO_PASSWORD=$MONGO_PASS
DB_NAME=nx360bms
JWT_SECRET=$JWT_SECRET
CORS_ORIGINS=*
MQTT_TOPIC_PREFIX=TJS
REACT_APP_BACKEND_URL=http://$PUBLIC_IP:$PUBLIC_PORT
EOF
  echo "   .env salvo. (Guarde a MONGO_PASSWORD em local seguro — ela está em $SCRIPT_DIR/.env)"
fi

# ---------- 5) Firewall ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "UFW ativo — liberando porta $PUBLIC_PORT/tcp e saída 1883/tcp (MQTT)…"
  ufw allow "$PUBLIC_PORT"/tcp || true
  ufw allow out 1883/tcp || true
fi

# ---------- 6) Build + up ----------
say "Fazendo build dos containers (demora 2-3 min no primeiro boot)…"
docker compose --env-file .env build

say "Iniciando containers…"
docker compose --env-file .env up -d

# ---------- 7) Aguardar saúde ----------
say "Aguardando o backend ficar pronto…"
for i in {1..40}; do
  if curl -fs "http://127.0.0.1:$PUBLIC_PORT/api/health" >/dev/null 2>&1; then
    echo "   Backend OK."
    break
  fi
  sleep 2
  [[ $i -eq 40 ]] && { docker compose logs --tail=50 backend; err "Backend não respondeu em 80s"; }
done

# ---------- 8) Final ----------
cat <<EOF

╔══════════════════════════════════════════════════════════════╗
║  NX-360 BMS instalado com sucesso                            ║
╠══════════════════════════════════════════════════════════════╣
║  URL de acesso:  http://$PUBLIC_IP:$PUBLIC_PORT/
║  Login inicial:  admin@pilares.local  /  Admin@123
║                  (o sistema vai pedir pra trocar a senha)
╠══════════════════════════════════════════════════════════════╣
║  Comandos úteis:                                             ║
║    docker compose logs -f backend    # ver logs backend      ║
║    docker compose ps                 # status                ║
║    docker compose restart            # reiniciar             ║
║    docker compose down               # parar tudo            ║
║    docker compose up -d --build      # atualizar             ║
╚══════════════════════════════════════════════════════════════╝

Próximos passos:
  1. Abra http://$PUBLIC_IP:$PUBLIC_PORT/ no navegador
  2. Faça login e troque a senha
  3. Admin → Broker: aponte pro seu broker MQTT (156.67.82.199:1883)
  4. Agende backups: crontab -e e adicione:
     0 3 * * * $SCRIPT_DIR/backup.sh >> /var/log/nx360_backup.log 2>&1

EOF
