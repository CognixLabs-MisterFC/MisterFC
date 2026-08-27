import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getCurrentUserClubsFromClient,
  getStaffTeamsFromClient,
  isSpectatorFromClient,
  navAreaForRole,
  resolveActiveClub,
  type CurrentUserClub,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import { clubLogoUrl } from '@/lib/club-logo';
import {
  clearStoredActiveClubId,
  getStoredActiveClubId,
  setStoredActiveClubId,
} from '@/lib/active-club-store';
import { NEUTRAL_COLOR, type ClubTheme } from '@/theme';
import { useForegroundPoll } from '@/hooks/use-foreground-poll';
import { useSession } from './session';

/**
 * Invalidación de caché · Parte 1 — Refresco de providers al volver de background.
 * El móvil mantiene la app "caliente" semanas y el arranque en frío nunca llega, así
 * que rol/membership/clubs se quedaban congelados toda la sesión. `useForegroundPoll`
 * (el mismo patrón de mensajes/directos) recarga en 2º plano al resumir y cada
 * intervalo; el throttle deja pasar como mucho una recarga por ventana. 60 s: estos
 * datos cambian en escala de horas (acción de admin en web), así que 60 s colapsa la
 * ventana de "días" a ≤1 min con coste despreciable, y absorbe el alternado rápido de
 * apps (volver antes de 60 s no recarga). La recarga es SILENCIOSA (no toca `loading`)
 * para no parpadear el splash/AreaGuard en cada ciclo.
 */
const PROVIDER_REFRESH_MIN_INTERVAL_MS = 60_000;

/**
 * Tipo de usuario tras login:
 *  - 'member'    → tiene ≥1 membership de club (flujo normal, B6).
 *  - 'spectator' → SIN membership pero es seguidor (is_spectator). PR-1 solo lo
 *                  DETECTA; su carcasa/enrutado los monta PR-2 (ver más abajo).
 *  - 'none'      → sin club y sin seguimiento (cuenta sin acceso aún).
 */
export type UserKind = 'member' | 'spectator' | 'none';

/**
 * Baja de miembros (4c) — una baja del usuario actual, para el banner informativo de
 * las pantallas SIN club (none/spectator). Sin `left_reason`: la razón es nota interna
 * del club y no viaja al cliente (la RPC ni la devuelve).
 */
export type RemovedMembership = {
  club_id: string;
  club_name: string;
  club_slug: string;
  left_at: string;
};

type AppContextValue = {
  loading: boolean;
  kind: UserKind;
  profileName: string | null;
  clubs: CurrentUserClub[];
  activeClub: CurrentUserClub | null;
  theme: ClubTheme | null;
  /**
   * S2 director-entrenador — el miembro activo (rol de DIRECCIÓN) está asignado como
   * team_staff de ≥1 equipo (de la temporada activa). Es el flag que desbloquea el
   * modo entrenador: lo lee `useAreaGuard` (para permitir el área 'staff') y la barra
   * de dirección (S2-2, para mostrar el conmutador "Míster"). Solo se calcula para
   * roles cuyo hogar es 'direction' (admin_club/director); para el resto es `false`
   * SIN coste (no se hace la query). Se refresca en el poll de 60 s junto al rol.
   */
  hasStaffTeams: boolean;
  /**
   * Baja de miembros (4c) — bajas del usuario actual. Solo se puebla cuando NO tiene
   * clubes activos (kind none/spectator); en el camino `member` es SIEMPRE `[]` y la
   * RPC no se llama (coste cero para el usuario normal).
   */
  removedMemberships: RemovedMembership[];
  setActiveClub: (clubId: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

function themeFromClub(club: CurrentUserClub): ClubTheme {
  const color = club.club.primary_color ?? null;
  return {
    clubName: club.club.name,
    logoUrl: clubLogoUrl(club.club.logo_path),
    color: color ?? NEUTRAL_COLOR,
    isNeutralColor: color == null,
  };
}

/**
 * Carga y expone el contexto de la app tras login: perfil, clubs, club activo
 * (persistido en secure-store), detección de seguidor y TEMA del club activo.
 * Depende de `SessionProvider` (debe montarse por dentro de él).
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<UserKind>('none');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [clubs, setClubs] = useState<CurrentUserClub[]>([]);
  const [activeClub, setActiveClubState] = useState<CurrentUserClub | null>(
    null,
  );
  const [removedMemberships, setRemovedMemberships] = useState<
    RemovedMembership[]
  >([]);
  const [hasStaffTeams, setHasStaffTeams] = useState(false);

  const userId = user?.id ?? null;

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

  // Carga del contexto. `silent=false` (frío / cambio de userId) muestra `loading`
  // como siempre; `silent=true` (refresco al resumir) recarga por detrás sin tocar
  // `loading`. `alive()` descarta escrituras de una corrida obsoleta (desmontaje o
  // cambio de userId). Comportamiento en frío IDÉNTICO al anterior.
  const runLoad = useCallback(
    async (silent: boolean, alive: () => boolean) => {
      if (!userId) {
        if (!alive()) return;
        setKind('none');
        setProfileName(null);
        setClubs([]);
        setActiveClubState(null);
        setRemovedMemberships([]);
        setHasStaffTeams(false);
        if (!silent) setLoading(false);
        return;
      }

      if (!silent) setLoading(true);

      try {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', userId)
          .maybeSingle();

        const userClubs = await getCurrentUserClubsFromClient(supabase);

        if (!alive()) return;

        setProfileName(profileRow?.full_name ?? null);
        setClubs(userClubs);

        if (userClubs.length > 0) {
          // Camino MEMBER: nunca llama a my_removed_memberships (coste cero). Un miembro
          // con club activo no ve el banner de baja: las superficies que lo pintan son
          // inalcanzables con club.
          setRemovedMemberships([]);
          const stored = await getStoredActiveClubId();
          if (!alive()) return;
          const { active: chosen } = resolveActiveClub(userClubs, stored);
          if (chosen) {
            setActiveClubState(chosen);
            await setStoredActiveClubId(chosen.club.id);
            // S2 director-entrenador: ¿el miembro activo está asignado como team_staff?
            // Solo se consulta para roles cuyo hogar es 'direction' (admin_club/director):
            // es el único caso que desbloquea el área staff. El resto → false sin query.
            if (navAreaForRole(chosen.role) === 'direction') {
              const staffTeams = await getStaffTeamsFromClient(supabase, {
                membershipId: chosen.membershipId,
                clubId: chosen.club.id,
              });
              if (!alive()) return;
              setHasStaffTeams(staffTeams.length > 0);
            } else {
              setHasStaffTeams(false);
            }
          } else {
            setHasStaffTeams(false);
          }
          setKind('member');
        } else {
          // Sin clubs: ¿seguidor puro? (detección PR-1; carcasa en PR-2). Baja de
          // miembros (4c): SOLO aquí (sin clubes activos) consultamos las bajas del
          // usuario para el banner informativo de none/spectator.
          const spectator = await isSpectatorFromClient(supabase);
          const { data: removed } = await supabase.rpc('my_removed_memberships');
          if (!alive()) return;
          setActiveClubState(null);
          setRemovedMemberships(removed ?? []);
          setHasStaffTeams(false);
          setKind(spectator ? 'spectator' : 'none');
        }

        lastLoadRef.current = Date.now();
      } finally {
        if (!silent && alive()) setLoading(false);
      }
    },
    [userId],
  );

  // Carga inicial + cambio de userId (con spinner, como antes). Va en un IIFE async
  // (la setState queda dentro de un callback, no en el cuerpo del effect).
  useEffect(() => {
    let active = true;
    void (async () => {
      await runLoad(false, () => active);
    })();
    return () => {
      active = false;
    };
  }, [runLoad]);

  // Refresco silencioso al volver de background / en foreground, throttled a 60 s.
  const refresh = useCallback(() => {
    if (Date.now() - lastLoadRef.current < PROVIDER_REFRESH_MIN_INTERVAL_MS) return;
    void runLoad(true, () => mountedRef.current);
  }, [runLoad]);
  useForegroundPoll(refresh, PROVIDER_REFRESH_MIN_INTERVAL_MS);

  const setActiveClub = useCallback(
    async (clubId: string) => {
      const match = clubs.find((c) => c.club.id === clubId);
      if (!match) return;
      setActiveClubState(match);
      await setStoredActiveClubId(clubId);
    },
    [clubs],
  );

  const signOut = useCallback(async () => {
    await clearStoredActiveClubId();
    await supabase.auth.signOut();
    // onAuthStateChange (SessionProvider) pone user=null → el gate vuelve a login.
  }, []);

  const theme = activeClub ? themeFromClub(activeClub) : null;

  return (
    <AppContext.Provider
      value={{
        loading,
        kind,
        profileName,
        clubs,
        activeClub,
        theme,
        removedMemberships,
        hasStaffTeams,
        setActiveClub,
        signOut,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de <AppProvider>');
  return ctx;
}
