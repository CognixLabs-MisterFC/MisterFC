import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getCurrentUserClubsFromClient,
  isSpectatorFromClient,
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
import { useSession } from './session';

/**
 * Tipo de usuario tras login:
 *  - 'member'    → tiene ≥1 membership de club (flujo normal, B6).
 *  - 'spectator' → SIN membership pero es seguidor (is_spectator). PR-1 solo lo
 *                  DETECTA; su carcasa/enrutado los monta PR-2 (ver más abajo).
 *  - 'none'      → sin club y sin seguimiento (cuenta sin acceso aún).
 */
export type UserKind = 'member' | 'spectator' | 'none';

type AppContextValue = {
  loading: boolean;
  kind: UserKind;
  profileName: string | null;
  clubs: CurrentUserClub[];
  activeClub: CurrentUserClub | null;
  theme: ClubTheme | null;
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

  const userId = user?.id ?? null;

  useEffect(() => {
    let active = true;

    // Todo el trabajo (incluido el reset sin sesión) va dentro del IIFE async:
    // React Compiler prohíbe setState SÍNCRONO en el cuerpo del effect.
    (async () => {
      if (!userId) {
        if (!active) return;
        setKind('none');
        setProfileName(null);
        setClubs([]);
        setActiveClubState(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();

      const userClubs = await getCurrentUserClubsFromClient(supabase);

      if (!active) return;

      setProfileName(profileRow?.full_name ?? null);
      setClubs(userClubs);

      if (userClubs.length > 0) {
        const stored = await getStoredActiveClubId();
        if (!active) return;
        const { active: chosen } = resolveActiveClub(userClubs, stored);
        if (chosen) {
          setActiveClubState(chosen);
          await setStoredActiveClubId(chosen.club.id);
        }
        setKind('member');
      } else {
        // Sin clubs: ¿seguidor puro? (detección PR-1; carcasa en PR-2).
        const spectator = await isSpectatorFromClient(supabase);
        if (!active) return;
        setActiveClubState(null);
        setKind(spectator ? 'spectator' : 'none');
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [userId]);

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
