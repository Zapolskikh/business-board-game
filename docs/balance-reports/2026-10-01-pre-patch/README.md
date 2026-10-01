# Базовая линия до балансного пакета 2026-10

Правила `city-1.16.0`, контент `city-content-2026-10-01b` — **до** правок из `BALANCE_PATCH_2026-10.md`.
Нужна как точка сравнения для прогонов после патча.

- `4p.md` — отчёт турнира: 480 партий на 4 игрока (Reborn, Ledger, Oracle, BorisTheTraxer),
  120 раздач × 4 поворота рассадки, 3194 контрфактические развилки, сид 2026.
- `4p.json` — все счётчики того же прогона (для `simulation.suspects` и пересчётов).

Команда:

    python -m simulation.tournament --games=480 --workers=20 --rotations=4 --forks=8 --output=TOURNAMENT_4p.md
