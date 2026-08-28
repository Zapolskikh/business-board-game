import { forwardRef, type CSSProperties, type ReactNode } from "react";
import type { Availability } from "../lib/actions";

/* Общие атомы доски. Держим их в одном файле, чтобы плотная сетка была
 * единообразной: одинаковые отступы, одинаковые размеры подписей.
 */

/* Функциональные зоны доски. Каждая получает свой оттенок подложки и свой цвет линии под
 * заголовком — см. --color-zone-* в theme.css.
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

/** Линия под заголовком зоны. Три пикселя: тоньше не читается на плотной доске.
 *
 * Отступ под заголовком урезан с 5px до 2px ровно на её толщину, поэтому линия ничего не стоит
 * по высоте. Доска плотная: панели рынка и города отдают всю свободную высоту карточкам, и
 * четыре добавленных пикселя переполняли таблицу свойств внутри них. */
export const zoneRule = "border-b-[3px] border-b-[var(--zone-accent,transparent)]";

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
      className={`rounded-panel border border-line bg-[var(--zone-bg,var(--color-panel))] px-2 py-[7px] ${
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
      <h2 className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">{title}</h2>
      {extra}
      {meta && <span className="ml-auto whitespace-nowrap text-[10.5px] text-ink-dim">{meta}</span>}
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
}: {
  label: string;
  cost: ReactNode;
  state: Availability;
  onClick: () => void;
  tone?: "plain" | "danger";
  /** Уже использовано в этом ходу — отдельный вид, чтобы не путать с нехваткой ресурсов. */
  spent?: boolean;
}) {
  const ready = state.kind === "ready";
  const status = spent ? "spent" : state.kind;
  return (
    <button
      type="button"
      data-state={status}
      disabled={!ready}
      onClick={onClick}
      title={state.kind === "blocked" ? state.reason : undefined}
      className={`grid min-w-0 gap-px rounded-md border border-line bg-panel-2 px-[7px] py-[5px]
        enabled:hover:border-accent
        data-[state=blocked]:opacity-45
        data-[state=pending]:animate-pulse
        data-[state=spent]:border-[#4d3535] data-[state=spent]:bg-[#1c1616] data-[state=spent]:opacity-70
        ${tone === "danger" ? "border-[#5c3340]" : ""}`}
    >
      <b className={`overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] font-semibold ${
        tone === "danger" ? "text-[#ff9aa8]" : "text-ink"
      }`}>
        {label}
      </b>
      <small className={`overflow-hidden text-ellipsis whitespace-nowrap text-3xs ${
        spent ? "text-[#c78e8e]" : "text-ink-muted"
      }`}>
        {/* Всегда цена действия, а не причина отказа. Правила учат по тому, что делает
          * кнопка, а не по «Сейчас недоступно»: половина панели недоступна почти всегда,
          * и справка пропадала именно тогда, когда она нужна. Недоступность видна по
          * затемнению, нехватка ресурса — по красному числу в самой цене, точная причина —
          * в подсказке при наведении. */}
        {spent ? "уже в этом ходу" : cost}
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
    icon: string;
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
      onClick={onClick}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[7px]
        rounded-md border border-line bg-panel-2 px-2 py-[7px] hover:border-accent"
      {...rest}
    >
      <span>{icon}</span>
      <span className="min-w-0">
        <b className="block text-xs font-semibold text-ink">{title}</b>
        <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-3xs text-ink-muted">
          {hint}
        </small>
      </span>
      {badge !== undefined ? (
        <span
          className={`rounded-lg px-1.5 text-3xs ${
            badgeOn ? "bg-[#1d3b2a] text-[#7fdaa6]" : "bg-panel-3 text-ink-muted"
          }`}
        >
          {badge}
        </span>
      ) : (
        <span className="text-ink-dim">›</span>
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

export function EffectList({ lines }: { lines: { text: string; active: boolean; boosted?: boolean }[] }) {
  if (lines.length === 0) return null;
  return (
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
          {line.text}
          {line.boosted && <span className="ml-1 text-gold">⚙×2</span>}
        </li>
      ))}
    </ul>
  );
}
