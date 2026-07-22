#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-workspace-django.service}"
SYNC_SERVICE_NAME="${SYNC_SERVICE_NAME:-workspace-social-sync.service}"
SYNC_TIMER_NAME="${SYNC_TIMER_NAME:-workspace-social-sync.timer}"

cd "$PROJECT_DIR"
git pull --ff-only

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r backend/requirements.txt
(
  cd backend
  "$VENV_DIR/bin/python" manage.py migrate --noinput
  "$VENV_DIR/bin/python" manage.py collectstatic --noinput
)

npm ci
VITE_API_URL=/api npm run build
sudo install -m 0644 workspace-social-sync.service "/etc/systemd/system/$SYNC_SERVICE_NAME"
sudo install -m 0644 workspace-social-sync.timer "/etc/systemd/system/$SYNC_TIMER_NAME"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SYNC_TIMER_NAME"
sudo systemctl restart "$SERVICE_NAME"
curl --fail --silent --show-error http://127.0.0.1:8001/api/health/
echo
