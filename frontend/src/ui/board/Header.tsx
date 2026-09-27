import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { CityMeta, GameState, PlayerState } from "../../online/types";
import { otherUiLabel, switchUi } from "../../online/uiVersion";
import { CardPopover } from "../primitives/CardPopover";
import { ActionsDetails, DefenceDetails, ScoreDetails } from "./headerPopovers";
import { atScandalRisk, scandalLimit } from "../lib/board";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  label: string;
};

/* Оба компонента бывают Radix-триггерами через `asChild`, поэтому ref обязан доходить
 * до настоящей кнопки. Иначе поповер существует, но остаётся в скрытой позиции. */
const Res = forwardRef<HTMLButtonElement, ButtonProps>(function Res(
  { children, label, className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={`flex items-center gap-1 rounded-[14px] px-2 py-[3px] text-[13px] font-bold
        whitespace-nowrap hover:bg-panel-3 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

const HudStat = forwardRef<HTMLButtonElement, ButtonProps>(function HudStat(
  { children, label, className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={`grid min-w-0 content-center gap-px px-2.5 py-1 text-left hover:bg-panel-3 ${className}`}
      {...rest}
    >
      <span className="text-[8px] font-semibold uppercase tracking-[0.1em] text-ink-dim">{label}</span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-bold">{children}</span>
    </button>
  );
});

const Sep = () => <span className="h-4 w-px shrink-0 self-center bg-line-2" />;

/* Шапка: слева кто мы и где, по центру всё, на что смотрят перед кликом, справа выходы.
 *
 * Ресурсы кликабельны — каждый открывает поповер с тем, что раньше жило в атрибуте title.
 */
export function Header({
  game,
  me,
  meta,
  roomName,
  unseenEvents,
  compact = false,
  onChronicle,
  onScore,
  onRules,
  onExit,
}: {
  game: GameState;
  me: PlayerState;
  meta: CityMeta;
  roomName: string;
  unseenEvents: number;
  /** Вертикальная раскладка: два яруса вместо трёх колонок, у кнопок только значки. */
  compact?: boolean;
  onChronicle: () => void;
  onScore: () => void;
  onRules: () => void;
  onExit: () => void;
}) {
  const score = game.score_breakdown?.[me.id]?.total ?? 0;
  const risky = atScandalRisk(me);
  const role = meta.roles.find(item => item.id === me.role);
  const income = game.round_forecast;
  /* Подпись у кнопки есть всегда — на узком экране она уезжает в aria-label, а не пропадает.
   * Кнопки те же самые: разница только в том, показывать ли слово рядом со значком. */
  const caption = (text: string) => (compact ? "" : ` ${text}`);

  if (compact) {
    return (
      <header className="grid gap-1 rounded-panel border border-line bg-topbar px-1.5 py-1">
        <div className="flex items-center gap-1.5">
          <b className="text-[12px] font-extrabold">Город влияния</b>
          <span className="text-3xs whitespace-nowrap text-ink-muted">
            {game.round_number}/{game.max_rounds}
          </span>
          <span className="ml-auto flex gap-1">{buttons()}</span>
        </div>
        {/* Ресурсы одной строкой и мельче: шапка на телефоне — это высота, которой не будет
          * у рынка. Размер задаётся обёрткой, чтобы не тащить флаг через шесть вызовов. */}
        <div
          className="flex items-center gap-x-0.5 overflow-hidden rounded-[12px] border border-line
            bg-panel-2 px-1 py-0.5 [&_button]:gap-0.5 [&_button]:px-1 [&_button]:py-0
            [&_button]:text-[11px]"
        >
          {compactChips()}
        </div>
      </header>
    );
  }

  return (
    /* Своя ступень светлоты, между подложкой и панелями: шапка не входит ни в одну из
     * функциональных зон, и на общем `bg-panel` она читалась как ещё одна панель. */
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-panel
      border border-line bg-topbar px-2.5 py-1.5">
      <div className="flex items-baseline gap-2.5">
        <b className="text-base font-extrabold">Город влияния</b>
        <span className="text-[11px] text-ink-muted">
          Раунд {game.round_number} / {game.max_rounds}
        </span>
        <em className="text-3xs not-italic text-ink-dim">{roomName}</em>
      </div>

      <div
        data-ui="player-hud"
        className="flex min-w-0 max-w-[760px] items-stretch justify-self-center overflow-hidden rounded-lg
          border border-line bg-panel-2"
      >
        {dashboard()}
      </div>

      <div className="flex gap-1.5">{buttons()}</div>
    </header>
  );

  /* Ресурсы и кнопки — один и тот же список для обеих раскладок; различается только обёртка.
   * Объявлены функциями после `return`: подъём объявлений позволяет держать их внизу файла,
   * рядом друг с другом, а не разрывать разметку шапки на две части. */
  function compactChips() {
    return (
      <>
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <Res label="Очки" className="text-points">★ {score}</Res>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <Res label="Деньги" className="text-money">● {me.money}$</Res>
        </CardPopover>
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <Res label="Влияние" className="text-influence">◆ {me.influence}</Res>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<DefenceDetails game={game} me={me} />}>
          <Res label="Крыши" className="text-defence">
            🛡 {me.roofs}
            <span className="text-2xs font-normal text-ink-dim">/{me.roof_limit}</span>
          </Res>
        </CardPopover>
        <CardPopover side="bottom" align="center" content={<DefenceDetails game={game} me={me} />}>
          <Res label="Скандалы" className={risky ? "text-warning" : "text-ink-muted"}>
            <span className={risky ? "text-[var(--color-warning)]" : undefined}>
              ⚠ {me.scandals}
              <span className="text-2xs font-normal text-ink-dim">/{scandalLimit(me)}</span>
            </span>
          </Res>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ActionsDetails game={game} />}>
          <Res label="Действия">
            {!compact && "Действия"}
            <span className="ml-0.5 flex gap-[3px]">
              {Array.from({ length: Math.max(3, game.actions_left) }).map((_, index) => (
                <i
                  key={index}
                  className={`size-2 rounded-full ${
                    index < game.actions_left ? "bg-good" : "bg-line-2"
                  }`}
                />
              ))}
            </span>
          </Res>
        </CardPopover>
      </>
    );
  }

  function dashboard() {
    return (
      <>
        <div className="flex min-w-[112px] items-center gap-2 px-2.5 py-1">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full border border-line-2 bg-panel text-sm"
            style={{ color: role?.color }}
          >
            {role?.icon ?? "👤"}
          </span>
          <span className="grid min-w-0 gap-px">
            <span className="text-[8px] font-semibold uppercase tracking-[0.1em] text-ink-dim">Ваша роль</span>
            <b className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-ink">
              {role?.title ?? "Без роли"}
            </b>
          </span>
        </div>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label="Счёт" className="text-points">★ {score}</HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label="Ресурсы">
            <span className="text-money">● {me.money}$</span>
            <span className="text-influence">◆ {me.influence}</span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label="Доход раунда">
            <span className="text-money">+{income?.money.total ?? 0}$</span>
            <span className="text-influence">+{income?.influence.total ?? 0}◆</span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label="Город">
            <span className="text-good">▦ {me.assets.length}/{me.capacity}</span>
            <span className="text-points">🏛 {me.projects.length}</span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<DefenceDetails game={game} me={me} />}>
          <HudStat label="Защита">
            <span className="text-defence">🛡 {me.roofs}/{me.roof_limit}</span>
            <span className={risky ? "text-warning" : "text-ink-muted"}>
              ⚠ {me.scandals}/{scandalLimit(me)}
            </span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="end" content={<ActionsDetails game={game} />}>
          <HudStat label="Действия">
            <span className="flex gap-[3px]">
              {Array.from({ length: Math.max(3, game.actions_left) }).map((_, index) => (
                <i
                  key={index}
                  className={`size-2 rounded-full ${index < game.actions_left ? "bg-good" : "bg-line-2"}`}
                />
              ))}
            </span>
            <span className="text-ink-muted">{game.actions_left}</span>
          </HudStat>
        </CardPopover>
      </>
    );
  }

  function buttons() {
    const shape = `rounded-md border border-line bg-panel-2 text-[11.5px] whitespace-nowrap
      hover:border-accent ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`;
    return (
      <>
        {/* Счёт и доход — в шапке, рядом с остальными моими числами, а не в панели
          * действий: справа должно остаться то, что можно нажать в свой ход. */}
        <button type="button" onClick={onScore} aria-label="Счёт и доход" className={shape}>
          🏆{caption("Счёт и доход")}
        </button>
        <button
          type="button"
          onClick={onChronicle}
          aria-label="Хроника"
          className={`relative ${shape}`}
        >
          📜{caption("Хроника")}
          {unseenEvents > 0 && (
            <b className="absolute -right-1.5 -top-1.5 min-w-4 rounded-[9px] bg-bad px-1 text-center
              text-3xs font-bold text-[#2a0a0a]">
              {Math.min(unseenEvents, 99)}
            </b>
          )}
        </button>
        <button type="button" onClick={onRules} aria-label="Правила" className={shape}>
          📖{caption("Правила")}
        </button>
        {/* Переключение на старый экран и обратно. Партия живёт на сервере, поэтому
          * перезагрузка ничего не теряет — можно сравнивать интерфейсы прямо по ходу игры. */}
        <button
          type="button"
          onClick={switchUi}
          title="Переключиться на другой интерфейс — партия на сервере не прервётся"
          aria-label={`Переключиться на ${otherUiLabel}`}
          className={`${shape} text-ink-muted hover:text-ink`}
        >
          ⇆{caption(otherUiLabel)}
        </button>
        <button type="button" onClick={onExit} aria-label="Вернуться в комнаты" className={shape}>
          ←{caption("Комнаты")}
        </button>
      </>
    );
  }
}

/* Полоса оставлена только для исключительных состояний. Текущий ход теперь виден прямо
 * на карточке игрока, поэтому отдельная пустая строка «Ваш ход / ход игрока» не нужна. */
export function StatusBar({
  game,
  me,
  busy,
  error,
}: {
  game: GameState;
  me: PlayerState;
  busy: boolean;
  error: string;
}) {
  const base = "flex h-[26px] items-center gap-2 rounded-md border px-2.5 text-[11.5px]";

  if (error) {
    return (
      <div className={`${base} border-[#7d3c45] bg-[#2a1519] text-[#ffb3b3]`}>
        <span>⚠</span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{error}</span>
      </div>
    );
  }
  if (busy) {
    return (
      <div className={`${base} border-[#34507a] bg-[#1a2740] text-[#bcd6f5]`}>
        <span className="size-2.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        <span>Сервер выполняет команду и ходы ботов…</span>
      </div>
    );
  }
  if (game.status === "finished") {
    return (
      <div className={`${base} border-[#6b5518] bg-[#2a2411] text-gold`}>🏁 Партия окончена</div>
    );
  }
  if (me.jail_turns > 0) {
    return (
      <div className={`${base} border-[#7d3c45] bg-[#2a1519] text-[#ffb3b3]`}>
        🚔 Тюрьма: пропускаете ходов {me.jail_turns}
      </div>
    );
  }
  return null;
}
