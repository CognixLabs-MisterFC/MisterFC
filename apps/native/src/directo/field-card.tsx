import { Text, View } from 'react-native';
import { getFormation, type PositionAssignment } from '@misterfc/core';
import { ReadonlyLineup, type ReadonlyLineupPlayer } from '@/ui/readonly-lineup';
import { useTranslations } from '@/locale/provider';

/**
 * EL CAMPO del directo: los once sobre el césped y el banquillo debajo, en solo
 * lectura. Por dentro es el `LineupBoard` del editor de alineación (vía
 * `ReadonlyLineup`), así que no hay un segundo renderizador de campo en la app.
 *
 * Lo pintaban la pantalla de FAMILIA y nadie más: un padre en la grada veía el
 * once y el entrenador que dirigía el partido, no. Esto es ese mismo bloque sacado
 * para que lo usen las dos, con una diferencia que no es de pintura sino de datos:
 *
 *   · familia recibe la alineación OFICIAL (`detail.fieldPlayers`), que es lo que
 *     puede leer y lo que siempre enseñó;
 *   · el cuerpo técnico recibe el ONCE VIVO (`deriveSquad`): quien ocupa cada hueco
 *     AHORA, después de los cambios, sin expulsados ni ausentes.
 *
 * Por eso recibe las listas ya hechas y no el `MatchDetail`: quien lo monta decide
 * qué once está mirando, y el componente no tiene que adivinarlo.
 */

export type FieldCardPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
};

export function DirectoFieldCard({
  title,
  formationCode,
  field,
  bench,
  accent,
}: {
  title: string;
  formationCode: string;
  field: FieldCardPlayer[];
  bench: ReadonlyLineupPlayer[];
  accent: string;
}) {
  const t = useTranslations('');
  const formation = getFormation(formationCode);
  const formationLabel = formation?.label ?? formationCode;

  const positions: PositionAssignment[] = [
    ...field.map((p) => ({
      playerId: p.playerId,
      location: 'field' as const,
      positionCode: p.positionCode,
      xPct: p.xPct,
      yPct: p.yPct,
    })),
    ...bench.map((p) => ({
      playerId: p.playerId,
      location: 'bench' as const,
      positionCode: null,
      xPct: null,
      yPct: null,
    })),
  ];
  const players: ReadonlyLineupPlayer[] = [
    ...field.map((p) => ({ playerId: p.playerId, label: p.label, dorsal: p.dorsal })),
    ...bench,
  ];

  return (
    <View className="rounded-2xl border border-zinc-200 p-4">
      <Text className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </Text>
      {field.length > 0 ? (
        <ReadonlyLineup
          formation={formation}
          formationLabel={formationLabel}
          positions={positions}
          players={players}
          accent={accent}
        />
      ) : (
        <Text className="py-6 text-center text-sm text-zinc-400">{t('directo.no_lineup')}</Text>
      )}
    </View>
  );
}
