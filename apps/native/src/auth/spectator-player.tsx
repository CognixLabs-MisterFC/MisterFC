import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getFollowedPlayersFromClient,
  resolveActivePlayer,
  type FollowedPlayer,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import {
  clearStoredSpectatorPlayerId,
  getStoredSpectatorPlayerId,
  setStoredSpectatorPlayerId,
} from '@/lib/active-spectator-player-store';
import { useSession } from './session';

/**
 * O2-6 — JUGADOR SEGUIDO ACTIVO del seguidor (análogo al hijo activo del tutor,
 * `active-player.tsx`). Un seguidor sigue a VARIOS jugadores; elige uno y las
 * pantallas de la carcasa /spectator (agenda/directos/estadísticas) se scopean por
 * él (caché con su playerId). NO depende de club activo (el seguidor no tiene
 * membership): sigue jugadores directamente (player_spectators).
 *
 * La resolución guardado→válido/default/vacío es el helper PURO de core
 * `resolveActivePlayer` (mismo que el hijo del tutor y la cookie web del seguidor),
 * con la clave `playerId` de `FollowedPlayer`. El id elegido persiste en
 * secure-store (clave propia, cifrado).
 */
type SpectatorPlayerContextValue = {
  loading: boolean;
  players: FollowedPlayer[];
  activePlayer: FollowedPlayer | null;
  setActivePlayer: (playerId: string) => Promise<void>;
};

const SpectatorPlayerContext =
  createContext<SpectatorPlayerContextValue | null>(null);

export function SpectatorPlayerProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<FollowedPlayer[]>([]);
  const [activePlayer, setActivePlayerState] = useState<FollowedPlayer | null>(
    null,
  );

  const userId = user?.id ?? null;

  useEffect(() => {
    let active = true;

    // React Compiler prohíbe setState síncrono en el cuerpo del effect → IIFE.
    (async () => {
      if (!userId) {
        if (!active) return;
        setPlayers([]);
        setActivePlayerState(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const list = await getFollowedPlayersFromClient(supabase, userId);
      if (!active) return;
      setPlayers(list);

      const stored = await getStoredSpectatorPlayerId();
      if (!active) return;
      const { active: chosen, staleCookie } = resolveActivePlayer(
        list,
        stored,
        (p) => p.playerId,
      );
      setActivePlayerState(chosen);
      if (chosen) {
        // Mantener el secure-store al día: escribir si estaba vacío o quedó obsoleto.
        if (!stored || staleCookie) await setStoredSpectatorPlayerId(chosen.playerId);
      } else {
        await clearStoredSpectatorPlayerId();
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  const setActivePlayer = useCallback(
    async (playerId: string) => {
      const match = players.find((p) => p.playerId === playerId);
      if (!match) return;
      setActivePlayerState(match);
      await setStoredSpectatorPlayerId(playerId);
    },
    [players],
  );

  return (
    <SpectatorPlayerContext.Provider
      value={{ loading, players, activePlayer, setActivePlayer }}
    >
      {children}
    </SpectatorPlayerContext.Provider>
  );
}

export function useSpectatorPlayer(): SpectatorPlayerContextValue {
  const ctx = useContext(SpectatorPlayerContext);
  if (!ctx) {
    throw new Error(
      'useSpectatorPlayer debe usarse dentro de <SpectatorPlayerProvider>',
    );
  }
  return ctx;
}
