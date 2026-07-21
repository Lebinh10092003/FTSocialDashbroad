#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${FT_BRANCH:-main}"
SERVICE_NAME="${FT_SERVICE_NAME:-ft-workspace}"
BIND_ADDRESS="${FT_BIND_ADDRESS:-127.0.0.1:8000}"
WORKERS="${FT_GUNICORN_WORKERS:-3}"
VENV_DIR="${FT_VENV_DIR:-$ROOT_DIR/.venv}"
PID_FILE="$ROOT_DIR/.gunicorn.pid"
LOG_DIR="$ROOT_DIR/logs"

cd "$ROOT_DIR"

echo "[FT] Cập nhật mã nguồn từ origin/$BRANCH..."
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[FT] LỖI: Chưa có file .env trên VPS."
  echo "[FT] Hãy tạo .env từ .env.example và điền cấu hình production trước."
  exit 1
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "[FT] Tạo môi trường Python..."
  python3 -m venv "$VENV_DIR"
fi

echo "[FT] Cài dependency backend..."
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r backend/requirements.txt

echo "[FT] Cài dependency và build frontend..."
npm install --no-audit --no-fund
npm run lint
npm run build

echo "[FT] Cập nhật cơ sở dữ liệu và static files..."
"$VENV_DIR/bin/python" backend/manage.py migrate --noinput
"$VENV_DIR/bin/python" backend/manage.py shell -c "from django.contrib.auth.models import User; User.objects.filter(username='admin@ftsocial.com').exists() or User.objects.create_superuser('admin@ftsocial.com', 'admin@ftsocial.com', 'Admin123')"
"$VENV_DIR/bin/python" backend/manage.py collectstatic --noinput
"$VENV_DIR/bin/python" backend/manage.py check

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" --no-legend 2>/dev/null | grep -q "${SERVICE_NAME}.service"; then
  echo "[FT] Khởi động lại dịch vụ systemd: $SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME" | head -n 20
else
  echo "[FT] Không tìm thấy systemd service '$SERVICE_NAME'. Dùng Gunicorn daemon dự phòng."
  mkdir -p "$LOG_DIR"

  if [[ -f "$PID_FILE" ]]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" || true
      for _ in {1..20}; do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 0.25
      done
    fi
    rm -f "$PID_FILE"
  fi

  "$VENV_DIR/bin/gunicorn" \
    --chdir backend \
    ft_backend.wsgi:application \
    --bind "$BIND_ADDRESS" \
    --workers "$WORKERS" \
    --timeout 120 \
    --daemon \
    --pid "$PID_FILE" \
    --access-logfile "$LOG_DIR/gunicorn-access.log" \
    --error-logfile "$LOG_DIR/gunicorn-error.log"

  sleep 1
  if [[ ! -f "$PID_FILE" ]] || ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "[FT] LỖI: Gunicorn không khởi động được."
    tail -n 50 "$LOG_DIR/gunicorn-error.log" 2>/dev/null || true
    exit 1
  fi
fi

echo "[FT] Kiểm tra API..."
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error "http://${BIND_ADDRESS}/api/health" >/dev/null
fi

echo "[FT] Cập nhật VPS hoàn tất."
