import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  getTeamRosterStatsFromClient,
  teamScopedCacheKey,
  type RosterStatRow,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState } from '@/ui/feedback';
import { useTranslations } from '@/locale/provider';

/**
 * O2-5 D1 — Plantilla: roster del equipo con stats por compañero (SOLO LECTURA).
 * Fetch + agregación en core (`getTeamRosterStatsFromClient` → `aggregateTeamStats`).
 * Caché team-scoped. `teamId` llega por navegación desde Mi equipo.
 *
 * ABRIR LA FICHA ES UNA CAPACIDAD QUE TRAE QUIEN LLAMA, no algo que decida esta
 * pantalla. La usan dos áreas y solo una puede:
 *
 *   · DIRECCIÓN la reutiliza para la plantilla de un equipo, y ahí tocar a un
 *     jugador tiene que abrir su ficha club-wide. No lo hacía: la pantalla no
 *     navegaba a ninguna parte, así que los nombres no eran pulsables y parecía
 *     que la ficha «no se abría».
 *   · FAMILIA ve aquí a los COMPAÑEROS de su hijo. Abrirles la ficha sería
 *     enseñarle a un padre los datos del hijo de otro.
 *
 * Por eso no hay un `area` que la pantalla interprete: hay un callback que
 * dirección pasa y familia no. Si mañana alguien la monta en un tercer sitio, la
 * ficha sigue cerrada hasta que lo decida a propósito, que es la dirección en la
 * que conviene equivocarse.
 */
export function PlantillaScreen({
  teamId,
  teamName,
  onOpenPlayer,
}: {
  teamId: string | null;
  teamName: string | null;
  /** Ausente = los nombres NO son pulsables. Ver la nota de arriba. */
  onOpenPlayer?: (playerId: string, playerName: string) => void;
}) {
  const t = useTranslations('');
  const { activeClub } = useApp();
  const clubId = activeClub?.club.id ?? null;

  const { data, fromCache, loading } = useCached<RosterStatRow[]>(
    teamScopedCacheKey('plantilla', clubId ?? 'none', teamId ?? 'none'),
    (sb) => (teamId ? getTeamRosterStatsFromClient(sb, teamId) : Promise.resolve([])),
  );

  if (!teamId) return <EmptyState message={t('mi_equipo.no_team')} />;
  if (loading) return <LoadingScreen />;
  const rows = data ?? [];

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
        <Text className="text-xl font-bold text-[#0F1B2E]">{t('mi_equipo.nav_plantilla')}</Text>
        {teamName ? <Text className="mb-1 text-xs text-zinc-400">{teamName}</Text> : null}
        {rows.length === 0 ? (
          <EmptyState message={t('mi_equipo.plantilla_empty')} />
        ) : (
          rows.map((r) => {
            const nombre = [r.first_name, r.last_name].filter(Boolean).join(' ');
            const contenido = (
              <>
                <View className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100">
                  <Text className="text-xs font-semibold text-zinc-600">{r.dorsal ?? '—'}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-[#0F1B2E]" numberOfLines={1}>
                    {nombre}
                  </Text>
                  <Text className="text-[11px] text-zinc-400">
                    {[
                      r.position ? t(`jugadores.positions.${r.position}`) : null,
                      `${r.stats.matches} ${t('ficha.matches_short')}`,
                      `${r.stats.goals} ${t('ficha.goals_short')}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </>
            );
            const clase = 'flex-row items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2';
            // Sin `onOpenPlayer` la fila es exactamente la de antes: una `View`, sin
            // rol de botón ni respuesta al toque. Un `Pressable` sin acción daría
            // realce al pulsar y prometería algo que no pasa.
            return onOpenPlayer ? (
              <Pressable
                key={r.player_id}
                accessibilityRole="button"
                accessibilityLabel={nombre}
                onPress={() => onOpenPlayer(r.player_id, nombre)}
                className={`${clase} active:opacity-70`}
              >
                {contenido}
              </Pressable>
            ) : (
              <View key={r.player_id} className={clase}>
                {contenido}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
