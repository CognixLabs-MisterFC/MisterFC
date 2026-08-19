import { ScrollView, Text, View } from 'react-native';
import {
  getStaffTeamsFromClient,
  getTeamTrainingsFromClient,
  getSharedSessionsForTeamsFromClient,
  clubScopedCacheKey,
  type TeamTrainingRow,
  type PlayerSharedSessionRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';
import { ListCard } from './hub-parts';

/**
 * O2 Bloque H — "Entrenamiento de hoy" (acceso desde la rejilla del inicio del
 * staff, ya no del menú). Muestra los entrenamientos (type='training') de HOY de
 * los equipos del staff y, si la tienen, su sesión compartida. Si no hay ninguno
 * hoy → "hoy no hay entrenamiento". SOLO LECTURA (crear/editar sesiones es
 * web-only). Multi-equipo: lista los de todos sus equipos, etiquetados por equipo.
 * Resuelve equipos con `getStaffTeamsFromClient`; caché club-scoped.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => localDay(new Date());
/** ¿El instante ISO cae HOY (día local del dispositivo)? */
const isToday = (iso: string) => localDay(new Date(iso)) === todayIso();
/** Hora local HH:MM del entrenamiento. */
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

type Data = {
  trainings: TeamTrainingRow[];
  /** Sesiones compartidas de hoy indexables por id (para enriquecer con título/min). */
  sessions: [string, PlayerSharedSessionRow][];
};

export function SesionDelDiaScreen() {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const membershipId = activeClub?.membershipId ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<Data>(
    clubScopedCacheKey('staff-today-training', clubId ?? 'none'),
    async (sb) => {
      if (!clubId || !membershipId) return { trainings: [], sessions: [] };
      const teams = await getStaffTeamsFromClient(sb, { membershipId, clubId });
      if (teams.length === 0) return { trainings: [], sessions: [] };
      const teamList = teams.map((tm) => ({ id: tm.teamId, name: tm.name }));
      const from = todayIso();
      const [allTrainings, allSessions] = await Promise.all([
        getTeamTrainingsFromClient(sb, clubId, teamList, from, 50),
        getSharedSessionsForTeamsFromClient(sb, clubId, teamList, from, 50),
      ]);
      const trainings = allTrainings.filter((tr) => isToday(tr.starts_at));
      const sessions = allSessions
        .filter((s) => s.session_date === from)
        .map((s) => [s.id, s] as [string, PlayerSharedSessionRow]);
      return { trainings, sessions };
    },
  );

  if (loading) return <LoadingScreen />;
  const d = data ?? { trainings: [], sessions: [] };
  const sessionById = new Map(d.sessions);

  if (d.trainings.length === 0) return <EmptyState message={t('sesion_dia.empty')} />;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <ScreenTitle>{t('sesion_dia.title')}</ScreenTitle>
        {d.trainings.map((tr) => {
          const session = tr.session_id ? sessionById.get(tr.session_id) ?? null : null;
          return (
            <ListCard key={tr.event_id} accent={accent}>
              {/* Entrenamiento. */}
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={1}>
                  {tr.title || t('sesion_dia.untitled')}
                </Text>
                <Text className="text-xs text-zinc-400 tabular-nums">{hhmm(tr.starts_at)}</Text>
              </View>
              <Text className="mt-0.5 text-xs text-zinc-400" numberOfLines={1}>
                {[tr.team_name, tr.location_name].filter(Boolean).join(' · ')}
              </Text>

              {/* Su sesión (si está compartida). */}
              {tr.session_id ? (
                <View className="mt-2 flex-row items-center gap-2 border-t border-zinc-100 pt-2">
                  <Text className="text-[11px]">📋</Text>
                  <Text className="flex-1 text-xs font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {session?.title ?? t('sesion_dia.untitled')}
                  </Text>
                  {session?.total_minutes != null ? (
                    <Text className="text-xs text-zinc-400 tabular-nums">{session.total_minutes}′</Text>
                  ) : null}
                </View>
              ) : (
                <Text className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-400">
                  {t('sesion_dia.no_shared_session')}
                </Text>
              )}
            </ListCard>
          );
        })}
      </ScrollView>
    </View>
  );
}
