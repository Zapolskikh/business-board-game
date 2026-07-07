// In-game reference ("FAQ") shown as a modal with three tabs: roles, objects
// (the full cell catalogue) and the "?" card deck. Everything is read straight
// from the backend meta so the reference can never drift from the actual rules.
import { useState } from "react";
import type { Meta } from "../types";

interface Props {
  meta: Meta;
  onClose: () => void;
}

type Tab = "roles" | "objects" | "cards";

export function Faq({ meta, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("roles");
  const totalWeight = meta.question_cards.reduce((s, c) => s + Math.max(1, c.weight || 1), 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal faq" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Справочник">
        <div className="faq-head">
          <h2>Справочник</h2>
          <button className="btn small ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        <div className="faq-tabs">
          <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")}>
            Роли
          </button>
          <button className={tab === "objects" ? "active" : ""} onClick={() => setTab("objects")}>
            Объекты
          </button>
          <button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>
            Карты «?»
          </button>
        </div>

        <div className="faq-body">
          {tab === "roles" && (
            <ul className="faq-roles">
              {meta.roles.map((r) => (
                <li key={r.id} className="faq-role">
                  <div className="faq-obj-head">
                    <span className="re-dot" style={{ background: r.color }} />
                    <strong>{r.title}</strong>
                    <code className="ci-id">{r.id}</code>
                  </div>
                  {r.themes?.length ? (
                    <p className="dim">
                      <em>Темы:</em> {r.themes.join(", ")}
                    </p>
                  ) : null}
                  {r.weaknesses?.length ? (
                    <p className="dim">
                      <em>Слабости:</em> {r.weaknesses.join(", ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {tab === "objects" && (
            <div className="faq-objects">
              {Object.entries(meta.cells).map(([type, cm]) => {
                const eff = meta.cell_effects[type];
                const roleLines = meta.roles.filter((r) => eff?.roles?.[r.id]);
                return (
                  <div key={type} className="faq-object">
                    <div className="faq-obj-head">
                      <span className="ci-swatch" style={{ background: cm.color }} />
                      <strong>{cm.title}</strong>
                      <code className="ci-id">{type}</code>
                      {cm.buyable && <span className="badge">покупаемая</span>}
                    </div>
                    {cm.ring_titles?.length ? (
                      <p className="dim">По кругам: {cm.ring_titles.join(" → ")}</p>
                    ) : null}
                    {eff?.base && <p className="faq-obj-base">{eff.base}</p>}
                    {roleLines.length > 0 && (
                      <ul className="faq-obj-roles">
                        {roleLines.map((r) => (
                          <li key={r.id}>
                            <span className="re-dot" style={{ background: r.color }} />
                            <b>{r.title}:</b> {eff.roles[r.id]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "cards" && (
            <table className="eco-table faq-cards">
              <thead>
                <tr>
                  <th>Карта</th>
                  <th>Эффект</th>
                  <th>Шанс</th>
                </tr>
              </thead>
              <tbody>
                {meta.question_cards.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.title}</strong>
                    </td>
                    <td>{c.text}</td>
                    <td className="cur">{Math.round((Math.max(1, c.weight || 1) / totalWeight) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
