import { useTranslation } from "react-i18next";
import { errorText } from "../i18n/errors";
import { useState, type ReactNode } from "react";
import type { CityMeta, LegalAction } from "../online/types";
import { Board } from "./board/Board";
import { GameQueryProvider, GameSession, createGameQueryClient, useRoom } from "./lib/session";
import "./theme.css";

/* Точка входа нового интерфейса. Держит QueryClient и ждёт первой загрузки партии,
 * чтобы внутри доски `useGame()` уже гарантированно имел состояние.
 */
export function GameScreen({
  roomId,
  password,
  playerId,
  meta,
  onExit,
  adminToken,
  allowAction,
  overlay,
}: {
  roomId: string;
  password: string;
  playerId: string;
  meta: CityMeta;
  onExit: () => void;
  /** Режим наблюдателя-админа: состояние читается по токену, действий нет. */
  adminToken?: string;
  /** Обучение: какие действия сейчас можно нажать. */
  allowAction?: (action: LegalAction) => boolean;
  /** Обучение: слой подсказок поверх доски, внутри той же сессии. */
  overlay?: ReactNode;
}) {
  const [client] = useState(createGameQueryClient);

  return (
    <GameQueryProvider client={client}>
      <GameSession
        roomId={roomId}
        password={password}
        playerId={playerId}
        meta={meta}
        adminToken={adminToken}
        allowAction={allowAction}
      >
        <Gate onExit={onExit} />
        {overlay}
      </GameSession>
    </GameQueryProvider>
  );
}

function Gate({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  const { data, error, isLoading } = useRoom();

  if (data?.game) return <Board onExit={onExit} />;

  return (
    <div className="ui-v2 grid h-dvh place-content-center gap-3 justify-items-center bg-surface
      font-sans text-ink">
      <p className="text-ink-muted">
        {isLoading ? t("app.loadingGame") : error ? errorText(error) : t("app.gameNotStarted")}
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-md border border-line bg-panel-2 px-3 py-2 text-xs hover:border-accent"
      >
        {t("app.backToRooms")}
      </button>
    </div>
  );
}
