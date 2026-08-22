import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  clubScopedCacheKey,
  getStaffCallupsFromClient,
  type CallupMatchRow,
  type Role,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useSession } from '@/auth/session';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-7b-1 — Convocatorias del staff (ARMAR): partidos próximos del scope del user
 * (todos sus equipos), cada fila con equipo, fecha, rival y resumen de respuestas de
 * familias (sí/quizá/no) + convocados/roster. SOLO LECTURA aquí; el detalle
 * (?eventId) permite marcar convocados y ver respuestas. El EQUIPO lo fija la
 * convocatoria elegida, así que NO hace falta selector de equipo. Fetch en core
 * (`getStaffCallupsFromClient`). Caché club-scoped (id en la key).
 *
 * D1b-2 — REUTILIZADA por DIRECCIÓN dentro del detalle de un equipo. El loader ya
 * devuelve `kind:'all'` (club-wide) para el director; los dos props opcionales
 * (con DEFAULTS que reproducen el comportamiento de staff) permiten:
 *  · `teamId` — acota la lista al equipo del hub (filtro en cliente sobre el mismo
 *    fetch club-wide; sin él, no filtra → staff ve todos sus equipos como hoy).
 *  · `detailPathname` — destino de cada fila; por defecto `/staff/convocatoria`,
 *    en dirección `/direction/convocatoria`.
 */
export function ConvocatoriasStaffListScreen({
  teamId,
  detailPathname = '/staff/convocatoria',
}: {
  teamId?: string | null;
  detailPathname?: string;
} = {}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const { user } = useSession();
  const router = useRouter();
  const clubId = activeClub?.club.id ?? null;
  const role = (activeClub?.role ?? null) as Role | null;
  const userId = user?.id ?? null;

  const { data, fromCache, loading } = useCached<CallupMatchRow[]>(
    clubScopedCacheKey('convocatorias-staff', clubId ?? 'none'),
    (sb) =>
      clubId && role
        ? getStaffCallupsFromClient(sb, { clubId, role, userId, rangeDays: 30 })
        : Promise.resolve([]),
  );

  if (loading) return <LoadingScreen />;
  // D1b-2 — dentro de un equipo (dirección) se acota al teamId; sin teamId (staff) no
  // filtra. Sobre el mismo fetch club-wide, así que una sola lectura sirve a ambos.
  const rows = (data ?? []).filter((m) => teamId == null || m.team_id === teamId);

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <Text className="px-4 pb-2 pt-4 text-xl font-semibold text-[#0F1B2E]">
        {t('convocatorias_staff.title')}
      </Text>
      {rows.length === 0 ? (
        <EmptyState message={t('convocatorias_staff.list_empty')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(m) => m.event_id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: detailPathname,
                  params: { eventId: item.event_id },
                })
              }
              className="mx-4 my-1 rounded-xl border border-zinc-200 px-4 py-3 active:opacity-70"
            >
              <View className="flex-row items-center gap-2">
                <View
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: item.team_color }}
                />
                <Text
                  className="flex-1 text-sm font-semibold text-[#0F1B2E]"
                  numberOfLines={1}
                >
                  {item.title}
                  {item.opponent_name ? ` · ${item.opponent_name}` : ''}
                </Text>
                {item.published ? (
                  <View className="rounded-full bg-emerald-100 px-2 py-0.5">
                    <Text className="text-[10px] font-semibold text-emerald-700">
                      {t('convocatorias_staff.published')}
                    </Text>
                  </View>
                ) : (
                  <View className="rounded-full border border-zinc-200 px-2 py-0.5">
                    <Text className="text-[10px] text-zinc-500">
                      {t('convocatorias_staff.draft')}
                    </Text>
                  </View>
                )}
              </View>
              <Text className="mt-1 text-xs text-zinc-400" numberOfLines={1}>
                {[
                  new Date(item.starts_at).toLocaleString(),
                  item.team_name,
                  item.category_name,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <View className="mt-2 flex-row items-center gap-3">
                <Text className="text-[11px] text-zinc-500">
                  {t('convocatorias_staff.responses_summary', {
                    yes: String(item.responses_count.yes),
                    maybe: String(item.responses_count.maybe),
                    no: String(item.responses_count.no),
                  })}
                </Text>
                <Text className="text-[11px] font-semibold text-[#0F1B2E]">
                  {t('convocatorias_staff.called_summary', {
                    called: String(item.decisions_count.called_up),
                    total: String(item.roster_count),
                  })}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
