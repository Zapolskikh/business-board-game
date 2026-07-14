# Production-симуляции

Команды выполняются из корня проекта. Отчёт всегда перезаписывается.

## Обычная партия без специализации

```powershell
.\.venv\Scripts\python.exe -m simulation.cli --games=1000 --rounds=15 --players=4 --role-price=3 --bots=oleg,codex,codex,claude
```

Результат: `SIMULATION_RESULTS_any.md`.

## Специалист

`--specialist=2,mafia` означает: второй игрок рационально строит стратегию вокруг роли Мафиози.

```powershell
.\.venv\Scripts\python.exe -m simulation.cli --games=1000 --rounds=15 --players=4 --role-price=3 --bots=oleg,codex,codex,claude --specialist=2,mafia
```

Результат: `SIMULATION_RESULTS_mafia.md`.

Допустимые роли: `capitalist`, `politician`, `journalist`, `fraudster`, `mafia`, `military`.

Допустимые боты: `oleg` (`easy`), `codex` (`medium`), `claude` (`hard`). Старые названия
`easy`, `medium`, `hard` тоже поддерживаются. Порядок в `--bots` соответствует местам за столом.

Для быстрого smoke-теста используйте `--games=10 --workers=1`. По умолчанию большие серии
распараллеливаются между доступными CPU, максимум на 8 процессов.

## Полный тест ботов и всех специалистов

Команда запускает три сбалансированных состава Олег/Codex/Claude, контрольную серию четырёх
универсальных Олегов и шесть серий со специалистом на втором месте:

```powershell
.\.venv\Scripts\python.exe -m simulation.suite --games=300 --rounds=15 --role-price=3 --workers=8
```

`--games` задаёт число партий для каждой из 10 конфигураций. Общий результат записывается в
`SIMULATION_RESULTS_OVERVIEW.md`, подробные specialist-отчёты — в `SIMULATION_RESULTS_<role>.md`.
