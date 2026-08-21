import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  getStaffTeamsFromClient,
  resolveActivePlayer,
  type StaffTeamCard,
} from '@misterfc/core';
import { supabase } from '@/lib/supabase';
import {
  clearStoredStaffTeamId,
  getStoredStaffTeamId,
  setStoredStaffTeamId,
} from '@/lib/active-staff-team-store';
import { reportDataError } from '@/lib/report-error';
import { useApp } from './context';

/**
 * O2-10b-2 — EQUIPO ACTIVO del coordinador (análogo al hijo activo del tutor y al
 * jugador seguido del seguidor). Un coordinador tiene VARIOS equipos (team_staff);
 * elige uno y las CONSULTAS del coordinador (cuerpo técnico de dirección · jugadores)
 * se scopean por él (caché con su teamId). Depende del CLUB activo (membershipId +
 * clubId), de donde salen sus equipos vía `getStaffTeamsFromClient` (ya en core, 10a).
 *
 * La resolución guardado→válido/default/vacío reutiliza el helper PURO de core
 * `resolveActivePlayer` (mismo molde que el hijo, el seguidor y la cookie web), con la
 * clave `teamId` de `StaffTeamCard`. El id elegido persiste en secure-store (clave
 * PROPIA `active_staff_team_id`, independiente de las otras: uno podría ser
 * coordinador Y tutor).
 */
type ActiveStaffTeamContextValue = {
  loading: boolean;
  teams: StaffTeamCard[];
  activeTeam: StaffTeamCard | null;
  setActiveTeam: (teamId: string) => Promise<void>;
};

const ActiveStaffTeamContext = createContext<ActiveStaffTeamContextValue | null>(null);

export function ActiveStaffTeamProvider({ children }: { children: ReactNode }) {
  const { activeClub } = useApp();
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<StaffTeamCard[]>([]);
  const [activeTeam, setActiveTeamState] = useState<StaffTeamCard | null>(null);

  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;

  useEffect(() => {
    let active = true;

    // React Compiler prohíbe setState síncrono en el cuerpo del effect → IIFE.
    (async () => {
      if (!clubId || !membershipId) {
        if (!active) return;
        setTeams([]);
        setActiveTeamState(null);
        setLoading(false);
        return;
      }

      // E5 — try/catch/finally: sin él, si CUALQUIER await de aquí rechazaba (el
      // loader, o las llamadas a secure-store), `setLoading(false)` no corría y este
      // provider quedaba `loading=true` PARA SIEMPRE (spinner eterno en las pantallas
      // que gatean por él). Ahora la carga SIEMPRE resuelve y el error se ve en Sentry
      // (antes se tragaba sin rastro), pasando SOLO el recurso ('staff-teams', sin PII).
      setLoading(true);
      try {
        const list = await getStaffTeamsFromClient(supabase, { membershipId, clubId }, (e) =>
          reportDataError('staff-teams', e),
        );
        if (!active) return;
        setTeams(list);

        const stored = await getStoredStaffTeamId();
        if (!active) return;
        const { active: chosen, staleCookie } = resolveActivePlayer(
          list,
          stored,
          (team) => team.teamId,
        );
        setActiveTeamState(chosen);
        if (chosen) {
          if (!stored || staleCookie) await setStoredStaffTeamId(chosen.teamId);
        } else {
          await clearStoredStaffTeamId();
        }
      } catch (err) {
        if (active) reportDataError('staff-teams', err);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [clubId, membershipId]);

  const setActiveTeam = useCallback(
    async (teamId: string) => {
      const match = teams.find((team) => team.teamId === teamId);
      if (!match) return;
      setActiveTeamState(match);
      await setStoredStaffTeamId(teamId);
    },
    [teams],
  );

  return (
    <ActiveStaffTeamContext.Provider
      value={{ loading, teams, activeTeam, setActiveTeam }}
    >
      {children}
    </ActiveStaffTeamContext.Provider>
  );
}

export function useActiveStaffTeam(): ActiveStaffTeamContextValue {
  const ctx = useContext(ActiveStaffTeamContext);
  if (!ctx) {
    throw new Error(
      'useActiveStaffTeam debe usarse dentro de <ActiveStaffTeamProvider>',
    );
  }
  return ctx;
}
