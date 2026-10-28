#!/usr/bin/env bash
# Запускается на сервере из GitHub Actions (ssh ... bash -s < deploy/deploy.sh).
# Обновляет исходники до задеплоенного коммита, тянет образы из GHCR и перезапускает стек.
set -euo pipefail

PROJECT_DIR=${PROJECT_DIR:-/root/kewldan.ru}
: "${IMAGE_TAG:?IMAGE_TAG не задан}"

cd "$PROJECT_DIR"

echo "→ обновляю исходники до $IMAGE_TAG"
git fetch --prune --quiet origin main
git reset --hard --quiet "$IMAGE_TAG" 2>/dev/null || git reset --hard --quiet origin/main
# Чистим мусор, кроме игнорируемых файлов: .env остаётся на месте.
git clean -fdq

echo "→ тяну образы"
export IMAGE_TAG
docker compose pull --quiet web api

echo "→ поднимаю стек"
docker compose up -d --remove-orphans

# Конфиг nginx примонтирован файлом: контейнер не пересоздаётся, и правки
# в deploy/nginx подхватываются только перечитыванием конфига.
if docker compose exec -T proxy nginx -t >/dev/null 2>&1; then
	docker compose exec -T proxy nginx -s reload
	echo "→ nginx перечитал конфиг"
else
	echo "⚠ конфиг nginx не прошёл проверку, оставляю прежний" >&2
fi

echo "→ убираю образы старше недели"
docker image prune -f --filter "until=168h" >/dev/null

docker compose ps --format '{{.Service}}: {{.Status}}'
