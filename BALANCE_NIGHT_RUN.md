# Ночной балансный прогон — инструкция для агента

Ты запускаешь пакет балансных симуляций «Города влияния» на отдельной машине и сдаёшь отчёты.
Работаешь автономно: человек проверит результат утром. **Код игры, ботов и контента не меняешь** —
только запускаешь, собираешь и коммитишь отчёты. Если что-то падает, остановись и опиши ошибку (см. «Если
что-то пошло не так»), не чини движок сам.

## Что проверяем

Балансный пакет 2026-10 (`BALANCE_PATCH_2026-10.md`, правила `city-1.17.0`, контент
`city-content-2026-10-02`) уже внедрён: серые операции на кубике, новая Защита, дороже слоты, дешевле
карты, поддержка отстающему, правки объектов, проектов и ролей. Нужно измерить, как игра ведёт себя
после патча, и сравнить с базовой линией до него: `docs/balance-reports/2026-10-01-pre-patch/`.

Инструменты (в `backend/simulation/`):

- `tournament.py` — турнир четырёх ботов (Reborn, Ledger, Oracle, BorisTheTraxer), отчёт `.md` и все
  счётчики `.json`. Флаги: `--games`, `--players`, `--rotations` (повторов одной раздачи с поворотом
  рассадки; ставь равным числу игроков), `--forks` (контрфактических развилок на партию),
  `--fork-focus` (развилки только в решения из файла), `--lineup`, `--seed`, `--workers`, `--output`.
- `suspects.py` — читает `.json` турнира и пишет список подозрительных решений для `--fork-focus`.

## 1. Подготовка

```bash
git clone https://github.com/Zapolskikh/business-board-game.git
cd business-board-game
git checkout main && git pull
python -m venv .venv
# Windows: .venv\Scripts\activate   ·   Linux/macOS: source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cd backend
```

Во всех командах ниже рабочая папка — `backend/`, и нужны две переменные окружения:

```bash
export PYTHONPATH=.            # Windows PowerShell: $env:PYTHONPATH = "."
export PYTHONIOENCODING=utf-8  # Windows PowerShell: $env:PYTHONIOENCODING = "utf-8"
```

Проверка, что всё на месте (обязательно, до прогона):

```bash
python -m pytest -q -p no:warnings
```

Все тесты должны пройти. Если нет — не запускай прогон, сообщи.

`WORKERS` — число ядер минус 2 (на 24 ядрах — 20, на 8 — 6). Ниже `$WORKERS` подставь это число.

## 2. Оценка времени

На 24-ядерной машине 480 партий на четверых с 8 развилками заняли 53 минуты при 20 процессах — около
2.2 минуты процессорного времени на партию; почти всё уходит на Oracle (до 5 с на ход) и на развилки.
Партии на троих и двоих дешевле примерно пропорционально числу игроков. Контрольные столы без Oracle и
без развилок — в 5–10 раз быстрее. Время каждого шага выше — оцени заранее по своей машине и, если весь
пакет не помещается в ночь, урежь число партий **пропорционально**, сохранив кратность (см. таблицу).

## 3. Последовательность

Выполняй строго по порядку. Каждая команда пишет `ИМЯ.md`, `ИМЯ.json` и прогресс `[n/N]` в stderr.
Логи сохраняй рядом: `... 2> ИМЯ.log`.

| Шаг | Что | Команда | Партий (кратность) |
|---|---|---|---|
| 3.1 | Смешанный стол, 4 игрока | `python -m simulation.tournament --games=960 --players=4 --rotations=4 --forks=8 --seed=3001 --workers=$WORKERS --output=TOURNAMENT_4p.md 2> TOURNAMENT_4p.log` | 960 (кратно 96) |
| 3.2 | Смешанный стол, 3 игрока | `python -m simulation.tournament --games=720 --players=3 --rotations=3 --forks=8 --seed=3002 --workers=$WORKERS --output=TOURNAMENT_3p.md 2> TOURNAMENT_3p.log` | 720 (кратно 72) |
| 3.3 | Смешанный стол, 2 игрока | `python -m simulation.tournament --games=600 --players=2 --rotations=2 --forks=8 --seed=3003 --workers=$WORKERS --output=TOURNAMENT_2p.md 2> TOURNAMENT_2p.log` | 600 (кратно 24) |
| 3.4 | Контроль: 4 × Reborn | `python -m simulation.tournament --games=240 --lineup=expert,expert,expert,expert --rotations=4 --forks=0 --seed=3011 --workers=$WORKERS --output=TOURNAMENT_ctrl_reborn.md 2> TOURNAMENT_ctrl_reborn.log` | 240 |
| 3.5 | Контроль: 4 × Ledger | `python -m simulation.tournament --games=240 --lineup=ledger,ledger,ledger,ledger --rotations=4 --forks=0 --seed=3012 --workers=$WORKERS --output=TOURNAMENT_ctrl_ledger.md 2> TOURNAMENT_ctrl_ledger.log` | 240 |
| 3.6 | Контроль: 4 × Boris | `python -m simulation.tournament --games=240 --lineup=boris,boris,boris,boris --rotations=4 --forks=0 --seed=3013 --workers=$WORKERS --output=TOURNAMENT_ctrl_boris.md 2> TOURNAMENT_ctrl_boris.log` | 240 |
| 3.7 | Контроль: 4 × Oracle (если хватает времени) | `python -m simulation.tournament --games=48 --lineup=oracle,oracle,oracle,oracle --rotations=4 --forks=0 --seed=3014 --workers=$WORKERS --output=TOURNAMENT_ctrl_oracle.md 2> TOURNAMENT_ctrl_oracle.log` | 48 |
| 3.8 | Подозрительные решения | `python -m simulation.suspects TOURNAMENT_4p.json --output=suspects_4p.txt` и то же для `TOURNAMENT_3p.json` → `suspects_3p.txt`, `TOURNAMENT_2p.json` → `suspects_2p.txt` | — |
| 3.9 | Объединить списки | все три `suspects_*.txt` в один `suspects.txt` без повторов, не больше 40 строк, порядок — сначала 4p | — |
| 3.10 | Прицельные развилки, 4 игрока | `python -m simulation.tournament --games=480 --players=4 --rotations=4 --forks=8 --fork-focus=suspects.txt --seed=3021 --workers=$WORKERS --output=TOURNAMENT_focus_4p.md 2> TOURNAMENT_focus_4p.log` | 480 |

Пустые или битые входные данные — не повод выдумывать: если шаг 3.8 дал пустой список, шаг 3.10
пропусти и напиши об этом в сводке.

## 4. Куда положить результаты

Файлы `TOURNAMENT_*` в `.gitignore` (в любой папке), поэтому в репозиторий их кладут **под другими
именами**:

```
docs/balance-reports/<YYYY-MM-DD>-post-patch/
  4p.md   4p.json   3p.md   3p.json   2p.md   2p.json
  ctrl_reborn.md   ctrl_ledger.md   ctrl_boris.md   ctrl_oracle.md   (json контролей не нужны)
  suspects.txt   suspects_4p.md   suspects_3p.md   suspects_2p.md
  focus_4p.md   focus_4p.json
  logs/   (все *.log)
  SUMMARY.md
```

Коммит — в отдельную ветку, не в `main`:

```bash
git checkout -b balance-night-<YYYY-MM-DD>
git add docs/balance-reports/<YYYY-MM-DD>-post-patch
git commit -m "Ночной балансный прогон <YYYY-MM-DD>: 4p/3p/2p, контрольные столы, прицельные развилки"
git push -u origin balance-night-<YYYY-MM-DD>
```

## 5. SUMMARY.md — что написать

Коротко, по-русски, только факты из отчётов, с пометкой значимости, как она стоит в отчёте
(«**значимо**» / «тенденция» / «шум»). Выводы делай только по «значимо».

1. **Параметры**: машина (ядра), `WORKERS`, время каждого шага, коммит `main`, на котором шёл прогон.
2. **Боты** (4p, 3p, 2p): доля побед и средний счёт каждого; разница внутри раздачи.
3. **Сравнение с базовой линией** `docs/balance-reports/2026-10-01-pre-patch/4p.md` (только для 4p):
   что сдвинулось значимо — места, динамика (лидер после 5-го и 10-го раунда, камбэк, очки за раунд по
   местам), разнообразие районов победителей, доля бонусов в счёте победителя.
4. **Серые операции**: запусков за партию, доли исходов кубика (провал / слабый / полный), ценность за
   действие, сколько погашено Защитой; кто запускает (бот, роль). Стали ли сильные боты их играть.
5. **Изменённое патчем**: слоты, карты (ценность покупки двух карт против цены), новые карты, роли
   (Силовик, Мафиози, Аферист, вето), объекты и проекты из пакета — что видно по каждому.
6. **Контрольные столы**: что из находок смешанного стола повторяется у одинаковых ботов (устойчиво),
   а что — нет (артефакт состава).
7. **Прицельные развилки**: таблица из раздела «Контрфактические развилки» отчёта `focus_4p.md` по
   решениям из `suspects.txt` — решение, развилок, «относительно стола», вывод.
8. **Аномалии**: всё из раздела «Аномалии» (циклы, кучи, рекордные партии с сидами).
9. **Открытые вопросы**: что выглядит перекошенным и требует решения человека. Свои предложения правок
   можно дать списком, но **ничего не меняй в коде**.

## Если что-то пошло не так

- **Тесты не прошли на шаге 1** — прогон не запускай; в сводке: команда, вывод `pytest`.
- **Турнир упал** (traceback в логе) — сохрани лог, перезапусти шаг один раз; если упал снова,
  переходи к следующему шагу и опиши падение в сводке (шаг, сид, текст ошибки).
- **Не хватает времени** — урежь число партий у шагов 3.1–3.3 и 3.10 пропорционально (сохраняя
  кратность из таблицы), контроль 3.7 пропусти первым. Напиши в сводке, что урезано.
- **Самопроверка в конце отчёта** («расхождений разложения дохода по объектам») не равна 0 — это
  ошибка измерения; отметь её в сводке первым пунктом.
