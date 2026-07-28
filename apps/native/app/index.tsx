import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
// Import REAL de un módulo de dominio de @misterfc/core (no placeholder):
// demuestra que la lógica compartida compila y se resuelve desde apps/native.
import { ALL_CLUB_ROLES } from '@misterfc/core';

/**
 * O2-0 — pantalla mínima de arranque. NO es una pantalla de producto: solo
 * confirma que la app inicia, que expo-router enruta, que NativeWind aplica
 * estilos y que `@misterfc/core` se resuelve.
 */
export default function Index() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center gap-2 px-6">
        <Text className="text-3xl font-bold text-[#0F1B2E]">MisterFC</Text>
        <Text className="text-base text-zinc-500">Ola 2 · la app arranca (O2-0)</Text>
        <Text className="text-xs text-zinc-400">
          {ALL_CLUB_ROLES.length} roles de club leídos desde @misterfc/core
        </Text>
      </View>
    </SafeAreaView>
  );
}
