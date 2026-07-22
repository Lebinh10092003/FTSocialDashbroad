# Deploy FT Workspace (React + Django + SQLite)

This deployment is isolated to `workspace.fermat.vn`. It must be installed as a separate Nginx server block; do not modify the `khaothi.fermat.vn` configuration.

## One-time VPS setup

```bash
sudo mkdir -p /var/www/ft-workspace
sudo chown -R workspace:www-data /var/www/ft-workspace
cd /var/www/ft-workspace
git clone <repository-url> .
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

Edit `backend/.env`: set a production `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS=workspace.fermat.vn`, and `CSRF_TRUSTED_ORIGINS=https://workspace.fermat.vn`.

Install the dedicated service and Nginx config:

```bash
sudo cp workspace-django.service /etc/systemd/system/workspace-django.service
sudo cp workspace-social-sync.service /etc/systemd/system/workspace-social-sync.service
sudo cp workspace-social-sync.timer /etc/systemd/system/workspace-social-sync.timer
sudo systemctl daemon-reload
sudo systemctl enable workspace-django.service
sudo systemctl enable --now workspace-social-sync.timer
sudo cp nginx-workspace.conf /etc/nginx/sites-available/workspace.fermat.vn
sudo ln -s /etc/nginx/sites-available/workspace.fermat.vn /etc/nginx/sites-enabled/workspace.fermat.vn
sudo nginx -t
sudo systemctl reload nginx
```

The `User` and filesystem paths in both service files must match the deployment account and directory. The API listens only on `127.0.0.1:8001`; Nginx is the public entrypoint. The timer runs at 06:00 in `Asia/Ho_Chi_Minh`, refreshes the most recent 365 days and stores daily metrics snapshots for the rolling one-year window in `backend/db.sqlite3`.

Check the schedule and the last run with:

```bash
systemctl list-timers workspace-social-sync.timer
sudo systemctl status workspace-social-sync.service
sudo journalctl -u workspace-social-sync.service -n 100 --no-pager
```

## Deploy an update

```bash
cd /var/www/ft-workspace
bash deploy.sh
```

The script pulls the current branch, creates/reuses `.venv`, installs Python dependencies, runs migrations and collectstatic, builds React with `VITE_API_URL=/api`, installs/enables the isolated social-sync timer, restarts Gunicorn through systemd, then checks `http://127.0.0.1:8001/api/health/`.

## Local development

```bash
cp backend/.env.example backend/.env
cp .env.example .env.local
cd backend
python manage.py migrate
python manage.py runserver
```

In another terminal:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. The frontend reads `VITE_API_URL=http://127.0.0.1:8000/api` from `.env.local`; SQLite remains at `backend/db.sqlite3` and is not committed.
