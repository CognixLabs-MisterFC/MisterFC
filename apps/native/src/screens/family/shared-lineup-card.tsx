import { View, Text } from 'react-native';
import {
  coachFormationToFormation,
  eventScopedCacheKey,
  getFormation,
  getSharedLineupForEventFromClient,
  type Formation,
  type SharedLineupView,
} from '@misterfc/core';
import { useApp } from '@/auth/context';
import { useCached } from '@/data/use-cached';
import { ReadonlyLineup } from '@/ui/readonly-lineup';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2 alineación compartida — tarjeta de la ALINEACIÓN OFICIAL COMPARTIDA en el
 * detalle de convocatoria del jugador/familia. ESTÁTICA (no varía como el directo):
 * lee `getSharedLineupForEventFromClient` (la RLS solo la devuelve si es
 * `is_official AND visibility='team'`). Si NO hay alineación visible, NO pinta nada
 * (ni mensaje de vacío) — así el detalle no muestra un hueco cuando el entrenador aún
 * no ha compartido. Las notas tácticas nunca se piden (solo-staff). Caché
 * event-scoped (`shared-lineup.<eventId>`): la misma alineación para todos los hijos.
 */
export function SharedLineupCard({ eventId }: { eventId: string }) {
  const t = useTranslations('');
  const { theme } = useApp();
  const accent = theme?.color ?? BRAND.navy;

  const { data } = useCached<SharedLineupView | null>(
    eventScopedCacheKey('shared-lineup', eventId),
    async (sb) => getSharedLineupForEventFromClient(sb, eventId),
  );

  if (!data) return null;

  const formation: Formation | undefined = data.formationCode
    ? (getFormation(data.formationCode) ??
      (data.coachFormation ? coachFormationToFormation(data.coachFormation) : undefined))
    : undefined;
  const formationLabel =
    (data.formationCode && getFormation(data.formationCode)?.label) ??
    data.coachFormation?.name ??
    data.formationCode ??
    '—';

  return (
    <View className="gap-3 rounded-2xl border border-zinc-200 p-4">
      <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {t('alineacion.official_lineup_title')}
      </Text>
      <ReadonlyLineup
        formation={formation}
        formationLabel={formationLabel}
        positions={data.positions}
        players={data.players}
        accent={accent}
      />
    </View>
  );
}
