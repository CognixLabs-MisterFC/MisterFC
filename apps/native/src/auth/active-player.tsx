import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';
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
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { useTranslations } from '@/locale/provider';
import { useSession } from './session';
import { useApp } from './context';

/**
 * Invalidación de caché · Parte 1 — mismo refresco en 2º plano que `AppProvider`
 * (60 s, silencioso), para que la lista de hijos deje de estar congelada durante la
 * sesión caliente. Además, si al refrescar EN VIVO el hijo activo ha desaparecido de
 * la lista (baja/supresión en web), se AVISA al tutor y después se resuelve (cae al
 * primero, o `null` si no queda ninguno). El aviso NO da el motivo (el tutor puede no
 * saberlo y no es la app quien se lo cuenta) y NO sale en arranque en frío ni al
 * cambiar de club: solo en el camino de refresco vivo (ver `runLoad`).
 */
const PROVIDER_REFRESH_MIN_INTERVAL_MS = 60_000;

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

  // No escribir estado tras desmontar (guard del refresco en 2º plano).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Sello del último load REAL (frío o refresco): base del throttle de 60 s.
  const lastLoadRef = useRef(0);
  // Hijo activo vigente, leído en el refresco para detectar si ha desaparecido sin
  // depender de él en las deps de `runLoad` (evita re-armar el poll en cada cambio).
  const activePlayerRef = useRef<AccountPlayer | null>(null);
  useEffect(() => {
    activePlayerRef.current = activePlayer;
  }, [activePlayer]);
  // `t` por ref: se usa solo al lanzar el aviso; así `runLoad` no depende de `t` (no
  // se re-arma el poll al cambiar de idioma).
  const t = useTranslations('active_player');
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Carga de la lista + resolución del hijo activo. `silent=false` (frío / cambio de
  // userId|clubId) muestra `loading` como siempre; `silent=true` (refresco) recarga
  // sin tocar `loading`. `notifyOnDrop` SOLO lo pasa el refresco vivo: si el hijo
  // activo en memoria ya no está en la lista nueva, avisa antes de resolver. En frío
  // `notifyOnDrop=false` (no hay "hijo previo" real) y al cambiar de club tampoco
  // (es una selección nueva, no una desaparición) → el aviso jamás sale ahí.
  const runLoad = useCallback(
    async (
      silent: boolean,
      alive: () => boolean,
      notifyOnDrop: boolean,
    ) => {
      // Sin sesión o sin club activo (staff/dirección/sin club) → sin hijo activo.
      if (!userId || !clubId) {
        if (!alive()) return;
        setPlayers([]);
        setActivePlayerState(null);
        if (!silent) setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      try {
        const list = await getAccountPlayersFromClient(supabase, clubId);
        if (!alive()) return;

        // ¿El hijo activo vivo ha desaparecido de la lista? (solo importa en vivo).
        const prevId = activePlayerRef.current?.id ?? null;
        const dropped =
          notifyOnDrop && prevId != null && !list.some((p) => p.id === prevId);

        setPlayers(list);

        // Jugador activo: guardado si sigue válido en ESTE club; si no, el primero;
        // si el tutor no tiene hijos en el club, null.
        const stored = await getStoredActivePlayerId();
        if (!alive()) return;
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

        // Aviso DESPUÉS de resolver: el jugador ya no está (sin dar el motivo). Cubre
        // los dos casos —quedan otros (cae al primero) o ninguno (activePlayer=null)—.
        if (dropped) {
          Alert.alert(tRef.current('removed_title'), tRef.current('removed_body'));
        }

        lastLoadRef.current = Date.now();
      } finally {
        if (!silent && alive()) setLoading(false);
      }
    },
    [userId, clubId],
  );

  // Carga inicial + cambio de userId|clubId (con spinner, SIN aviso). Es el camino de
  // "frío / cambio de club": una selección nueva, no una desaparición. Va en un IIFE
  // async (la setState queda dentro de un callback, no en el cuerpo del effect).
  useEffect(() => {
    let active = true;
    void (async () => {
      await runLoad(false, () => active, false);
    })();
    return () => {
      active = false;
    };
  }, [runLoad]);

  // Refresco silencioso al volver de background / en foreground, throttled a 60 s. Es
  // el ÚNICO camino que avisa si el hijo activo ha desaparecido.
  const refresh = useCallback(() => {
    if (Date.now() - lastLoadRef.current < PROVIDER_REFRESH_MIN_INTERVAL_MS) return;
    void runLoad(true, () => mountedRef.current, true);
  }, [runLoad]);
  useForegroundPoll(refresh, PROVIDER_REFRESH_MIN_INTERVAL_MS);

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
