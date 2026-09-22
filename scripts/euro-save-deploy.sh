#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/euro-save}"
REPO_URL="${REPO_URL:-https://github.com/Leronim/euro-save.git}"
LOCK_FILE="${LOCK_FILE:-/var/lock/euro-save-deploy.lock}"

cd "$DEPLOY_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

if [ ! -d .git ]; then
  git init
fi

git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git fetch --prune origin main

current="$(git rev-parse HEAD 2>/dev/null || echo none)"
target="$(git rev-parse origin/main)"

if [ "$current" = "$target" ] && [ "${1:-}" != "--force" ]; then
  echo "euro-save already at $target"
  exit 0
fi

git checkout -B main origin/main
git clean -fd -e .env

docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
# Recreate to pick up replaced bind-mounted Caddyfile and updated routes.
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps caddy

for attempt in 1 2 3 4 5; do
  if docker compose -f docker-compose.prod.yml exec -T app node dist/prisma/seed.js; then
    break
  fi

  sleep 3
  if [ "$attempt" = "5" ]; then
    exit 1
  fi
done

docker image prune -f >/dev/null
systemctl is-active --quiet greek-bot.service

echo "euro-save deployed $target"
