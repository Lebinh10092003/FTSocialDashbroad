#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-workspace-django.service}"
SYNC_SERVICE_NAME="${SYNC_SERVICE_NAME:-workspace-social-sync.service}"
SYNC_TIMER_NAME="${SYNC_TIMER_NAME:-workspace-social-sync.timer}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8001/api/health/}"
HEALTH_HOST="${HEALTH_HOST:-workspace.fermat.vn}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-1}"
DATABASE_BACKUP_DIR="${DATABASE_BACKUP_DIR:-/var/lib/ft-workspace/backups}"
DATABASE_BACKUP_KEEP="${DATABASE_BACKUP_KEEP:-30}"

cd "$PROJECT_DIR"
git pull --ff-only

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r backend/requirements.txt
(
  cd backend
  "$VENV_DIR/bin/python" manage.py backup_workspace_db --destination "$DATABASE_BACKUP_DIR" --keep "$DATABASE_BACKUP_KEEP"
  "$VENV_DIR/bin/python" manage.py migrate --noinput
  "$VENV_DIR/bin/python" manage.py collectstatic --noinput
)

npm ci
VITE_API_URL=/api npm run build

sudo install -m 0644 workspace-django.service "/etc/systemd/system/$SERVICE_NAME"
sudo install -m 0644 workspace-social-sync.service "/etc/systemd/system/$SYNC_SERVICE_NAME"
sudo install -m 0644 workspace-social-sync.timer "/etc/systemd/system/$SYNC_TIMER_NAME"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl enable --now "$SYNC_TIMER_NAME"
sudo systemctl restart "$SERVICE_NAME"

for attempt in $(seq 1 "$HEALTH_RETRIES"); do
  if curl --fail --silent --header "Host: $HEALTH_HOST" "$HEALTH_URL" >/dev/null 2>&1; then
    curl --fail --silent --show-error --header "Host: $HEALTH_HOST" "$HEALTH_URL"
    echo
    echo "Deploy completed successfully."
    exit 0
  fi

  echo "Waiting for Django API ($attempt/$HEALTH_RETRIES)..."
  sleep "$HEALTH_DELAY_SECONDS"
done

echo "ERROR: Django API did not become ready at $HEALTH_URL (Host: $HEALTH_HOST)" >&2
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true
exit 1
