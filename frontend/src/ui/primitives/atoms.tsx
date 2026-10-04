import { tr } from "../../i18n";
import { forwardRef, type CSSProperties, type ReactNode } from "react";
import type { Availability } from "../lib/actions";
import { ResourceText } from "./ResourceIcon";

/* Общие атомы доски. Держим их в одном файле, чтобы плотная сетка была
 * единообразной: одинаковые отступы, одинаковые размеры подписей.
 */

/* Функциональные зоны доски. Подложка у них общая и почти чёрная, отличается только
 * пастельный акцент заголовка — см. --color-zone-* в theme.css.
 *
 * Через CSS-переменные, а не через готовые классы на каждую зону: линию рисует SectionHead,
 * который живёт внутри панели и о зоне ничего не знает. Переменная каскадом доходит до него
 * сама, поэтому зона задаётся в одном месте — на панели.
 */
export type Zone = "players" | "projects" | "market" | "city" | "actions" | "chronicle";

export function zoneStyle(zone?: Zone): CSSProperties | undefined {
  if (!zone) return undefined;
  return {
    "--zone-bg": `var(--color-zone-${zone})`,
    "--zone-accent": `var(--color-zone-${zone}-accent)`,
  } as CSSProperties;
}

/* Заголовок и содержимое зоны разделяет отступ, а не линия: в формате тем у областей нет
 * рамок, и одинокая черта под заголовком читалась как обрывок границы. */
export const zoneRule = "mb-0.5";

/** Заголовок зоны: антиква капителью, как в макете доски. */
export const sectionTitle = `section-title whitespace-nowrap text-[13px] uppercase tracking-[0.04em]
  text-[var(--zone-accent,var(--color-ink-muted))]`;

export function Panel({
  children,
  className = "",
  rows,
  zone,
}: {
  children: ReactNode;
  className?: string;
  rows?: boolean;
  zone?: Zone;
}) {
  return (
    <section
      style={zoneStyle(zone)}
      /* min-w-0 обязателен: панель — элемент сетки, а у элемента сетки минимальная ширина по
       * умолчанию равна min-content. Стоит одной подписи внутри отказаться сжиматься, и панель
       * распирает свою колонку и наезжает на соседнюю — ровно это и происходило на телефоне,
       * когда Safari раздувал шрифты. Теперь распирать нечего: лишнее обрежется многоточием. */
      className={`min-w-0 rounded-panel bg-[var(--zone-bg,var(--color-panel))] px-2 py-[7px] ${
        rows ? "grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHead({ title, meta, extra }: { title: string; meta?: ReactNode; extra?: ReactNode }) {
  return (
    <div className={`flex items-baseline gap-2 px-0.5 pb-[2px] ${zoneRule}`}>
      <h2 className={sectionTitle}>{title}</h2>
      {extra}
      {/* Подпись обрезается, а не распирает панель. `whitespace-nowrap` без `overflow-hidden`
        * растил её на всю длину текста, панель уезжала за свою колонку, и вся центральная
        * часть начинала ездить по горизонтали — на телефоне это было видно сразу. */}
      {meta && (
        <span className="ml-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-dim">
          {meta}
        </span>
      )}
    </div>
  );
}

/** Кнопка действия: подпись + цена, состояние из Availability. */
export function ActionButton({
  label,
  cost,
  state,
  onClick,
  tone = "plain",
  spent,
  tutorial,
}: {
  label: string;
  cost: ReactNode;
  state: Availability;
  onClick: () => void;
  tone?: "plain" | "danger";
  /** Уже использовано в этом ходу — отдельный вид, чтобы не путать с нехваткой ресурсов. */
  spent?: boolean;
  /** Метка, по которой обучение подсвечивает кнопку. */
  tutorial?: string;
}) {
  const ready = state.kind === "ready";
  const status = spent ? "spent" : state.kind;
  return (
    <button
      type="button"
      data-ui="action-button"
      data-state={status}
      data-tutorial={tutorial}
      disabled={!ready}
      onClick={onClick}
      title={state.kind === "blocked" ? state.reason : undefined}
      className={`grid min-w-0 gap-0.5 rounded-md border border-line bg-panel-2 px-2 py-1.5
        data-[state=ready]:border-line-2 enabled:hover:border-accent enabled:hover:bg-panel-3
        data-[state=blocked]:opacity-35
        data-[state=pending]:animate-pulse
        data-[state=spent]:border-bad/40 data-[state=spent]:opacity-65
        ${tone === "danger" ? "border-bad/50" : ""}`}
    >
      <b className={`overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold ${
        tone === "danger" ? "text-bad" : "text-ink"
      }`}>
        {label}
      </b>
      <small className={`overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] ${
        spent ? "text-bad" : "text-ink-muted"
      }`}>
        {/* Всегда цена действия, а не причина отказа. Правила учат по тому, что делает
          * кнопка, а не по «Сейчас недоступно»: половина панели недоступна почти всегда,
          * и справка пропадала именно тогда, когда она нужна. Недоступность видна по
          * затемнению, нехватка ресурса — по красному числу в самой цене, точная причина —
          * в подсказке при наведении. */}
        {spent ? tr("game", "ui.common.spent") : cost}
      </small>
    </button>
  );
}

/* Строка-ящик в правой панели: открывает большое окно со справочником.
 *
 * forwardRef обязателен: без него Radix с asChild не может прицепиться к кнопке, и она
 * молча перестаёт работать — именно поэтому не открывались «Роли» и «Серые операции».
 */
export const DrawerRow = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode;
    title: string;
    hint: ReactNode;
    badge?: ReactNode;
    badgeOn?: boolean;
    onClick?: () => void;
  }
>(function DrawerRow({ icon, title, hint, badge, badgeOn, onClick, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-ui="drawer-row"
      onClick={onClick}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5
        rounded-md border border-line bg-panel-2 px-2.5 py-2 hover:border-line-2 hover:bg-panel-3"
      {...rest}
    >
      <span className="text-[20px] leading-none">{icon}</span>
      <span className="min-w-0">
        <b className="block text-[14px] font-semibold text-ink">{title}</b>
        <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-ink-muted">
          {typeof hint === "string" ? <ResourceText>{hint}</ResourceText> : hint}
        </small>
      </span>
      {badge !== undefined ? (
        <span
          className={`rounded-lg px-2 py-0.5 text-[11px] ${
            badgeOn ? "bg-panel text-good" : "bg-panel-3 text-ink-muted"
          }`}
        >
          {typeof badge === "string" ? <ResourceText>{badge}</ResourceText> : badge}
        </span>
      ) : (
        <span className="text-[18px] text-ink-dim">›</span>
      )}
    </button>
  );
});

/** Пункт списка внутри поповера — цель атаки, роль, серая операция. */
export function ListItem({
  icon,
  title,
  hint,
  right,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2
        rounded-md border border-line bg-panel-2 px-2 py-1.5
        enabled:hover:border-accent disabled:opacity-45"
    >
      <span>{icon}</span>
      <span className="min-w-0 text-left">
        <b className="block text-xs text-ink">{title}</b>
        {hint && <small className="block text-3xs text-ink-muted">{hint}</small>}
      </span>
      {right && <span className="whitespace-nowrap text-[11.5px] font-bold text-gold">{right}</span>}
    </button>
  );
}

export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5">
      {rows.map(([key, value], index) => (
        <div key={index} className="contents">
          <dt className="text-ink-dim">{key}</dt>
          <dd className="font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EffectList({
  lines,
  title,
}: {
  lines: { text: string; active: boolean; boosted?: boolean }[];
  title?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <>
      {title && <p className="mb-1 font-semibold text-ink">{title}</p>}
      <ul className="mb-2 grid gap-0.5">
        {lines.map((line, index) => (
          <li
            key={index}
            className={
              line.active
                ? "relative pl-3.5 text-good before:absolute before:left-0 before:content-['✓']"
                : "relative pl-3.5 text-ink-dim before:absolute before:left-1 before:content-['·']"
            }
          >
            <ResourceText>{line.text}</ResourceText>
            {line.boosted && <span className="ml-1 text-gold">⚙×2</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
