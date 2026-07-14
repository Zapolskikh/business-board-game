import { useCallback, useEffect, useState } from "react";
import { cityApi } from "./api";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import { RoomBrowser } from "./RoomBrowser";
import type { CityMeta } from "./types";

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
  if (playing && session) return <Game roomId={roomId} password={session.password} playerId={session.playerId} meta={meta} onExit={back} />;
  return <Lobby roomId={roomId} meta={meta} initialPassword={initialPassword} playerId={session?.playerId} onBack={back} onJoined={(password, playerId) => setSession({ password, playerId })} onPlay={play} />;
}
