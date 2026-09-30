import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { SupportLinks } from "./SupportLinks";
import { StudioLogo } from "./StudioMark";

/* «О проекте»: кто делает игру, почему она бесплатная и куда идут пожертвования.
 * Текст нарочно простой — это письмо от автора, а не пресс-релиз. */
export function AboutDialog({ onClose, onFeedback }: { onClose: () => void; onFeedback: () => void }) {
  const { t } = useTranslation("home");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="rooms-dialog-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section className="rooms-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <button type="button" className="about-close" onClick={onClose} aria-label={t("about.close")}>
          ✕
        </button>
        <StudioLogo className="about-logo" />
        <div>
          <span className="eyebrow">{t("about.eyebrow")}</span>
          <h2 id="about-title">{t("about.title")}</h2>
        </div>

        <div className="about-text">
          <p>{t("about.p1")}</p>
          <p>
            <b>{t("about.p2Strong")}</b>
            {t("about.p2")}
          </p>
          <p>
            {t("about.p3Start")}
            <b>{t("about.p3Strong")}</b>
            {t("about.p3End")}
          </p>
          <p>{t("about.p4")}</p>
          <p className="about-sign">{t("about.thanks")}</p>
        </div>

        <div className="about-actions">
          <SupportLinks labels />
          <button type="button" className="rooms-button" onClick={onFeedback}>
            {t("about.write")}
          </button>
        </div>
      </section>
    </div>
  );
}
