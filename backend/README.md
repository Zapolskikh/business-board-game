# Backend: движок, симуляция и API

Три Python-пакета, запускаются из каталога `backend/`:

| Пакет | Назначение | Зависит от |
| --- | --- | --- |
| `game_engine` | Чистая логика игры: правила, клетки, роли, состояние. | стандартная библиотека |
| `simulation` | Боты и прогон партий для поиска дисбаланса. | `game_engine` |
| `app` | FastAPI-приложение (REST поверх движка). | `game_engine` |

Данные (роли, клетки, поля, баланс) — в [data/](data/), это JSON. Числа и контент меняются
без изменения кода.

## Установка

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt -r requirements-dev.txt
```

## Команды

```bash
pytest                                  # тесты движка и симуляции
python -m simulation.cli --games 500    # прогон 500 партий + отчёт по балансу
uvicorn app.main:app --reload           # REST API на :8000
```

## Поток «действие → состояние»

```text
клиент/бот  --ACTION-->  GameEngine.apply_action()  --> {state, events}
```

Когда движку нужно решение игрока (купить/не купить, выбрать цель), он выставляет
`state.pending_decision` с вариантами. И человек в браузере, и бот отвечают одинаковым
действием `RESOLVE_DECISION` с выбранным `option_id`. Благодаря этому один код обслуживает
и реальную игру, и симуляцию.

## Как добавить новую клетку

1. Реализуйте класс-поведение в одном из модулей `game_engine/cells/*.py`
   (или создайте новый файл и импортируйте его в `game_engine/cells/__init__.py`):

   ```python
   from game_engine.cells.base import BaseCell
   from game_engine.registry import register_cell

   @register_cell("my_market")
   class MyMarketCell(BaseCell):
       def on_land(self, engine, player, cell):
           engine.grant_money(player, engine.balance.ring_value("fillers.bonus", cell.ring),
                              reason="Рынок: бонус")
   ```

2. Добавьте метаданные типа в [data/cells.json](data/cells.json) (заголовок, покупаемость,
   теги ролей, параметры).
3. Добавьте клетку в раскладку поля [data/boards/board_72.json](data/boards/board_72.json)
   (счётчик в распределении круга) — генератор поля сам её разместит.

Готово: движок, боты и UI подхватят клетку автоматически.

## Как добавить роль

1. Добавьте роль в [data/roles.json](data/roles.json).
2. В нужных клетках обработайте её в методе `role_effect`/`on_land` (ветка по `player.role`).

## Как поменять размер поля

Отредактируйте распределение в [data/boards/board_72.json](data/boards/board_72.json) или
создайте новый файл `data/boards/board_XX.json` и запустите симуляцию с
`--board board_XX`. Ключи `ring_sizes` и `distribution` задают число клеток и их состав.

## Как менять баланс

Все числа — в [data/balance.json](data/balance.json): бонусы Start/банка по кругам, цены
объектов, штрафы, множители казино, цена Крыши, условия победы. Прогоняйте
`python -m simulation.cli` после изменений, чтобы увидеть эффект на win-rate ролей.
