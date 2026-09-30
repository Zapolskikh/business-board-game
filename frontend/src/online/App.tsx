import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { cityApi } from "./api";
import { useTranslation } from "react-i18next";
import { useLocalizedMeta } from "../i18n/catalog";
import { Lobby } from "./Lobby";
import { RoomBrowser } from "./RoomBrowser";
import { FeedbackPage } from "./FeedbackPage";
import { FEEDBACK_URL } from "./support";
import type { CityMeta } from "./types";
// Ленивая загрузка: браузер комнат и лобби не должны тянуть Motion, Radix и Query.
const GameScreen = lazy(() => import("../ui/GameScreen").then(module => ({ default: module.GameScreen })));

interface Session { password: string; playerId: string }

/* Страница обратной связи открывается и по /feedback, и по ?page=feedback: второй адрес
 * работает на любом хостинге, даже если сервер не отдаёт приложение на произвольный путь. */
const onFeedbackPage = () =>
  location.pathname.startsWith("/feedback") || new URLSearchParams(location.search).get("page") === "feedback";

export default function App() {
  const { t } = useTranslation();
  const [serverMeta, setMeta] = useState<CityMeta | null>(null);
  // Каталог на языке игрока: всё ниже читает названия карт и ролей отсюда.
  const meta = useLocalizedMeta(serverMeta);
  const [fatal, setFatal] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [initialPassword, setInitialPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  const [feedback, setFeedback] = useState(onFeedbackPage);
  // Кнопка «назад» в браузере возвращает с отзыва на главную и обратно.
  useEffect(() => {
    const onPop = () => setFeedback(onFeedbackPage());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const openFeedback = useCallback(() => { history.pushState(null, "", FEEDBACK_URL); setFeedback(true); window.scrollTo(0, 0); }, []);
  const closeFeedback = useCallback(() => { history.pushState(null, "", "/"); setFeedback(false); }, []);
  useEffect(() => { cityApi.meta().then(setMeta).catch(() => setFatal(t("app.serverDown"))); }, []);
  const back = useCallback(() => { setRoomId(null); setSession(null); setPlaying(false); setInitialPassword(""); }, []);
  const play = useCallback(() => setPlaying(true), []);
  // Отзыв можно оставить и тогда, когда игровой сервер лежит, — это как раз повод написать.
  if (feedback) return <FeedbackPage onBack={closeFeedback} />;
  if (fatal) return <main className="rooms-app app-state"><section className="rooms-panel"><span className="eyebrow">{t("app.connectionError")}</span><h1>{t("app.serverDown")}</h1><p className="rooms-alert">{fatal}</p><button className="rooms-button primary" onClick={() => location.reload()}>{t("app.retry")}</button></section></main>;
  if (!meta) return <div className="rooms-app app-state"><span className="loading-ring" /><p>{t("app.loadingCatalog")}</p></div>;
  if (!roomId) return <RoomBrowser onFeedback={openFeedback} onOpen={(id, password = "") => { setRoomId(id); setInitialPassword(password); }} />;
  if (playing && session) {
    return (
      <Suspense fallback={<div className="rooms-app app-state"><span className="loading-ring" /><p>{t("app.loadingTable")}</p></div>}>
        <GameScreen roomId={roomId} password={session.password} playerId={session.playerId} meta={meta} onExit={back} />
      </Suspense>
    );
  }
  return <Lobby roomId={roomId} meta={meta} initialPassword={initialPassword} playerId={session?.playerId} onBack={back} onJoined={(password, playerId) => setSession({ password, playerId })} onPlay={play} />;
}
