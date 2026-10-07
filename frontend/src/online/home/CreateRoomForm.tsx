import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../../i18n/errors";
import { ApiError, cityApi } from "../api";
import { newSecret, saveOwnerToken } from "../roomSecrets";
import type { RoomSummary } from "../types";

// Названия сравниваются так, как их читает человек: без регистра и лишних пробелов — как на сервере.
export const nameKey = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/** Поля формы создания. Живут выше формы: на телефоне форма — отдельный экран, и «Назад» их не теряет. */
export interface CreateDraft {
  name: string;
  protect: boolean;
  password: string;
  capacity: number;
  rounds: string;
  rolePrice: number;
}
export const EMPTY_DRAFT: CreateDraft = { name: "", protect: false, password: "", capacity: 4, rounds: "15", rolePrice: 3 };

/* Создание комнаты. Достаточно имени игрока: название, если его не ввели, придумывается само
 * («Комната Олег», при совпадении — с номером), пароль включается отдельным переключателем. Сервер
 * отклоняет совпадающие названия — тогда берётся следующий номер. */
export function CreateRoomForm({ draft, onDraft, playerName, onPlayerName, rooms, onCreated, compact = false }: {
  draft: CreateDraft;
  onDraft: (patch: Partial<CreateDraft>) => void;
  playerName: string;
  onPlayerName: (name: string) => void;
  rooms: RoomSummary[];
  onCreated: (roomId: string, password: string, playerName: string) => void;
  /** Без заголовка: на телефоне заголовок — у самого экрана. */
  compact?: boolean;
}) {
  const { t } = useTranslation("home");
  const nameRef = useRef<HTMLInputElement>(null);
  const [nameMissing, setNameMissing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parsedRounds = Number(draft.rounds);
  const roundsValid = /^\d+$/.test(draft.rounds) && parsedRounds >= 5 && parsedRounds <= 30;
  const roundsValue = draft.rounds === "" ? 15 : parsedRounds;
  const typedName = draft.name.trim();
  const nameTaken = Boolean(typedName) && rooms.some(room => nameKey(room.name) === nameKey(typedName));
  const passwordOk = !draft.protect || draft.password.length >= 4;
  const ready = !nameTaken && passwordOk && roundsValid && !busy;

  const flagMissingName = () => {
    setNameMissing(true);
    const field = nameRef.current;
    if (!field) return;
    field.focus();
    // Перезапуск встряхивания: и на первое, и на каждое следующее нажатие без имени.
    field.classList.remove("field-shake");
    void field.offsetWidth;
    field.classList.add("field-shake");
  };

  const create = async () => {
    const player = playerName.trim();
    if (!player) return flagMissingName();
    if (!ready) return;
    setBusy(true); setError("");
    const password = draft.protect ? draft.password : "";
    const taken = new Set(rooms.map(room => nameKey(room.name)));
    const base = typedName || t("create.autoName", { name: player });
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = attempt === 0 || typedName ? base : `${base} ${attempt + 1}`;
        if (!typedName && taken.has(nameKey(candidate))) continue;
        // Ключ создателя придумывает браузер: с ним — и только с ним — можно сажать ботов и начинать игру.
        const ownerToken = newSecret();
        try {
          const room = await cityApi.create({
            name: candidate.slice(0, 48),
            password,
            capacity: draft.capacity,
            max_rounds: parsedRounds,
            role_price: draft.rolePrice,
            open: !draft.protect,
            owner_token: ownerToken,
          });
          saveOwnerToken(room.id, ownerToken);
          onCreated(room.id, password, player);
          return;
        } catch (reason) {
          // Своё название занято — сказать об этом; придуманное — взять следующий номер.
          if (typedName || !(reason instanceof ApiError && reason.status === 409)) throw reason;
          taken.add(nameKey(candidate));
        }
      }
    } catch (reason) {
      setError(errorText(reason, "createRoom"));
    } finally {
      setBusy(false);
    }
  };

  const hint = !playerName.trim() ? t("create.hintPlayerName")
    : nameTaken ? t("create.nameTaken")
    : !passwordOk ? t("create.hintPassword")
    : t("create.hintReady");

  return (
    <section className="rooms-panel create-room-card" data-ui="create-room">
      {!compact && (
        <header className="create-head">
          <h2>{t("create.heading")}</h2>
          <p>{t("create.subheading")}</p>
        </header>
      )}
      {error && <p className="rooms-alert" role="alert">{error}</p>}
      <form onSubmit={event => { event.preventDefault(); void create(); }}>
        <label className="room-field">
          <span>{t("create.playerName")} <i className="required-mark" aria-hidden="true">*</i></span>
          <input
            ref={nameRef}
            value={playerName}
            maxLength={32}
            autoComplete="nickname"
            placeholder={t("create.playerNamePlaceholder")}
            aria-required="true"
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? "player-name-missing" : undefined}
            onAnimationEnd={event => event.currentTarget.classList.remove("field-shake")}
            onChange={event => { onPlayerName(event.target.value); if (event.target.value.trim()) setNameMissing(false); }}
          />
          {nameMissing && <small id="player-name-missing" className="field-error" role="alert">{t("create.hintPlayerName")}</small>}
        </label>
        <label className="room-field">
          <span>{t("create.name")}</span>
          <input value={draft.name} maxLength={48} placeholder={t("create.namePlaceholder")} aria-invalid={nameTaken} onChange={event => onDraft({ name: event.target.value })} />
          {nameTaken && <small className="field-error">{t("create.nameTaken")}</small>}
        </label>

        <div className="quick-settings">
          <div className="room-field">
            <span id="create-players">{t("create.players")}</span>
            <div className="segmented" role="radiogroup" aria-labelledby="create-players">
              {[2, 3, 4].map(value => (
                <button key={value} type="button" role="radio" aria-checked={draft.capacity === value} className={draft.capacity === value ? "active" : ""} onClick={() => onDraft({ capacity: value })}>{value}</button>
              ))}
            </div>
          </div>
          <div className="room-field">
            <span>{t("create.rounds")}</span>
            <div className="stepper">
              <button type="button" aria-label={t("create.roundsLess")} disabled={roundsValue <= 5} onClick={() => onDraft({ rounds: String(Math.max(5, roundsValue - 1)) })}>−</button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={draft.rounds}
                aria-label={t("create.rounds")}
                aria-invalid={draft.rounds !== "" && !roundsValid}
                onChange={event => onDraft({ rounds: event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "") })}
                onBlur={() => onDraft({ rounds: String(draft.rounds === "" ? 15 : Math.min(30, Math.max(5, Number(draft.rounds)))) })}
              />
              <button type="button" aria-label={t("create.roundsMore")} disabled={roundsValue >= 30} onClick={() => onDraft({ rounds: String(Math.min(30, roundsValue + 1)) })}>+</button>
            </div>
          </div>
        </div>

        <label className="open-toggle">
          <input type="checkbox" checked={draft.protect} onChange={event => onDraft({ protect: event.target.checked })} />
          <span className="switch" aria-hidden="true" />
          <span><b>{t("create.protect")}</b><small>{draft.protect ? t("create.protectOn") : t("create.protectOff")}</small></span>
        </label>
        {draft.protect && (
          <label className="room-field">
            <span>{t("create.password")}</span>
            <span className="input-with-action">
              <input autoFocus type={showPassword ? "text" : "password"} value={draft.password} maxLength={128} autoComplete="new-password" placeholder={t("create.passwordPlaceholder")} onChange={event => onDraft({ password: event.target.value })} />
              <button type="button" className="input-action" aria-label={t(showPassword ? "create.hidePassword" : "create.showPassword")} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="M4 4l16 16" />}
                </svg>
              </button>
            </span>
          </label>
        )}

        <details className="advanced-settings">
          <summary>{t("create.advanced")} <span aria-hidden="true">⌄</span></summary>
          <label className="room-field">
            <span>{t("create.rolePrice")}</span>
            <input type="number" min={2} max={10} value={draft.rolePrice} onChange={event => onDraft({ rolePrice: Number(event.target.value) })} />
            <small>{t("create.rolePriceHint")}</small>
          </label>
        </details>

        <button className="rooms-button primary create-submit" type="submit" disabled={!ready}>
          <span>{busy ? t("create.submitting") : t("create.submit")}</span><span aria-hidden="true">→</span>
        </button>
        <p className={`form-hint ${playerName.trim() && ready ? "" : "missing"}`}>{hint}</p>
      </form>
    </section>
  );
}
