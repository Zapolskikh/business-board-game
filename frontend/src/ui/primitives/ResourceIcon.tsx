import type { ReactNode } from "react";
import { statIcon, type ResourceIcon as ResourceIconName } from "../assets/cards";

const SYMBOLS: Record<string, ResourceIconName> = {
  "$": "money",
  "◆": "influence",
  "⚡": "actions",
  "⚠": "scandal",
  "🛡": "roof",
  "★": "score",
  "💵": "money",
  "💰": "money",
};

/** Universal resource artwork used inline in UI labels and amounts. */
export function ResourceIcon({ name, size = "1.15em" }: { name: ResourceIconName; size?: string }) {
  const src = statIcon(name);
  return src ? (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className="inline-block shrink-0 object-contain align-[-0.16em]"
      style={{ width: size, height: size }}
    />
  ) : null;
}

/** Replace legacy resource glyphs in a text value with the matching individual images. */
export function ResourceText({ children, className }: { children: string; className?: string }) {
  const parts: ReactNode[] = [];
  let text = "";
  let key = 0;
  for (const character of children) {
    const resource = SYMBOLS[character];
    if (!resource) {
      text += character;
      continue;
    }
    if (text) parts.push(text);
    text = "";
    parts.push(<ResourceIcon key={key++} name={resource} />);
  }
  if (text) parts.push(text);
  return <span className={className}>{parts}</span>;
}

/** Apply inline icon references to rulebook HTML that is rendered with dangerouslySetInnerHTML. */
export function resourceIconsInHtml(html: string): string {
  return html.replace(/\$|◆|⚡|⚠|🛡|★|💵|💰/g, glyph => {
    const name = SYMBOLS[glyph];
    const src = name ? statIcon(name) : undefined;
    return src
      ? `<img class="rules-resource-icon" src="${src}" alt="" aria-hidden="true">`
      : glyph;
  });
}
