import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { cityApi } from "./api";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import { RoomBrowser } from "./RoomBrowser";
import type { CityMeta } from "./types";
import { useLegacyUi } from "./uiVersion";
// Ленивая загрузка: браузер комнат и лобби не должны тянуть Motion, Radix и Query.
const GameScreen = lazy(() => import("../ui/GameScreen").then(module => ({ default: module.GameScreen })));

interface Session { password: string; playerId: string }

export default function App() {
  const [meta, setMeta] = useState<CityMeta | null>(null);
  const [fatal, setFatal] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [initialPassword, setInitialPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { cityApi.meta().then(setMeta).catch(reason => setFatal(reason instanceof Error ? reason.message : "Backend недоступен")); }, []);
  const back = useCallback(() => { setRoomId(null); setSession(null); setPlaying(false); setInitialPassword(""); }, []);
  const play = useCallback(() => setPlaying(true), []);
  if (fatal) return <main className="rooms-app app-state"><section className="rooms-panel"><span className="eyebrow">Ошибка соединения</span><h1>Сервер игры недоступен</h1><p className="rooms-alert">{fatal}</p><button className="rooms-button primary" onClick={() => location.reload()}>Попробовать снова</button></section></main>;
  if (!meta) return <div className="rooms-app app-state"><span className="loading-ring" /><p>Загружаем городской каталог…</p></div>;
  if (!roomId) return <RoomBrowser onOpen={(id, password = "") => { setRoomId(id); setInitialPassword(password); }} />;
  if (playing && session) {
    return useLegacyUi
      ? <Game roomId={roomId} password={session.password} playerId={session.playerId} meta={meta} onExit={back} />
      : <Suspense fallback={<div className="rooms-app app-state"><span className="loading-ring" /><p>Готовим игровой стол…</p></div>}>
          <GameScreen roomId={roomId} password={session.password} playerId={session.playerId} meta={meta} roomName={roomId} onExit={back} />
        </Suspense>;
  }
  return <Lobby roomId={roomId} meta={meta} initialPassword={initialPassword} playerId={session?.playerId} onBack={back} onJoined={(password, playerId) => setSession({ password, playerId })} onPlay={play} />;
}
