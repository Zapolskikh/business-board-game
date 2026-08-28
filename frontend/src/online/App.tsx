import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { cityApi } from "./api";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import { RoomBrowser } from "./RoomBrowser";
import type { CityMeta } from "./types";
// Ленивая загрузка: браузер комнат и лобби не должны тянуть Motion, Radix и Query.
const GameScreen = lazy(() => import("../ui/GameScreen").then(module => ({ default: module.GameScreen })));

// Старый экран остаётся точкой входа, новый открывается по ?ui=v2. Обратный порядок
// («новый по умолчанию, ?ui=old возвращает прежний») писался под ветку ui-v2, но коммит
// ушёл прямо в main, а Vercel деплоит main в production — и v2 уехал живым игрокам.
// Пока v2 не заменит старый экран целиком, умолчание принадлежит тому, на чём играют:
// то же самое сказано в main.tsx, где выбирается точка входа.
const useLegacyUi = new URLSearchParams(location.search).get("ui") !== "v2";

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
  if (fatal) return <main className="online-shell"><section className="panel"><h1>Backend недоступен</h1><p className="error">{fatal}</p><button onClick={() => location.reload()}>Повторить</button></section></main>;
  if (!meta) return <div className="loading">Загрузка городского каталога…</div>;
  if (!roomId) return <RoomBrowser onOpen={(id, password = "") => { setRoomId(id); setInitialPassword(password); }} />;
  if (playing && session) {
    return useLegacyUi
      ? <Game roomId={roomId} password={session.password} playerId={session.playerId} meta={meta} onExit={back} />
      : <Suspense fallback={<div className="loading">Загрузка интерфейса…</div>}>
          <GameScreen roomId={roomId} password={session.password} playerId={session.playerId} meta={meta} roomName={roomId} onExit={back} />
        </Suspense>;
  }
  return <Lobby roomId={roomId} meta={meta} initialPassword={initialPassword} playerId={session?.playerId} onBack={back} onJoined={(password, playerId) => setSession({ password, playerId })} onPlay={play} />;
}
