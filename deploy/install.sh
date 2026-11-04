#!/usr/bin/env bash
# =============================================================================
# FAV Assist — instalação na VPS (Ubuntu 22.04/24.04, executar como root).
#   curl -fsSL https://raw.githubusercontent.com/odesignerfelipe/favassist/main/deploy/install.sh | bash
# Variáveis opcionais: BRANCH (padrão main), APP_DIR (padrão /opt/fav-assist), DOMAIN.
# Os segredos são digitados aqui, na VPS — nunca são enviados ao GitHub.
# =============================================================================
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/fav-assist}"
REPO="https://github.com/odesignerfelipe/favassist.git"
DEFAULT_DOMAIN="assistente.favisdesign.com.br"
DEFAULT_SUPABASE_URL="https://mbctlwobwwpgzsusnovg.supabase.co"
TTY=/dev/tty

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ask() { local var="$1" prompt="$2" def="${3:-}" val; read -r -p "$prompt${def:+ [$def]}: " val < "$TTY"; printf -v "$var" '%s' "${val:-$def}"; }
ask_secret() { local var="$1" prompt="$2" val; read -r -s -p "$prompt: " val < "$TTY"; echo; printf -v "$var" '%s' "$val"; }

[ "$(id -u)" -eq 0 ] || { echo "Execute como root (sudo -i)."; exit 1; }

say "Instalando dependências (git, Docker)…"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates ufw >/dev/null
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

say "Baixando o código (branch $BRANCH)…"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH" && git -C "$APP_DIR" checkout --quiet "$BRANCH" && git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

if [ ! -f .env ]; then
  say "Configuração (.env) — os valores ficam apenas nesta VPS"
  ask DOMAIN "Domínio" "$DEFAULT_DOMAIN"
  ask SUPABASE_URL "URL do projeto Supabase" "$DEFAULT_SUPABASE_URL"
  ask SUPABASE_PUBLISHABLE_KEY "Chave publicável do Supabase (sb_publishable_…)"
  ask_secret SUPABASE_SECRET_KEY "Chave SECRETA do Supabase (sb_secret_…) [oculta]"
  echo "String de conexão: Supabase → Connect → Session pooler (porta 5432), com a senha do banco."
  ask_secret DATABASE_URL "DATABASE_URL [oculta]"
  ask AI_API_KEY_SET "Configurar a IA agora? (s/N)" "N"
  AI_PROVIDER=none; AI_API_KEY=""
  if [[ "$AI_API_KEY_SET" =~ ^[sS]$ ]]; then AI_PROVIDER=anthropic; ask_secret AI_API_KEY "Chave da API Anthropic [oculta]"; fi
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
NODE_ENV=production
LOG_LEVEL=info
COOKIE_SECURE=true
DATABASE_URL=$DATABASE_URL
DATABASE_SSL=true
AUTH_PROVIDER=supabase
SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SUPABASE_SECRET_KEY
AI_PROVIDER=$AI_PROVIDER
AI_API_KEY=$AI_API_KEY
AI_MODEL=
MESSAGING_PROVIDER=simulator
EOF
  chmod 600 .env
else
  say ".env já existe — mantido."
  # shellcheck disable=SC1091
  DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)
fi

say "Firewall: liberando SSH, HTTP e HTTPS…"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

say "Construindo e iniciando os serviços (pode levar alguns minutos)…"
docker compose -f docker-compose.prod.yml up -d --build

say "Verificando…"
sleep 8
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=20 migrate

ask CREATE_ADMIN "Criar o primeiro Administrador FAVIS agora? (S/n)" "S"
if [[ "$CREATE_ADMIN" =~ ^[sS]$ ]]; then
  ask ADMIN_EMAIL "E-mail do administrador"
  ask_secret ADMIN_PASSWORD "Senha (mínimo 10 caracteres) [oculta]"
  ask ADMIN_NAME "Nome" "Administrador FAVIS"
  docker compose -f docker-compose.prod.yml run --rm \
    -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" -e SEED_ADMIN_NAME="$ADMIN_NAME" \
    api node dist/scripts/seed-admin.js
fi

say "Pronto! Acesse https://$DOMAIN"
echo "O certificado HTTPS é emitido automaticamente quando o DNS do domínio aponta para esta VPS."
echo "Atualizações futuras: $APP_DIR/deploy/update.sh"
