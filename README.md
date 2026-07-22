# FT Workspace

FT Workspace uses a React/Vite frontend and a Django REST Framework backend. All local data is stored in `backend/db.sqlite3` and is excluded from Git.

## Workspaces

- Truyền thông
- Khảo thí
- Email Builder
- Đào tạo số

## Local development

Create local environment files once:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item .env.example .env.local
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Terminal 1:

```powershell
cd backend
python manage.py migrate
python manage.py runserver
```

Terminal 2:

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. The frontend reads `VITE_API_URL=http://127.0.0.1:8000/api`; Django uses `backend/db.sqlite3`.

Health endpoint: `GET http://127.0.0.1:8000/api/health/` returns `{"status":"ok"}`.

## Production

Production runs Django through Gunicorn on `127.0.0.1:8001`; Nginx serves `dist` and proxies `/api/` and `/admin/`. See [DEPLOY.md](DEPLOY.md). The Nginx server block is isolated to `workspace.fermat.vn` and does not change `khaothi.fermat.vn`.
