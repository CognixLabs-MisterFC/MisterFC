import { Text, View } from 'react-native';
import type { Formation, PositionAssignment } from '@misterfc/core';
import { LineupBoard, type DropTargetLite } from './lineup-field';
import { useTranslations } from '@/locale/provider';

/**
 * O2 alineación compartida — vista SOLO LECTURA del campo (titulares colocados +
 * banquillo). Reutiliza el MISMO `LineupBoard` del editor con `editable={false}`
 * (sus gestos Pan quedan deshabilitados por `pan.enabled(editable && !saving)`), así
 * no se duplica el renderizador de campo. La alimenta el llamador:
 *   - convocatoria del jugador → `getSharedLineupForEventFromClient` (estática).
 *   - directo (familia/seguidor) → `detail.fieldPlayers`+`benchPlayers` (en vivo).
 */

export type ReadonlyLineupPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
};

const EMPTY_SAVING: ReadonlySet<string> = new Set();
const NOOP_DROP = (_playerId: string, _target: DropTargetLite): void => {};
const NOOP_HOVER = (_h: { code: string | null; bench: boolean }): void => {};

const ROLE_TO_SHORT: Record<string, string> = {
  GK: 'goalkeeper',
  DF: 'defender',
  MF: 'midfielder',
  FW: 'forward',
};

export function ReadonlyLineup({
  formation,
  formationLabel,
  positions,
  players,
  accent,
}: {
  formation: Formation | undefined;
  formationLabel: string;
  positions: PositionAssignment[];
  players: ReadonlyLineupPlayer[];
  accent: string;
}) {
  const t = useTranslations('');
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const labelOf = (pid: string): string => byId.get(pid)?.label || pid.slice(0, 4);
  const dorsalOf = (pid: string): number | null => byId.get(pid)?.dorsal ?? null;
  const slotLabelOf = (_code: string, role: string): string =>
    t(`alineacion.pos_short.${ROLE_TO_SHORT[role] ?? 'midfielder'}`);

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: accent }}>
          <Text className="text-[11px] font-semibold text-white">{formationLabel}</Text>
        </View>
      </View>
      <LineupBoard
        formation={formation}
        positions={positions}
        labelOf={labelOf}
        dorsalOf={dorsalOf}
        slotLabelOf={slotLabelOf}
        editable={false}
        savingIds={EMPTY_SAVING}
        chipColor={accent}
        benchTitle={t('alineacion.bench')}
        benchEmptyText={t('alineacion.app_bench_empty')}
        onDrop={NOOP_DROP}
        hoverCode={null}
        hoverBench={false}
        onHoverChange={NOOP_HOVER}
      />
    </View>
  );
}
