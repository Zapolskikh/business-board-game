# Город влияния

Пошаговая браузерная стратегия о деньгах, влиянии, районах и борьбе за роли. Ветка
`production-game-engine` переводит игру на авторитетный серверный движок и постоянные комнаты.

## Архитектура

```text
React/Vite -> REST -> FastAPI -> CityRoomService -> city_engine
                                      |
                              Memory / Upstash Redis
```

- `backend/city_engine/` — единственная реализация правил, состояния, replay и RNG;
- `backend/city_bots/` — политики easy (Олег), medium (Codex), hard (Claude), expert (Reborn) и specialist;
- `backend/simulation/` — массовые партии через тот же движок и те же bot policy;
- `backend/city_rooms/` — lobby, пароли, места, optimistic locking и хранилища;
- `backend/app/` — REST API и HTTP hardening;
- `frontend/src/online/` — React-клиент без локальной мутации правил;
- `SIMPLIFICATION_TODO.md` — что осталось доделать по правилам и балансу, с замерами под каждым решением;
- `BALANCE_REVIEW.md` — разбор механик, найденные баги и балансные находки.

Старая игра с кубиком и локальная TypeScript-копия «Города» удалены. Канонический контент находится
в `backend/city_engine/content/catalog.json` и отдаётся клиенту через `GET /api/city/meta`.

## Быстрый старт

Команды для Windows, включая балансные прогоны, находятся в [RUNNING.md](RUNNING.md).

После запуска backend:

- API: <http://127.0.0.1:8000/api/city>;
- Swagger: <http://127.0.0.1:8000/docs>;
- liveness: <http://127.0.0.1:8000/health>;
- readiness хранилища: <http://127.0.0.1:8000/ready>.

При наличии `UPSTASH_REDIS_REST_URL/TOKEN` или `KV_REST_API_URL/TOKEN` комнаты автоматически
сохраняются в Upstash. `ROOM_STORE=memory` принудительно включает локальный режим.
Комната удаляется после 30 минут без игровых изменений; обычное чтение состояния и polling не продлевают срок.
Владелец пароля также может удалить комнату вручную из общего списка.
