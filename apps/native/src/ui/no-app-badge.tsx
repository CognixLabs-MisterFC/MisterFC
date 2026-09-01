import { Text, View } from 'react-native';

/**
 * Marcador "Sin app" (nativo, paridad con web): la familia de este jugador NO ha
 * entrado en la app → NO recibe convocatorias ni avisos. Círculo rojo + texto; el
 * `hint` va en accessibilityLabel porque la etiqueta ya es texto, no un icono.
 * Presentacional: recibe cadenas ya traducidas y lo pinta quien decide pintarlo.
 */
export function NoAppBadge({ label, hint }: { label: string; hint: string }) {
  return (
    <View
      accessibilityLabel={`${label}. ${hint}`}
      className="mt-1 flex-row items-center gap-1.5 self-start rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5"
    >
      <View className="h-1.5 w-1.5 rounded-full bg-red-500" />
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-red-600">
        {label}
      </Text>
    </View>
  );
}
