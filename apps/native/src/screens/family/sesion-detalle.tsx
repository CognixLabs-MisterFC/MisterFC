import {
  getSessionForEditFromClient,
  getSessionExerciseMetaFromClient,
  eventScopedCacheKey,
  type SessionForEdit,
  type SessionExerciseMeta,
} from '@misterfc/core';
import { ScrollView, Text, View } from 'react-native';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

type SessionView = {
  session: SessionForEdit;
  exMeta: [string, SessionExerciseMeta][];
};

/**
 * O2-5 D1 — Detalle de LECTURA de una sesión publicada (familia): cabecera
 * (objetivos, fecha, tiempo), bloques y tareas con su duración/series. El nombre
 * del ejercicio sale del RPC `session_exercise_meta` (la familia no lee `exercises`).
 * El fetch vive en core; defensa: si no es team-visible o es plantilla → vacío. Las
 * jugadas del bloque se listan sin visor (el visor animado es D2). Caché por sesión.
 *
 * O2 — Cuando se abre desde el HISTÓRICO de Entrenamientos (`past`), muestra arriba
 * la asistencia del jugador a ese entrenamiento (`attendanceCode`, o "sin registro").
 * Los próximos NO pasan `past` (aún no celebrados) → la sesión se ve tal cual.
 */
export function SesionDetalleScreen({
  sessionId,
  past = false,
  attendanceCode = null,
  allowUnshared = false,
}: {
  sessionId: string | null;
  past?: boolean;
  attendanceCode?: string | null;
  /**
   * D1b-3 — DIRECCIÓN (solo consulta): el director ve TODAS las sesiones asignadas a
   * un entrenamiento del equipo, compartidas con las familias o NO. Con este flag se
   * relaja SOLO el filtro `visibility==='team'`; el bloqueo de `is_template` (las
   * plantillas de biblioteca no cuelgan de ningún entrenamiento) se MANTIENE. La RLS
   * `sessions_select` ya deja al director leer sesiones no compartidas (rama admin/
   * director). DEFAULT `false` → familia IDÉNTICA: solo sesiones team-visible.
   */
  allowUnshared?: boolean;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<SessionView | null>(
    // D1b-3 — la variante de dirección (allowUnshared) puede cachear sesiones NO
    // compartidas; usa un NAMESPACE propio (`sesion-dir`) para no contaminar la caché
    // de familia (`sesion`, no profile-scoped): así una sesión no compartida jamás se
    // pinta en familia por SWR. Familia mantiene su key exacta → comportamiento igual.
    eventScopedCacheKey(allowUnshared ? 'sesion-dir' : 'sesion', sessionId ?? 'none'),
    async (sb) => {
      if (!clubId || !sessionId) return null;
      const session = await getSessionForEditFromClient(sb, clubId, sessionId);
      // is_template SIEMPRE fuera (biblioteca). visibility solo se exige cuando NO se
      // permiten no compartidas (familia); dirección (allowUnshared) las ve todas.
      if (
        !session ||
        session.is_template ||
        (!allowUnshared && session.visibility !== 'team')
      )
        return null;
      const metaMap = await getSessionExerciseMetaFromClient(sb, sessionId);
      return { session, exMeta: Array.from(metaMap.entries()) };
    },
  );

  if (!sessionId) return <EmptyState message={t('mi_equipo.session.untitled')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('mi_equipo.session_unavailable')} />;

  const { session } = data;
  const meta = new Map(data.exMeta);

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {/* Asistencia del jugador (solo al abrir desde el histórico). */}
        {past ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t('entrenamientos.attendance_label')}
            </Text>
            <Text className="text-sm font-medium text-[#0F1B2E]">
              {attendanceCode
                ? t(`asistencia.codes.${attendanceCode}`)
                : t('entrenamientos.attendance_none')}
            </Text>
          </View>
        ) : null}

        {/* Cabecera */}
        <View>
          <Text className="text-xl font-bold text-[#0F1B2E]">
            {session.title ?? t('mi_equipo.session.untitled')}
          </Text>
          <Text className="text-xs text-zinc-400">
            {[
              session.session_date
                ? new Date(`${session.session_date}T00:00:00`).toLocaleDateString()
                : null,
              session.total_minutes != null
                ? t('mi_equipo.session.minutes', { count: String(session.total_minutes) })
                : null,
            ].filter(Boolean).join(' · ')}
          </Text>
          {session.objective_physical ? (
            <Text className="mt-2 text-sm text-zinc-600">{session.objective_physical}</Text>
          ) : null}
        </View>

        {/* Bloques */}
        {session.blocks.map((block) => (
          <View key={block.id} className="rounded-2xl border border-zinc-200 p-4">
            <Text className="mb-2 text-sm font-semibold text-[#0F1B2E]">
              {block.title ?? block.block_type}
            </Text>
            {block.tasks.length === 0 ? (
              <Text className="text-sm text-zinc-500">{t('mi_equipo.session_no_tasks')}</Text>
            ) : (
              block.tasks.map((task) => {
                const m = meta.get(task.exercise_id);
                const name = m?.name || task.exercise_name || t('mi_equipo.session.exercise_fallback');
                return (
                  <View key={task.id} className="border-b border-zinc-100 py-2">
                    <Text className="text-sm font-medium text-[#0F1B2E]">{name}</Text>
                    <Text className="text-xs text-zinc-400">
                      {[
                        task.duration_min != null
                          ? t('mi_equipo.session.minutes', { count: String(task.duration_min) })
                          : null,
                        task.series,
                        task.notes,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                );
              })
            )}

            {/* Jugadas a entrenar (visor = D2): se listan sin reproducir. */}
            {block.plays.length > 0 ? (
              <View className="mt-3 border-t border-zinc-100 pt-3">
                <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {t('mi_equipo.session.plays_heading')}
                </Text>
                {block.plays.map((play) => (
                  <View key={play.id} className="flex-row items-center justify-between py-1">
                    <Text className="flex-1 text-sm text-[#0F1B2E]" numberOfLines={1}>
                      {play.play_name || t('mi_equipo.cards.playbook.untitled')}
                    </Text>
                    <Text className="text-[11px] text-zinc-400">
                      {t('mi_equipo.frames', { count: String(play.frame_count) })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
