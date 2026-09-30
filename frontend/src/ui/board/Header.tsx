import { useTranslation } from "react-i18next";
import * as Popover from "@radix-ui/react-popover";
import { LanguagePicker } from "../../i18n/LanguagePicker";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { CityMeta, GameState, PlayerState } from "../../online/types";
import { CardPopover } from "../primitives/CardPopover";
import { ActionsDetails, DefenceDetails, ScoreDetails } from "./headerPopovers";
import { atScandalRisk, scandalLimit } from "../lib/board";
import { roleIcon, statIcon } from "../assets/cards";
import { ResourceText } from "../primitives/ResourceIcon";
import { setTheme, useTheme } from "../lib/theme";
import { themes, type ThemeId } from "../themes";

/** Значок ресурса в шапке — та же графика, что на карточках игроков. */
const Icon = ({ src }: { src: string | undefined }) =>
  src ? <img src={src} alt="" className="size-4 shrink-0" /> : null;

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
 * Ресурсы кликабельны — каждый открывает поповер с разбором числа, а не прячут его в title.
 */
export function Header({
  game,
  me,
  meta,
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
  const { t } = useTranslation("game");
  const caption = (text: string) => (compact ? "" : ` ${text}`);

  if (compact) {
    return (
      <header className="grid gap-1 rounded-panel border border-line bg-topbar px-1.5 py-1">
        <div className="flex items-center gap-1.5">
          <b className="text-[12px] font-extrabold">{t("ui.header.title")}</b>
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
      bg-topbar px-3 py-1.5">
      <div className="flex items-baseline gap-2.5">
        <b className="card-serif text-[19px]">{t("ui.header.title")}</b>
        <span className="text-[11px] text-ink-muted">
          {t("ui.header.round", { round: game.round_number, max: game.max_rounds })}
        </span>
      </div>

      <div
        data-ui="player-hud"
        /* Пергамент с золотой каймой — «табличка» игрока, как карточки на столе. Токены
         * `.game-card` переводят текст и цвета смысла на тёмные, под бумагу. */
        className="game-card hud-plate flex min-w-0 max-w-[780px] items-stretch justify-self-center overflow-hidden
          rounded-lg"
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
          <Res label={t("ui.header.points")} className="text-points"><Icon src={statIcon("score")} />{score}</Res>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <Res label={t("ui.header.money")} className="text-money"><ResourceText>{`${me.money}$`}</ResourceText></Res>
        </CardPopover>
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <Res label={t("ui.header.influence")} className="text-influence"><Icon src={statIcon("influence")} />{me.influence}</Res>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<DefenceDetails game={game} me={me} />}>
          <Res label={t("ui.header.roofs")} className="text-defence">
            <Icon src={statIcon("roof")} />{me.roofs}
            <span className="text-2xs font-normal text-ink-dim">/{me.roof_limit}</span>
          </Res>
        </CardPopover>
        <CardPopover side="bottom" align="center" content={<DefenceDetails game={game} me={me} />}>
          <Res label={t("ui.header.scandals")} className={risky ? "text-warning" : "text-ink-muted"}>
            <span className={risky ? "text-[var(--color-warning)]" : undefined}>
              <Icon src={statIcon("scandal")} />{me.scandals}
              <span className="text-2xs font-normal text-ink-dim">/{scandalLimit(me)}</span>
            </span>
          </Res>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ActionsDetails game={game} />}>
          <Res label={t("ui.header.actions")}>
            {!compact && t("ui.header.actions")}
            <ActionCharges left={game.actions_left} />
            {compact && <span className="text-ink-muted">{game.actions_left}</span>}
          </Res>
        </CardPopover>
      </>
    );
  }

  function dashboard() {
    return (
      <>
        <div className="flex min-w-[112px] items-center gap-2 px-2.5 py-1">
          <span className="player-card-avatar grid size-7 shrink-0 place-items-center rounded-full
            [--player-color:#c9a55a] [border-width:2px]">
            <img src={roleIcon(me.role ?? undefined)} alt="" className="size-[18px]" />
          </span>
          <span className="grid min-w-0 gap-px">
            <span className="text-[8px] font-semibold uppercase tracking-[0.1em] text-ink-dim">{t("ui.header.yourRole")}</span>
            <b className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-ink">
              {role?.title ?? t("ui.header.noRole")}
            </b>
          </span>
        </div>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label={t("ui.header.score")} className="text-points"><Icon src={statIcon("score")} />{score}</HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label={t("ui.header.resources")}>
            <span className="flex items-center gap-0.5 text-money"><ResourceText>{`${me.money}$`}</ResourceText></span>
            <span className="flex items-center gap-0.5 text-influence"><Icon src={statIcon("influence")} />{me.influence}</span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label={t("ui.header.income")}>
            <span className="text-money"><ResourceText>{`+${income?.money.total ?? 0}$`}</ResourceText></span>
            <span className="text-influence"><ResourceText>{`+${income?.influence.total ?? 0}◆`}</ResourceText></span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<ScoreDetails game={game} me={me} meta={meta} />}>
          <HudStat label={t("ui.header.city")}>
            <span className="text-good">▦ {me.assets.length}/{me.capacity}</span>
            <span className="text-points">🏛 {me.projects.length}</span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="center" content={<DefenceDetails game={game} me={me} />}>
          <HudStat label={t("ui.header.defence")}>
            <span className="flex items-center gap-0.5 text-defence">
              <Icon src={statIcon("roof")} />{me.roofs}/{me.roof_limit}
            </span>
            <span className={`flex items-center gap-0.5 ${risky ? "text-bad" : "text-ink-muted"}`}>
              <Icon src={statIcon("scandal")} />{me.scandals}/{scandalLimit(me)}
            </span>
          </HudStat>
        </CardPopover>
        <Sep />
        <CardPopover side="bottom" align="end" content={<ActionsDetails game={game} />}>
          <HudStat label={t("ui.header.actions")}>
            <span className="flex items-center gap-[3px]">
              <ActionCharges left={game.actions_left} />
            </span>
            <span className="text-ink-muted">{game.actions_left}</span>
          </HudStat>
        </CardPopover>
      </>
    );
  }

  function buttons() {
    const shape = `rounded-md border border-line bg-panel-2 text-[11.5px] whitespace-nowrap
      hover:bg-panel-3 ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`;
    return (
      <>
        {/* Часто нужные правила и сводка остаются на виду; настройки и хроника собраны
          * в меню, чтобы шапка не распирала игровое поле. */}
        <button type="button" onClick={onScore} aria-label={t("ui.header.scoreButton")} className={shape}>
          🏆{caption(t("ui.header.scoreButton"))}
        </button>
        <button type="button" onClick={onRules} aria-label={t("ui.header.rules")} className={shape}>
          📖{caption(t("ui.header.rules"))}
        </button>
        <button type="button" onClick={onExit} aria-label={t("ui.header.backToRooms")} title={t("ui.header.backToRooms")} className={shape}>
          <span aria-hidden="true">🚪</span>
        </button>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" aria-label={t("ui.header.menu")} title={t("ui.header.menu")} className={`relative ${shape}`}>
              ☰{caption(t("ui.header.menu"))}
              {unseenEvents > 0 && (
                <b className="absolute -right-1.5 -top-1.5 min-w-4 rounded-[9px] bg-bad px-1 text-center
                  text-3xs font-bold text-[#2a0a0a]">
                  {Math.min(unseenEvents, 99)}
                </b>
              )}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={10}
              className="z-50 grid w-[220px] gap-2 rounded-lg border border-line-2 bg-panel p-2 text-ink shadow-xl"
            >
              <ThemePicker className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs" compact={false} />
              <LanguagePicker className="w-full justify-between rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs" />
              <Popover.Close asChild>
                <button type="button" onClick={onChronicle} aria-label={t("ui.header.chronicle")}
                  className="flex items-center justify-between rounded-md border border-line bg-panel-2 px-2 py-1.5 text-left text-xs hover:bg-panel-3">
                  <span>📜 {t("ui.header.chronicle")}</span>
                  {unseenEvents > 0 && <b className="rounded-full bg-bad px-1.5 text-3xs text-[#2a0a0a]">{Math.min(unseenEvents, 99)}</b>}
                </button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </>
    );
  }
}

function ActionCharges({ left }: { left: number }) {
  return (
    <span className="ml-0.5 flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: Math.max(3, left) }).map((_, index) => (
        <img
          key={index}
          src={statIcon("actions")}
          alt=""
          className={`size-3 object-contain ${index < left ? "" : "opacity-30 grayscale"}`}
        />
      ))}
    </span>
  );
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
  const { t } = useTranslation("game");
  const base = "flex h-[26px] items-center gap-2 rounded-md border px-2.5 text-[11.5px]";

  if (error) {
    return (
      <div className={`${base} border-[#7d3c45] bg-[#2a1519] text-[#ffb3b3]`}>
        <Icon src={statIcon("scandal")} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{error}</span>
      </div>
    );
  }
  if (busy) {
    return (
      <div className={`${base} border-[#34507a] bg-[#1a2740] text-[#bcd6f5]`}>
        <span className="size-2.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        <span>{t("ui.header.busy")}</span>
      </div>
    );
  }
  if (game.status === "finished") {
    return (
      <div className={`${base} border-[#6b5518] bg-[#2a2411] text-gold`}>{t("ui.header.finished")}</div>
    );
  }
  if (me.jail_turns > 0) {
    return (
      <div className={`${base} border-[#7d3c45] bg-[#2a1519] text-[#ffb3b3]`}>
        {t("ui.header.jailed")}
      </div>
    );
  }
  return null;
}

/* Тема — личная настройка, её меняют в любой момент партии. Обычный select: он доступен с
 * клавиатуры и на телефоне открывает родной список, а тем всего пять. */
function ThemePicker({ className, compact }: { className: string; compact: boolean }) {
  const { t } = useTranslation("game");
  const theme = useTheme();
  return (
    <label className={`flex cursor-pointer items-center gap-1 ${className}`} title={t("ui.header.theme")}>
      🎨
      <select
        aria-label={t("ui.header.theme")}
        value={theme}
        onChange={event => setTheme(event.target.value as ThemeId)}
        className={`cursor-pointer bg-transparent text-ink outline-none ${compact ? "w-4" : ""}`}
      >
        {themes.map(item => (
          <option key={item.id} value={item.id} className="bg-panel-2 text-ink">
            {t(`ui.themes.${item.id}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
