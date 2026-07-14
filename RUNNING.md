# Запуск «Города влияния»

Все команды выполняются из корня проекта в PowerShell.

## Первый запуск

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".\backend[dev]"
npm.cmd --prefix frontend install
```

## Локальная разработка

Терминал 1 — backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

Терминал 2 — frontend:

```powershell
npm.cmd --prefix frontend run dev
```

Открыть <http://localhost:5173>. Swagger доступен на <http://localhost:8000/docs>.

## Проверки

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend
npm.cmd --prefix frontend run build
```

Полный балансный smoke через production-движок:

```powershell
.\.venv\Scripts\python.exe -m simulation.cli --games=10 --rounds=15 --players=4 --role-price=3 --bots=oleg,codex,codex,claude --workers=2
```

## Upstash Redis

Локально можно переключить комнаты с памяти на Upstash:

```powershell
$env:ROOM_STORE="upstash"
$env:UPSTASH_REDIS_REST_URL="https://...upstash.io"
$env:UPSTASH_REDIS_REST_TOKEN="..."
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

Секреты не добавлять в `.env`, отслеживаемый Git, или в исходный код.

Для старой Vercel KV-интеграции также распознаются `KV_REST_API_URL` и `KV_REST_API_TOKEN`.

## Vercel локально

При установленном Vercel CLI оба service можно поднять из корня одной командой:

```powershell
vercel dev -L
```

Пошаговый production checklist находится в [DEPLOYMENT.md](DEPLOYMENT.md).
