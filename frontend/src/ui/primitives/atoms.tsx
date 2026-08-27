import type { ReactNode } from "react";
import type { Availability } from "../lib/actions";

/* Общие атомы доски. Держим их в одном файле, чтобы плотная сетка была
 * единообразной: одинаковые отступы, одинаковые размеры подписей.
 */

export function Panel({ children, className = "", rows }: { children: ReactNode; className?: string; rows?: boolean }) {
  return (
    <section
      className={`rounded-panel border border-line bg-panel px-2 py-[7px] ${
        rows ? "grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHead({ title, meta, extra }: { title: string; meta?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 px-0.5 pb-[5px]">
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
      <small className={`text-3xs ${spent ? "text-[#c78e8e]" : "text-ink-muted"}`}>
        {spent ? "уже в этом ходу" : state.kind === "blocked" ? state.reason : cost}
      </small>
    </button>
  );
}

/** Строка-ящик в правой панели: открывает поповер со списком. */
export function DrawerRow({
  icon,
  title,
  hint,
  badge,
  badgeOn,
}: {
  icon: string;
  title: string;
  hint: string;
  badge?: ReactNode;
  badgeOn?: boolean;
}) {
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[7px]
        rounded-md border border-line bg-panel-2 px-2 py-[7px] hover:border-accent"
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
}

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
