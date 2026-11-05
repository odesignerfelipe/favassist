#!/usr/bin/env bash
# Atualiza o FAV Assist na VPS: baixa o código, reconstrói, aplica migrações e reinicia.
set -euo pipefail
cd "${APP_DIR:-/opt/fav-assist}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git pull --quiet --ff-only origin "$BRANCH"
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose -f docker-compose.prod.yml ps
echo "Atualizado para $(git rev-parse --short HEAD) ($BRANCH)."
