# Production deploy на Vercel

`vercel.json` использует Vercel Services: Vite публикуется в `/`, FastAPI обслуживает `/api/*`,
`/health` и `/ready`. Схема соответствует актуальной документации
[Vercel Services](https://vercel.com/docs/services) и
[FastAPI runtime](https://vercel.com/docs/frameworks/backend/fastapi).

## Настройка проекта

1. Импортировать корень репозитория в Vercel и выбрать Framework Preset **Services**.
2. Подключить существующую базу `upstash-kv-blue-tree` к production и preview окружениям.
3. Проверить наличие одной из пар переменных:
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`;
   - `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
4. Установить `ROOM_STORE=upstash`. На Vercel приложение также намеренно откажется создавать комнаты,
   если persistent credentials отсутствуют, вместо незаметного хранения в памяти функции.
5. Включить Fluid Compute и разместить функцию как можно ближе к primary region Upstash.
6. Привязать домен после успешного preview smoke.

Секреты не добавляются в Git и не передаются в `VITE_*`: они нужны только backend service.

## Проверка preview

```text
GET /health -> {"status":"ok"}
GET /ready  -> {"status":"ready","store":"UpstashRoomRepository"}
```

Затем в двух приватных окнах браузера:

1. создать комнату и занять два человеческих места;
2. добавить бота с выбранной моделью и специализацией;
3. начать игру, выполнить команды обоих людей и дождаться хода бота;
4. перезагрузить обе вкладки, снова ввести пароль и выбрать прежние места;
5. убедиться, что revision, руки и текущее состояние сохранились;
6. отправить две команды с одной старой revision и проверить `409 Conflict`.

## Квоты и наблюдение

На июль 2026 free tier Upstash включает 500 000 команд в месяц и 256 MB. Текущий клиент делает один
маленький GET revision примерно раз в 5 секунд на активного игрока и раз в 20 секунд в скрытой вкладке;
полный snapshot читается только после изменения revision, а после завершения игры polling прекращается.
Список комнат обновляется раз в 15 секунд и кратко кэшируется CDN.

Для первых десятков нерегулярно активных игроков free tier разумен, но перед рекламой нужно включить
алерты и ежедневно смотреть Requests/Data Size в Upstash. Актуальные лимиты:
[Upstash pricing](https://upstash.com/pricing/redis),
[metrics](https://upstash.com/docs/redis/howto/metrics-and-charts). При приближении к 70% месячной квоты
перейти на pay-as-you-go с бюджетным лимитом; текущая цена указана как $0.20 за 100 000 команд.

Также проверить Vercel Function duration и ошибки 429/5xx. Локальный rate limiter — страховка одного
инстанса; глобальные ограничения создания комнат и подбора паролей следует продублировать в Vercel
Firewall до публичной рекламы.

## Rollback

- откатить deployment через Vercel Instant Rollback;
- не удалять Upstash keys `city:room:*` и `city:rooms:active`;
- предыдущий backend сможет читать комнаты только при совместимой `schema_version`/`rules_version`,
  поэтому перед будущими несовместимыми миграциями обязателен отдельный snapshot/migrator.
