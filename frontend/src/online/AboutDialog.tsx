import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { SupportLinks } from "./SupportLinks";
import { StudioLogo } from "./StudioMark";
import { supportLinks } from "./support";

/** Версия сборки — для отзыва о баге. Пометка `-dirty` нужна разработчику, а не игроку. */
export const shownVersion = __GAME_VERSION__.replace(/-dirty$/, "");

/* «О проекте»: кто делает игру и почему она бесплатная. Текст нарочно простой — это письмо от
 * автора, а не пресс-релиз. Абзац про поддержку — только когда есть куда поддерживать: пока у
 * Boosty и Patreon нет адресов, призыв помочь деньгами был бы обещанием без кнопки.
 *
 * Нативный `<dialog>`: фокус внутри, Escape закрывает, фокус возвращается к «О проекте». На
 * телефоне окно — во всю ширину и прокручивается само (styles.css, `.about-dialog`). */
export function AboutDialog({ onClose, onFeedback }: { onClose: () => void; onFeedback: () => void }) {
  const { t } = useTranslation("home");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const canSupport = supportLinks.some(link => link.url);

  return (
    <dialog ref={ref} className="about-dialog" aria-labelledby="about-title" onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
      <div className="about-body">
        <button type="button" className="about-close" onClick={() => ref.current?.close()} aria-label={t("about.close")}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <StudioLogo className="about-logo" />
        <div>
          <h2 id="about-title">{t("about.title")}</h2>
          <p className="about-lead">{t("about.lead")}</p>
        </div>

        <div className="about-text">
          <p>{t("about.p1")}</p>
          <p>
            <b>{t("about.p2Strong")}</b>
            {t("about.p2")}
          </p>
          {canSupport && (
            <p>
              {t("about.p3Start")}
              <b>{t("about.p3Strong")}</b>
              {t("about.p3End")}
            </p>
          )}
          <p>{t("about.p4")}</p>
          <p className="about-sign">{t("about.thanks")}</p>
        </div>

        <div className="about-actions">
          <SupportLinks labels />
          <button type="button" className="rooms-button" onClick={onFeedback}>
            {t("about.write")}
          </button>
        </div>
        <p className="about-version">{t("about.version", { version: shownVersion })}</p>
      </div>
    </dialog>
  );
}
