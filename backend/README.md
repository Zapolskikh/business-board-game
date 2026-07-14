# Backend «Города влияния»

Backend разделён на независимые слои:

- `city_engine` — чистый домен без FastAPI и Redis;
- `city_bots` — оценка только легальных переходов движка;
- `simulation` — production-партии и Markdown-отчёты;
- `city_rooms` — lobby, scrypt-пароли и `RoomRepository`;
- `app` — FastAPI REST-адаптер.

`city_engine.apply(state, command)` не изменяет входной snapshot и возвращает новый `GameState` с
доменными событиями. Человек, серверный бот и симулятор проходят один и тот же путь команд.

## REST

```text
GET    /api/city/meta
GET    /api/city/rooms
POST   /api/city/rooms
GET    /api/city/rooms/{room_id}
POST   /api/city/rooms/{room_id}/join
POST   /api/city/rooms/{room_id}/seats
POST   /api/city/rooms/{room_id}/start
GET    /api/city/rooms/{room_id}/state?viewer_id=...&after_revision=...
POST   /api/city/rooms/{room_id}/commands
```

Закрытые запросы требуют пароль комнаты. Команды дополнительно проверяют человеческое место,
`expected_revision` и `command_id`. Проекция скрывает RNG, порядок колод, пароли и руки соперников.

Memory-репозиторий используется локально и в тестах. `UpstashRoomRepository` хранит JSON, обновляет
его атомарным compare-and-set по revision и применяет inactivity TTL. По умолчанию комната целиком удаляется
через 30 минут после последнего изменения; polling срок не продлевает. Значение настраивается через
`ROOM_INACTIVITY_SECONDS`, а `ROOM_TTL_WAITING`, `ROOM_TTL_PLAYING`, `ROOM_TTL_FINISHED` могут переопределить
его для отдельного статуса.

## Проверки

Из корня проекта:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend
```
