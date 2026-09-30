import { useTranslation } from "react-i18next";
import { supportLinks } from "./support";

/* Узнаваемые знаки площадок, нарисованные просто: цвет бренда и форма, без мелких деталей,
 * которые на 20px всё равно не видны. */
function BrandMark({ id }: { id: "boosty" | "patreon" }) {
  if (id === "boosty") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="#F15F2C" />
        <path
          d="M9.4 4.5h3.3l-1.6 5.3c.5-.2 1-.3 1.6-.3 2.6 0 4.3 1.9 4.3 4.4 0 3-2.4 5.6-5.8 5.6-2.9 0-4.7-1.9-4.7-4.4 0-.5.1-1 .2-1.5L9.4 4.5Zm2.4 8.1c-1.2 0-2.2 1-2.2 2.2 0 1 .7 1.7 1.7 1.7 1.2 0 2.2-1 2.2-2.2 0-1-.7-1.7-1.7-1.7Z"
          fill="#fff"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#FF424D" />
      <circle cx="14.2" cy="10" r="5" fill="#fff" />
      <rect x="5" y="5" width="3" height="14" rx="0.6" fill="#141518" />
    </svg>
  );
}

/** Иконки Boosty и Patreon. Пока адреса нет, иконка видна, но неактивна и подписана «скоро». */
export function SupportLinks({ labels = false }: { labels?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="support-links">
      {supportLinks.map(link =>
        link.url ? (
          <a
            key={link.id}
            className="support-link"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t("support.donate", { site: link.title })}
          >
            <BrandMark id={link.id} />
            {labels && <span>{link.title}</span>}
          </a>
        ) : (
          <span
            key={link.id}
            className="support-link is-soon"
            title={t("support.soonTitle", { site: link.title })}
            aria-label={t("support.soonTitle", { site: link.title })}
          >
            <BrandMark id={link.id} />
            {labels && (
              <span>
                {link.title} <small>{t("support.soon")}</small>
              </span>
            )}
          </span>
        ),
      )}
    </span>
  );
}
