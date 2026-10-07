import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../../i18n/errors";
import { ApiError, cityApi } from "../api";
import type { RoomSummary } from "../types";

/* Вход по коду: код — это id комнаты (его показывает лобби и несёт ссылка-приглашение). Комнату
 * сперва ищем по публичной карточке: так «нет такой комнаты» видно до вопросов об имени и пароле. */
export function CodeEntry({ code, onCode, onFound }: {
  code: string;
  onCode: (code: string) => void;
  onFound: (room: RoomSummary) => void;
}) {
  const { t } = useTranslation("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Код из ссылки тоже годится: берём то, что после `room=`, иначе — всё введённое без пробелов.
  const clean = (value: string) => (/[?&]room=([^&#\s]+)/.exec(value)?.[1] ?? value).trim();

  const find = async () => {
    const id = clean(code);
    if (!id) return;
    setBusy(true); setError("");
    try {
      onFound(await cityApi.room(decodeURIComponent(id)));
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 404 ? t("code.notFound") : errorText(reason, "roomUnavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="hm-code" onSubmit={event => { event.preventDefault(); void find(); }}>
      <label className="hm-field">
        <span>{t("code.label")}</span>
        <input value={code} maxLength={200} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={t("code.placeholder")}
          aria-invalid={Boolean(error)} aria-describedby="hm-code-hint" onChange={event => { onCode(event.target.value); setError(""); }} />
      </label>
      <button type="submit" className="hm-secondary" disabled={busy || !clean(code)}>{t("code.submit")}</button>
      {error ? <p className="hm-error" role="alert">{error}</p> : <p id="hm-code-hint" className="hm-hint">{t("code.hint")}</p>}
    </form>
  );
}
