import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, cityApi } from "../../online/api";
import type { CityMeta, GameState, LegalAction, PlayerState, RoomView } from "../../online/types";

/* Слой раздачи состояния.
 *
 * Зачем Query, а не проброс пропсами: доска — три колонки и десяток поповеров, каждому
 * листу нужен `game`. Пропсами это уже пробовали, вышло 900 строк в одном файле.
 *
 * Что НЕ меняется: `api.ts` остаётся как есть вместе с expected_revision, command_id и
 * условной выборкой по after_revision. Query здесь — кеш и статусы мутации, а не транспорт.
 */

interface SessionIdentity {
  roomId: string;
  password: string;
  playerId: string;
  meta: CityMeta;
}

const SessionContext = createContext<SessionIdentity | null>(null);

export function useSession(): SessionIdentity {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession вне <GameSession>");
  return session;
}

export function createGameQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Партия авторитетна на сервере: держать локальный кеш «свежим» смысла нет,
        // единственный источник обновления — опрос и ответ на команду.
        staleTime: 0,
        gcTime: 5 * 60_000,
        retry: 1,
      },
    },
  });
}

export function GameSession({ children, ...identity }: SessionIdentity & { children: ReactNode }) {
  const value = useMemo(
    () => identity,
    [identity.roomId, identity.password, identity.playerId, identity.meta],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function GameQueryProvider({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const roomKey = (roomId: string, playerId: string) => ["room", roomId, playerId] as const;

export function useRoom() {
  const { roomId, password, playerId } = useSession();
  const client = useQueryClient();
  const key = roomKey(roomId, playerId);

  return useQuery({
    queryKey: key,
    queryFn: async () => {
      // Сохраняем условную выборку: сервер отвечает `changed: false` без тела партии,
      // и тогда возвращается та же ссылка — React не перерисовывает доску вхолостую.
      const previous = client.getQueryData<RoomView>(key);
      const next = await cityApi.state(roomId, password, playerId, previous?.revision);
      return next.changed === false && previous ? previous : next;
    },
    // Опрос останавливается на финише партии. В фоне Query паузит интервал сам и
    // догоняет одним запросом при возврате фокуса — это заменяет прежний ручной
    // visibilitychange и 20-секундный фоновый интервал.
    refetchInterval: query => (query.state.data?.game?.status === "finished" ? false : 5_000),
    refetchOnWindowFocus: true,
  });
}

export function useGame(): GameState {
  const { data } = useRoom();
  if (!data?.game) throw new Error("useGame до загрузки партии — оборачивайте в <GameGate>");
  return data.game;
}

export function useMeta(): CityMeta {
  return useSession().meta;
}

export function useMe(): PlayerState {
  const game = useGame();
  const { playerId } = useSession();
  return game.players.find(player => player.id === playerId) ?? game.players[0];
}

/** Разрешённые действия считает движок. Клиент их только читает — никогда не выводит сам. */
export function useLegalActions(): LegalAction[] {
  return useRoom().data?.legal_actions ?? [];
}

export interface CommandHandle {
  send: (action: LegalAction) => void;
  /** Действие, которое сейчас летит на сервер. То, за что цепляется анимация до ответа. */
  pending: LegalAction | undefined;
  isPending: boolean;
  error: string;
}

export function useCommand(): CommandHandle {
  const { roomId, password, playerId } = useSession();
  const client = useQueryClient();
  const key = roomKey(roomId, playerId);

  const mutation = useMutation({
    mutationFn: (action: LegalAction) => {
      const room = client.getQueryData<RoomView>(key);
      const revision = room?.game?.revision ?? 0;
      return cityApi.command(roomId, password, playerId, revision, action);
    },
    // Ответ на команду — уже полное новое состояние, включая ходы ботов. Кладём его
    // напрямую: invalidate стоил бы лишнего round-trip на каждое действие.
    onSuccess: room => client.setQueryData(key, room),
    onError: error => {
      // 409 — разошлись ревизии: кто-то сходил раньше. Перечитываем, а не гадаем.
      if (error instanceof ApiError && error.status === 409) void client.invalidateQueries({ queryKey: key });
    },
  });

  return {
    send: mutation.mutate,
    pending: mutation.isPending ? mutation.variables : undefined,
    isPending: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : "",
  };
}
