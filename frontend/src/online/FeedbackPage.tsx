import { useTranslation } from "react-i18next";
import { LanguagePicker } from "../i18n/LanguagePicker";
import { useState } from "react";
import { ApiError, cityApi } from "./api";
import { SupportLinks } from "./SupportLinks";
import { StudioFooter } from "./StudioMark";

type Kind = "bug" | "idea" | "other";

const kinds: { id: Kind; icon: string }[] = [
  { id: "bug", icon: "🐞" },
  { id: "idea", icon: "💡" },
  { id: "other", icon: "💬" },
];

/* Отдельная страница, а не окно: сообщение о баге пишут долго, и случайный клик мимо окна
 * не должен стирать написанное. */
export function FeedbackPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("home");
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  // Скрытое поле-ловушка: человек его не видит, а бот заполняет.
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const canSend = message.trim().length >= 3 && state !== "sending";

  const send = async () => {
    if (!canSend) return;
    setState("sending");
    setError("");
    try {
      await cityApi.feedback({
        kind,
        message: message.trim(),
        contact: contact.trim(),
        version: __GAME_VERSION__,
        user_agent: navigator.userAgent.slice(0, 400),
        website,
      });
      setState("sent");
    } catch (reason) {
      setState("idle");
      setError(
        reason instanceof ApiError && reason.status === 429 ? t("feedback.errorTooMany") : t("feedback.errorFailed"),
      );
    }
  };

  return (
    <main className="rooms-app feedback-page" data-ui="feedback-page">
      <header className="rooms-topbar">
        <button type="button" className="rooms-wordmark feedback-home" onClick={onBack}>
          <span className="rooms-mark">{t("brand.mark")}</span>
          <span>
            <b>{t("brand.title")}</b>
            <small>{t("brand.tagline")}</small>
          </span>
        </button>
        <span className="rooms-topnav">
          <LanguagePicker className="rooms-language" />
          <button type="button" className="rooms-button subtle" onClick={onBack}>
            {t("nav.home")}
          </button>
        </span>
      </header>

      <section className="feedback-layout">
        <div className="feedback-intro">
          <span className="eyebrow">{t("feedback.eyebrow")}</span>
          <h1>{t("feedback.title")}</h1>
          <p>{t("feedback.lead")}</p>
          <p className="feedback-support">{t("feedback.support")}</p>
          <SupportLinks labels />
        </div>

        <section className="rooms-panel feedback-card">
          {state === "sent" ? (
            <div className="feedback-done" role="status">
              <span className="feedback-done-icon">🙌</span>
              <h2>{t("feedback.doneTitle")}</h2>
              <p>{t("feedback.doneText")}</p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="rooms-button subtle"
                  onClick={() => {
                    setMessage("");
                    setState("idle");
                  }}
                >
                  {t("feedback.writeMore")}
                </button>
                <button type="button" className="rooms-button primary" onClick={onBack}>
                  {t("feedback.toHome")}
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={event => {
                event.preventDefault();
                void send();
              }}
            >
              <fieldset className="feedback-kinds">
                <legend>{t("feedback.kindLegend")}</legend>
                {kinds.map(item => (
                  <label key={item.id} className={item.id === kind ? "is-active" : ""}>
                    <input
                      type="radio"
                      name="kind"
                      value={item.id}
                      checked={item.id === kind}
                      onChange={() => setKind(item.id)}
                    />
                    <span className="feedback-kind-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <b>{t(`feedback.kinds.${item.id}.title`)}</b>
                    <small>{t(`feedback.kinds.${item.id}.hint`)}</small>
                  </label>
                ))}
              </fieldset>

              <label className="room-field">
                <span>{t("feedback.message")}</span>
                <textarea
                  value={message}
                  rows={7}
                  maxLength={4000}
                  placeholder={t(`feedback.kinds.${kind}.placeholder`)}
                  onChange={event => setMessage(event.target.value)}
                />
              </label>

              <label className="room-field">
                <span>{t("feedback.contact")}</span>
                <input
                  value={contact}
                  maxLength={200}
                  placeholder={t("feedback.contactPlaceholder")}
                  onChange={event => setContact(event.target.value)}
                />
              </label>

              <label className="feedback-trap" aria-hidden="true">
                {t("feedback.trap")}
                <input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
              </label>

              {error && (
                <p className="rooms-alert" role="alert">
                  ⚠ {error}
                </p>
              )}

              <button className="rooms-button primary create-submit" type="submit" disabled={!canSend}>
                {state === "sending" ? t("feedback.sending") : t("feedback.send")}
              </button>
              <p className="form-hint">{t("feedback.note")}</p>
            </form>
          )}
        </section>
      </section>

      <StudioFooter />
    </main>
  );
}
