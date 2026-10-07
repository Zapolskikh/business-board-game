import { useTranslation } from "react-i18next";
import { useEffect, useRef, type ReactNode } from "react";
import { SupportLinks } from "./SupportLinks";
import { StudioLogo } from "./StudioMark";

/** Версия сборки — для отзыва о баге. Пометка `-dirty` нужна разработчику, а не игроку. */
export const shownVersion = __GAME_VERSION__.replace(/-dirty$/, "");

/* Окно страниц вокруг игры: «О проекте» и «Поддержать». Нативный `<dialog>`: фокус внутри, Escape
 * закрывает, фокус возвращается к кнопке, которая окно открыла. На телефоне — панель во всю
 * ширину, текст прокручивается (styles.css, `.about-dialog`). */
function InfoDialog({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation("home");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="about-dialog" aria-labelledby={titleId} onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
      <div className="about-body">
        <button type="button" className="about-close" onClick={() => ref.current?.close()} aria-label={t("about.close")}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <StudioLogo className="about-logo" />
        {children}
      </div>
    </dialog>
  );
}

/* «О проекте»: кто делает игру и почему она бесплатная. Текст нарочно простой — это письмо от
 * автора, а не пресс-релиз. */
export function AboutDialog({ onClose, onFeedback }: { onClose: () => void; onFeedback: () => void }) {
  const { t } = useTranslation("home");
  return (
    <InfoDialog titleId="about-title" onClose={onClose}>
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
        <p>{t("about.p4")}</p>
        <p className="about-sign">{t("about.thanks")}</p>
      </div>
      <div className="about-actions">
        <SupportLinks />
        <button type="button" className="rooms-button" onClick={onFeedback}>{t("about.write")}</button>
      </div>
      <p className="about-version">{t("about.version", { version: shownVersion })}</p>
    </InfoDialog>
  );
}

/* «Поддержать»: то же окно, что «О проекте», — зачем поддерживать и куда. */
export function SupportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("home");
  return (
    <InfoDialog titleId="support-title" onClose={onClose}>
      <div>
        <h2 id="support-title">{t("supportDialog.title")}</h2>
        <p className="about-lead">{t("supportDialog.lead")}</p>
      </div>
      <div className="about-text">
        <p>{t("supportDialog.p1")}</p>
        <p>{t("supportDialog.p2")}</p>
        <p className="about-sign">{t("about.thanks")}</p>
      </div>
      <div className="about-actions">
        <SupportLinks />
      </div>
    </InfoDialog>
  );
}
