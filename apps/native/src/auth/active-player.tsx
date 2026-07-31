import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getAccountPlayersFromClient,
  resolveActivePlayer,
  type AccountPlayer,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import {
  clearStoredActivePlayerId,
  getStoredActivePlayerId,
  setStoredActivePlayerId,
} from '@/lib/active-player-store';
import { useSession } from './session';
import { useApp } from './context';

/**
 * O2-5 — JUGADOR ACTIVO del tutor (análogo al CLUB ACTIVO de `context.tsx`).
 *
 * Un tutor con varios hijos elige uno; las pantallas player-scoped (Mi ficha, Mi
 * informe, Seguidores…) se filtran por él (tandas C+). Este PR solo monta el
 * ESTADO (lista de hijos + jugador activo + setter); el selector de UI llega con
 * las pantallas que lo usan.
 *
 * DEPENDE del club activo: los hijos son por club. Al cambiar de club se recarga
 * la lista y se revalida el jugador guardado contra ella (obsoleto → primero;
 * sin hijos → null). El id elegido persiste en secure-store (cifrado).
 *
 * La resolución guardado→válido/default/vacío es el helper PURO de core
 * `resolveActivePlayer` (mismo criterio que el club activo y el seguidor).
 */
type ActivePlayerContextValue = {
  loading: boolean;
  players: AccountPlayer[];
  activePlayer: AccountPlayer | null;
  setActivePlayer: (playerId: string) => Promise<void>;
};

const ActivePlayerContext = createContext<ActivePlayerContextValue | null>(null);

export function ActivePlayerProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { activeClub } = useApp();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<AccountPlayer[]>([]);
  const [activePlayer, setActivePlayerState] = useState<AccountPlayer | null>(
    null,
  );

  const userId = user?.id ?? null;
  const clubId = activeClub?.club.id ?? null;

  useEffect(() => {
    let active = true;

    // React Compiler prohíbe setState síncrono en el cuerpo del effect → IIFE.
    (async () => {
      // Sin sesión o sin club activo (staff/dirección/sin club) → sin hijo activo.
      if (!userId || !clubId) {
        if (!active) return;
        setPlayers([]);
        setActivePlayerState(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const list = await getAccountPlayersFromClient(supabase, clubId);
      if (!active) return;
      setPlayers(list);

      // Jugador activo: guardado si sigue válido en ESTE club; si no, el primero;
      // si el tutor no tiene hijos en el club, null.
      const stored = await getStoredActivePlayerId();
      if (!active) return;
      const { active: chosen, staleCookie } = resolveActivePlayer(
        list,
        stored,
        (p) => p.id,
      );
      setActivePlayerState(chosen);
      if (chosen) {
        // Mantener secure-store al día: escribir si estaba vacío o quedó obsoleto
        // (p.ej. tras cambiar de club el guardado apuntaba a un hijo de otro club).
        if (!stored || staleCookie) await setStoredActivePlayerId(chosen.id);
      } else {
        await clearStoredActivePlayerId();
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [userId, clubId]);

  const setActivePlayer = useCallback(
    async (playerId: string) => {
      const match = players.find((p) => p.id === playerId);
      if (!match) return;
      setActivePlayerState(match);
      await setStoredActivePlayerId(playerId);
    },
    [players],
  );

  return (
    <ActivePlayerContext.Provider
      value={{ loading, players, activePlayer, setActivePlayer }}
    >
      {children}
    </ActivePlayerContext.Provider>
  );
}

export function useActivePlayer(): ActivePlayerContextValue {
  const ctx = useContext(ActivePlayerContext);
  if (!ctx) {
    throw new Error('useActivePlayer debe usarse dentro de <ActivePlayerProvider>');
  }
  return ctx;
}
