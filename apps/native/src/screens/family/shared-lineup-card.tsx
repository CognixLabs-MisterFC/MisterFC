import { View, Text } from 'react-native';
import {
  coachFormationToFormation,
  getFormation,
  type Formation,
  type SharedLineupView,
} from '@misterfc/core';
import { ReadonlyLineup } from '@/ui/readonly-lineup';
import { useTranslations } from '@/locale/provider';

/**
 * O2 alineación compartida — tarjeta PRESENTACIONAL de la alineación oficial
 * compartida (campo con titulares + banquillo). El fetch (event-scoped, común a
 * ambos hijos) y la decisión de MOSTRARLA viven en el llamador:
 *  · J6 (alineación compartida) → la convocatoria la pinta SOLO si hay titulares
 *    colocados en el campo, junto a la lista de no convocados.
 *  · J5 (sin alineación compartida) → NO se monta; en su lugar se muestran las
 *    listas de convocados + no convocados. Así se evita la "media tarjeta" vacía
 *    (campo sin titulares + banquillo) que se pintaba antes cuando existía una
 *    alineación oficial sin colocar.
 * Las notas tácticas nunca se piden (solo-staff).
 */
export function SharedLineupCard({
  data,
  accent,
}: {
  data: SharedLineupView;
  accent: string;
}) {
  const t = useTranslations('');

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
