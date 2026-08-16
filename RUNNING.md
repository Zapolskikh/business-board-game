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

Метрики дизайна (из чего состоят очки, какие действия жмут игроки, когда фиксируется лидер) —
после каждой правки баланса, сверяя с таблицей в `DESIGN_V2.md`:

```powershell
.\.venv\Scripts\python.exe -m simulation.design_metrics --games=40
```

## Партия из терминала (место для ИИ-агента)

`agent_play` — текстовый клиент того же REST API, которым пользуется React. Нужен запущенный
backend. Все состояние сессии (комната, пароль, мой `player_id`) лежит в `.agent_play/`, поэтому
каждая команда — отдельный вызов без аргументов.

```powershell
$env:PYTHONIOENCODING="utf-8"                      # чтобы кириллица не падала в cp1251
.\.venv\Scripts\python.exe -m agent_play new --bots 3 --seed 2026
.\.venv\Scripts\python.exe -m agent_play state       # доска + пронумерованные легальные ходы
.\.venv\Scripts\python.exe -m agent_play do 5        # сыграть ход, напечатанный как [ 5]
.\.venv\Scripts\python.exe -m agent_play do basic_action kind=work --quiet
.\.venv\Scripts\python.exe -m agent_play wait        # ждать хода и нарисовать доску
```

### Дешёвый цикл для стола из нескольких агентов

**Два вызова на ход:** `wait` (сам рисует доску, когда очередь дошла) → `turn` со всеми
действиями хода сразу, включая `end_turn`.

```powershell
.\.venv\Scripts\python.exe -m agent_play wait
.\.venv\Scripts\python.exe -m agent_play turn "6" "basic_action kind=campaign" "end_turn"
```

`do` и `turn` печатают только новые события и короткую сводку со счётчиками и обновлённым списком
ходов — доску они больше не перерисовывают (`--board`, если всё же нужна). Многовариантные
семейства ходов в списке свёрнуты в одну строку и играются по типу:
`do replace_asset asset_uid=… market_uid=…`.

Замер полной партии на 15 раундов вчетвером: **404 вызова и ~800k токенов вывода** в старом цикле
(`state` + `do` на каждое действие) против **120 вызовов и ~120k токенов** в цикле `wait` + `turn`.

Смешанный стол с людьми: `new --capacity 4 --bots 2 --no-start` оставляет свободные места, человек
занимает их в браузере тем же паролем комнаты, затем `agent_play start`. Чтобы наоборот сесть в
готовую комнату: `agent_play join --room <id> --password <pw> --seat 1`.

Прочее: `rooms`, `seats`, `log --limit 25`, `state --json`, `delete`. Каждая отправленная команда
пишется в `.agent_play/journal.jsonl`, так что партию, потерянную при перезапуске процесса
(`ROOM_STORE=auto` держит комнаты в памяти), можно восстановить по журналу.

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
