import { ScrollView, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getTeamTrainingsFromClient,
  getAttendanceStatsFromClient,
  getPlayerTrainingAttendanceForEventsFromClient,
  attendanceStatsWindow,
  type TeamTrainingRow,
  type AttendancePlayerStat,
  type AttendanceCode,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/** Día + hora sin segundos (mismo criterio que el resto de la app: `toLocaleString`). */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Data = {
  /** Todos los entrenos de la temporada (asc); se parten en próximos/histórico. */
  trainings: TeamTrainingRow[];
  /** Resumen de asistencia del jugador (temporada). Reusa el cálculo de F4.8. */
  stat: AttendancePlayerStat | null;
  /** Código de asistencia por evento pasado (histórico), como pares serializables. */
  codes: [string, AttendanceCode][];
};

/**
 * O2 — Entrenamientos del equipo (área familia, SOLO LECTURA). Tres partes:
 *  1) RESUMEN DE LA TEMPORADA — asistencia del jugador (reusa `getAttendanceStats`
 *     con scope de un jugador y ventana de temporada; NO recalcula nada).
 *  2) PRÓXIMOS 5 — los 5 siguientes; se abren al detalle (sesión 📋 si compartida).
 *     SIN asistencia (aún no se han celebrado; la marca el entrenador después).
 *  3) HISTÓRICO — los ya pasados; al abrirlos SÍ se ve la asistencia del jugador.
 * Sustituye a la antigua pantalla de "Asistencia" (integrada aquí como resumen).
 * Fetch en core; caché por (club, equipo, jugador).
 */
export function EntrenamientosScreen({
  teamId,
  teamName,
}: {
  teamId: string | null;
  teamName: string | null;
}) {
  const t = useTranslations('');
  const { activeClub, theme } = useApp();
  const { activePlayer } = useActivePlayer();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const playerId = activePlayer?.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<Data>(
    `entrenamientos.${clubId ?? 'none'}.${teamId ?? 'none'}.${playerId ?? 'none'}`,
    async (sb) => {
      if (!clubId || !teamId) return { trainings: [], stat: null, codes: [] };
      const now = new Date();
      const { startIso, endIso } = attendanceStatsWindow('season', now);
      // Desde el inicio de temporada para tener también el histórico; el límite
      // cubre una temporada completa de entrenos (varios por semana).
      const trainings = await getTeamTrainingsFromClient(
        sb,
        clubId,
        [{ id: teamId, name: teamName ?? '' }],
        startIso.slice(0, 10),
        200,
      );
      const nowIso = now.toISOString();
      const pastIds = trainings
        .filter((tr) => tr.starts_at < nowIso)
        .map((tr) => tr.event_id);

      let stat: AttendancePlayerStat | null = null;
      let codes: [string, AttendanceCode][] = [];
      if (playerId) {
        const stats = await getAttendanceStatsFromClient(sb, {
          clubId,
          scope: { kind: 'player', playerIds: [playerId] },
          startIso,
          endIso,
          teamId,
        });
        stat = stats.byPlayer[0] ?? null;
        const codeMap = await getPlayerTrainingAttendanceForEventsFromClient(
          sb,
          playerId,
          pastIds,
        );
        codes = Array.from(codeMap.entries());
      }
      return { trainings, stat, codes };
    },
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.no_team')} />;
  if (loading) return <LoadingScreen />;

  const d = data ?? { trainings: [], stat: null, codes: [] };
  const codeByEvent = new Map(d.codes);
  const nowIso = new Date().toISOString();
  const upcoming = d.trainings
    .filter((tr) => tr.starts_at >= nowIso)
    .slice(0, 5);
  const history = d.trainings
    .filter((tr) => tr.starts_at < nowIso)
    .reverse(); // más recientes primero

  const openTraining = (r: TeamTrainingRow, past: boolean) => {
    const code = past ? (codeByEvent.get(r.event_id) ?? null) : null;
    const extra = past
      ? { past: '1', ...(code ? { attendanceCode: code } : {}) }
      : {};
    if (r.session_id) {
      router.push({
        pathname: '/family/sesion',
        params: { sessionId: r.session_id, ...extra },
      });
    } else {
      router.push({
        pathname: '/family/entrenamiento',
        params: {
          title: r.title ?? '',
          startsAt: r.starts_at,
          locationName: r.location_name ?? '',
          ...extra,
        },
      });
    }
  };

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('entrenamientos.title')}</Text>
        {teamName ? <Text className="-mt-1 text-xs text-zinc-400">{teamName}</Text> : null}

        {/* 1 · RESUMEN DE LA TEMPORADA — reusa el cálculo de asistencia (F4.8). */}
        <Text className="pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('entrenamientos.section_summary')}
        </Text>
        {!d.stat || d.stat.total === 0 ? (
          <EmptyState message={t('asistencia.empty')} />
        ) : (
          <>
            <View className="items-center rounded-2xl border border-zinc-200 p-4">
              <Text className="text-4xl font-bold" style={{ color: accent }}>
                {Math.round(d.stat.pct_present)}%
              </Text>
              <Text className="mt-1 text-xs text-zinc-400">{t('asistencia.pct_present')}</Text>
              <Text className="mt-1 text-xs text-zinc-400">
                {t('asistencia.total', { n: String(d.stat.total) })}
              </Text>
            </View>
            <View className="rounded-2xl border border-zinc-200 p-4">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t('asistencia.breakdown')}
              </Text>
              <StatLine label={t('asistencia.codes.presente')} value={d.stat.present} color="#16a34a" />
              <StatLine label={t('asistencia.justified')} value={d.stat.justified} color="#d97706" />
              <StatLine label={t('asistencia.codes.entreno_diferenciado')} value={d.stat.partial} color="#0284c7" />
              <StatLine label={t('asistencia.codes.ausente')} value={d.stat.unjustified} color="#dc2626" />
            </View>
          </>
        )}

        {/* 2 · PRÓXIMOS 5 — sin asistencia (aún no celebrados). */}
        <Text className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('entrenamientos.section_upcoming')}
        </Text>
        {upcoming.length === 0 ? (
          <EmptyState message={t('entrenamientos.empty')} />
        ) : (
          upcoming.map((r) => (
            <TrainingRow
              key={r.event_id}
              row={r}
              onPress={() => openTraining(r, false)}
              sessionBadge={t('entrenamientos.session_badge')}
              untitled={t('entrenamientos.untitled')}
            />
          ))
        )}

        {/* 3 · HISTÓRICO DE LA TEMPORADA — con la asistencia del jugador. */}
        <Text className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {t('entrenamientos.section_history')}
        </Text>
        {history.length === 0 ? (
          <EmptyState message={t('entrenamientos.empty_history')} />
        ) : (
          history.map((r) => {
            const code = codeByEvent.get(r.event_id) ?? null;
            return (
              <TrainingRow
                key={r.event_id}
                row={r}
                onPress={() => openTraining(r, true)}
                sessionBadge={t('entrenamientos.session_badge')}
                untitled={t('entrenamientos.untitled')}
                attendance={code ? t(`asistencia.codes.${code}`) : null}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function TrainingRow({
  row,
  onPress,
  sessionBadge,
  untitled,
  attendance,
}: {
  row: TeamTrainingRow;
  onPress: () => void;
  sessionBadge: string;
  untitled: string;
  attendance?: string | null;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-xl border border-zinc-200 px-3 py-3 active:opacity-70"
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
          {row.title || untitled}
        </Text>
        {row.session_id ? (
          <View className="rounded-full bg-emerald-50 px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-emerald-700">📋 {sessionBadge}</Text>
          </View>
        ) : null}
      </View>
      <View className="mt-0.5 flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-xs text-zinc-400" numberOfLines={1}>
          {[formatDateTime(row.starts_at), row.location_name].filter(Boolean).join(' · ')}
        </Text>
        {attendance ? (
          <View className="rounded-full bg-zinc-100 px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-zinc-600">{attendance}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function StatLine({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-zinc-100 py-2">
      <View className="flex-row items-center gap-2">
        <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <Text className="text-sm text-[#0F1B2E]">{label}</Text>
      </View>
      <Text className="text-sm font-semibold text-[#0F1B2E]">{value}</Text>
    </View>
  );
}
