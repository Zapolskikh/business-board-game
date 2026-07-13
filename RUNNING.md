# Запуск проекта
cd /c/Zapolskikh/business-board-game/frontend && npm run dev
## Первый запуск (однократно)

```bash
# Создать виртуальное окружение и установить зависимости Python
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt -e backend/

# Установить зависимости Node.js
cd frontend && npm install && cd ..
```

## Запуск (каждый раз)

Открыть **два терминала**:

**Терминал 1 — бэкенд (FastAPI) **
```bash
cd backend
../.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

**Терминал 2 — фронтенд (Vite)**
```bash
cd frontend
npm run dev
```

Открыть в браузере: **http://localhost:5173**

## Тесты

```bash
cd backend
../.venv/Scripts/python.exe -m pytest
```

## Симуляция (500 игр)

```bash
cd backend
../.venv/Scripts/python.exe -m simulation.cli --games 500 --board board_72 --seed 42
```
