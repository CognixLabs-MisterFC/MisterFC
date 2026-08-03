import { ScrollView, Text, View } from 'react-native';
import {
  coachFormationToFormation,
  eventScopedCacheKey,
  formatPlayerNameNatural,
  getFormation,
  getLineupForEventFromClient,
  type Formation,
  type LineupView,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { OfflineBanner, LoadingScreen, EmptyState, ScreenTitle } from '@/ui/feedback';
import { LineupField } from '@/ui/lineup-field';
import { t } from '@/i18n';
import { BRAND } from '@/theme';

/**
 * O2-8a — Alineación del partido (staff), SOLO PINTAR (sin drag ni escritura). Lee la
 * alineación seleccionada (core `getLineupForEventFromClient`, read-only) y la pinta:
 * titulares en sus slots sobre el campo SVG + banquillo. Reutiliza el modelo de core
 * (`getFormation`/`coachFormationToFormation`) y la técnica de campo de D2. El drag,
 * el selector de formación (que escribe) y el guardado son 8b: aquí la formación solo
 * se MUESTRA. Gate de lectura = RLS (staff del equipo). Caché event-scoped
 * (`alineacion::${eventId}`), lectura offline como el resto.
 */

const ROLE_TO_SHORT: Record<string, string> = {
  GK: 'goalkeeper',
  DF: 'defender',
  MF: 'midfielder',
  FW: 'forward',
};

export function AlineacionScreen({ eventId }: { eventId: string | null }) {
  const { activeClub, theme } = useApp();
  const clubId = activeClub?.club.id ?? null;
  const accent = theme?.color ?? BRAND.navy;

  const { data, fromCache, loading } = useCached<LineupView | null>(
    eventScopedCacheKey('alineacion', eventId ?? 'none'),
    async (sb) => {
      if (!eventId || !clubId) return null;
      return getLineupForEventFromClient(sb, { clubId, eventId });
    },
  );

  if (!eventId) return <EmptyState message={t('alineacion.pick_match')} />;
  if (loading) return <LoadingScreen />;
  if (!data) return <EmptyState message={t('alineacion.unavailable')} />;

  const rosterById = new Map(data.roster.map((r) => [r.playerId, r]));
  const labelOf = (pid: string): string => {
    const r = rosterById.get(pid);
    return r ? formatPlayerNameNatural(r.firstName, r.lastName) || pid.slice(0, 4) : pid.slice(0, 4);
  };
  const dorsalOf = (pid: string): number | null => rosterById.get(pid)?.dorsal ?? null;
  const slotLabelOf = (_code: string, role: string): string =>
    t(`alineacion.pos_short.${ROLE_TO_SHORT[role] ?? 'midfielder'}`);

  // Resolver la formación (catálogo o plantilla del coach) — igual que la web.
  const formation: Formation | undefined = data.formationCode
    ? (getFormation(data.formationCode) ??
      (data.coachFormation ? coachFormationToFormation(data.coachFormation) : undefined))
    : undefined;
  const formationLabel =
    (data.formationCode && getFormation(data.formationCode)?.label) ??
    data.coachFormation?.name ??
    data.formationCode ??
    '—';

  const bench = data.positions.filter((p) => p.location === 'bench');
  const e = data.event;

  return (
    <View className="flex-1 bg-white">
      <OfflineBanner show={fromCache} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <ScreenTitle>{t('alineacion.title')}</ScreenTitle>

        {/* Cabecera del partido + formación (solo lectura en 8a). */}
        <View className="rounded-2xl border border-zinc-200 p-4">
          <View className="flex-row items-center gap-2">
            <View className="h-4 w-4 rounded-full" style={{ backgroundColor: e.teamColor }} />
            <Text className="flex-1 text-base font-bold text-[#0F1B2E]" numberOfLines={1}>
              {e.title}
              {e.opponentName ? ` · ${e.opponentName}` : ''}
            </Text>
          </View>
          <Text className="mt-1 text-xs text-zinc-400" numberOfLines={1}>
            {[new Date(e.startsAt).toLocaleString(), e.teamName, e.categoryName]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View className="mt-2 flex-row items-center gap-2">
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: accent }}>
              <Text className="text-[11px] font-semibold text-white">{formationLabel}</Text>
            </View>
            {data.lineupName ? (
              <Text className="text-xs text-zinc-500" numberOfLines={1}>
                {data.lineupName}
                {data.isOfficial ? ` · ${t('alineacion.official')}` : ''}
              </Text>
            ) : null}
          </View>
        </View>

        {data.lineupId == null ? (
          <View className="rounded-2xl border border-zinc-200 p-4">
            <Text className="text-sm text-zinc-500">{t('alineacion.none_yet')}</Text>
          </View>
        ) : (
          <>
            <LineupField
              formation={formation}
              positions={data.positions}
              labelOf={labelOf}
              dorsalOf={dorsalOf}
              slotLabelOf={slotLabelOf}
            />

            {/* Banquillo. */}
            <View className="rounded-2xl border border-zinc-200 p-4">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t('alineacion.bench')} · {bench.length}
              </Text>
              {bench.length === 0 ? (
                <Text className="text-sm text-zinc-500">{t('alineacion.bench_empty')}</Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {bench.map((p) => (
                    <View
                      key={p.playerId}
                      className="flex-row items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-1"
                    >
                      <View className="h-5 w-5 items-center justify-center rounded-full bg-zinc-100">
                        <Text className="text-[10px] font-semibold text-zinc-600">
                          {dorsalOf(p.playerId) ?? '·'}
                        </Text>
                      </View>
                      <Text className="text-xs text-[#0F1B2E]" numberOfLines={1}>
                        {labelOf(p.playerId)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Nota: en 8a la alineación es de solo lectura; editar (drag + formación)
                llega en 8b. */}
            <Text className="text-center text-[11px] text-zinc-400">
              {t('alineacion.readonly_hint')}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}
