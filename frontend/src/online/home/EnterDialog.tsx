import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RoomSummary } from "../types";

/* Вход в комнату из списка или по коду: имя и, если комната с паролем, пароль — до лобби, а не
 * формой внутри него. Проверяет пароль сервер при посадке; ошибся — лобби попросит его снова.
 *
 * Нативный `<dialog>`: фокус внутри, Escape закрывает, фокус возвращается к кнопке «Войти». */
export function EnterDialog({ room, playerName, returning, onSubmit, onClose }: {
  room: RoomSummary;
  playerName: string;
  /** Возврат на своё место: имя уже на нём, спрашивать нечего, кроме пароля. */
  returning: boolean;
  onSubmit: (name: string, password: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("home");
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(playerName);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const askName = !returning;
  const askPassword = !room.open;

  const submit = () => {
    if (askName && !name.trim()) { setError(t("enter.nameRequired")); return; }
    if (askPassword && !password) { setError(t("enter.passwordRequired")); return; }
    onSubmit(name.trim(), password);
  };

  return (
    <dialog ref={ref} className="hm-dialog" aria-labelledby="hm-enter-title" onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
      <form className="hm-dialog-body" onSubmit={event => { event.preventDefault(); submit(); }}>
        <h2 id="hm-enter-title">{t("enter.title", { name: room.name })}</h2>
        {askName && (
          <label className="hm-field">
            <span>{t("enter.name")}</span>
            <input autoFocus value={name} maxLength={32} autoComplete="nickname" placeholder={t("enter.namePlaceholder")} onChange={event => setName(event.target.value)} />
          </label>
        )}
        {askPassword && (
          <label className="hm-field">
            <span>{t("enter.password")}</span>
            <input autoFocus={!askName} type="password" value={password} maxLength={128} autoComplete="current-password" placeholder={t("enter.passwordPlaceholder")} onChange={event => setPassword(event.target.value)} />
          </label>
        )}
        {error && <p className="hm-error" role="alert">{error}</p>}
        <div className="hm-dialog-actions">
          <button type="button" className="hm-secondary" onClick={() => ref.current?.close()}>{t("enter.cancel")}</button>
          <button type="submit" className="hm-primary">{returning ? t("rooms.return") : t("enter.submit")}</button>
        </div>
      </form>
    </dialog>
  );
}
