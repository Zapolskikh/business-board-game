import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Difficulty } from "../types";

/* Профили ботов, которые предлагает лобби.
 *
 * Движок принимает и старые id, но они играют по ушедшей экономике, поэтому их нет в выборе. Reborn
 * ушёл туда же: он написан под давно сменившиеся правила. Сидящий на месте старый бот доигрывает —
 * сервер его id знает. Названия — из локали (`common:difficulty.*`), без приписки «Claude»: игроки
 * принимали такое место за живого ИИ-агента, а не за скриптового бота.
 */
type OfferedBot = Extract<Difficulty, "ledger" | "oracle" | "boris" | "raider" | "builder">;

export const BOT_LEVELS: { id: OfferedBot; level: "normal" | "hard" }[] = [
  { id: "ledger", level: "normal" },
  { id: "oracle", level: "hard" },
];
export const BOT_STRATEGIES: OfferedBot[] = ["boris", "raider", "builder"];

/** Подпись профиля: «Средний · Ledger» для уровней, просто «Рейдер» для стратегий. */
export function useBotLabel(): (difficulty: Difficulty) => string {
  const { t } = useTranslation(["home", "common"]);
  return difficulty => {
    const name = t(`common:difficulty.${difficulty}`, { defaultValue: difficulty });
    const level = BOT_LEVELS.find(item => item.id === difficulty)?.level;
    return level ? `${t(`home:bots.level.${level}`)} · ${name}` : name;
  };
}

/* Выбор бота для места. Нажатие на профиль — это и есть «посадить»: окно закрывается, запрос уходит
 * сразу, второй кнопки подтверждения нет. На телефоне окно встаёт нижней панелью (CSS).
 *
 * Нативный `<dialog>` с `showModal()`: фокус заперт внутри, Escape закрывает, после закрытия фокус
 * возвращается к кнопке, которая окно открыла, — и без библиотеки окон в бандле главной. */
export function BotPicker({ seatNumber, current, onPick, onClose }: {
  seatNumber: number;
  current?: Difficulty;
  onPick: (difficulty: Difficulty) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    // Без close() в очистке: в StrictMode эффект проигрывается дважды, и событие close от первой
    // очистки закрыло бы окно сразу после открытия. Окно, убранное из DOM, закрывается само.
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const option = (id: OfferedBot, title: string) => (
    <li key={id}>
      <button type="button" className="lb-bot-choice" aria-current={id === current || undefined} onClick={() => onPick(id)}>
        <span className="lb-bot-choice-title">
          {title}
          {id === current && <small>{t("home:bots.current")}</small>}
        </span>
        <span className="lb-bot-choice-about">{t(`home:bots.about.${id}`)}</span>
      </button>
    </li>
  );

  return (
    <dialog
      ref={ref}
      className="lb-sheet"
      aria-labelledby="lb-bot-title"
      onClose={onClose}
      // Нажатие по затемнению вокруг окна — тоже «закрыть»: само окно занимает только свою рамку.
      onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}
    >
      <div className="lb-sheet-body">
        <header className="lb-sheet-head">
          <h2 id="lb-bot-title">{t("home:bots.title", { n: seatNumber })}</h2>
          <button type="button" className="lb-icon-button" aria-label={t("home:bots.close")} onClick={() => ref.current?.close()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <h3 className="lb-sheet-group">{t("home:bots.levels")}</h3>
        <ul className="lb-bot-list">
          {BOT_LEVELS.map(item => option(item.id, `${t(`home:bots.level.${item.level}`)} · ${t(`common:difficulty.${item.id}`)}`))}
        </ul>
        <h3 className="lb-sheet-group">{t("home:bots.strategies")}</h3>
        <ul className="lb-bot-list">
          {BOT_STRATEGIES.map(id => option(id, t(`common:difficulty.${id}`)))}
        </ul>
      </div>
    </dialog>
  );
}
