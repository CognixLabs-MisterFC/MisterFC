import { Pressable, Text, View } from 'react-native';

/**
 * O2-10a — piezas de UI compartidas del hub de cuerpo técnico (lecturas). Solo
 * presentación; sin lógica de datos.
 */

/** Tarjeta pulsable de una fila de lista (equipo, sesión, evento). */
export function ListCard({
  accent,
  onPress,
  children,
}: {
  accent: string;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className="rounded-2xl border border-zinc-200 p-4 active:opacity-70"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      {children}
    </Pressable>
  );
}

/** Tile de navegación (rejilla del inicio / detalle de equipo). */
export function Tile({
  icon,
  label,
  accent,
  onPress,
}: {
  icon: string;
  label: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-w-[46%] flex-1 flex-row items-center gap-2 rounded-2xl border border-zinc-200 p-4 active:opacity-70"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <Text className="text-lg">{icon}</Text>
      <Text className="flex-1 text-sm font-semibold text-[#0F1B2E]" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Contador destacado (bloque de tareas del inicio). */
export function CountBadge({ count, accent }: { count: number; accent: string }) {
  return (
    <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: `${accent}1a` }}>
      <Text className="text-xs font-bold tabular-nums" style={{ color: accent }}>
        {count}
      </Text>
    </View>
  );
}

/** Badge de rol del staff. */
export function RoleChip({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-zinc-100 px-2 py-0.5">
      <Text className="text-[10px] font-semibold text-zinc-500">{label}</Text>
    </View>
  );
}
