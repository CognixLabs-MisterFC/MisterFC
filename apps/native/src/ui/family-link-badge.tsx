import { Text, View } from 'react-native';
import type { FamilyLinkStatus } from '@misterfc/core';

/**
 * Slice A — Marcador de jugador SIN familia vinculada (nativo, paridad con web).
 *  - `invited`   → "Invitación pendiente".
 *  - `uninvited` → "Sin invitar".
 * `linked` no pinta nada. Ambos significan lo mismo: NO recibe convocatorias ni
 * avisos (el `hint` va en accessibilityLabel; la etiqueta ya es texto, no icono).
 * Presentacional: recibe cadenas ya traducidas.
 */
export function FamilyLinkBadge({
  status,
  labels,
}: {
  status: FamilyLinkStatus;
  labels: { invited: string; uninvited: string; hint: string };
}) {
  if (status === 'linked') return null;
  const label = status === 'invited' ? labels.invited : labels.uninvited;
  return (
    <View
      accessibilityLabel={`${label}. ${labels.hint}`}
      className="mt-1 flex-row items-center self-start rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5"
    >
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
        {label}
      </Text>
    </View>
  );
}
