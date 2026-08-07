import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * O2-5 B1 — Piezas de estado compartidas por las pantallas de familia: banner
 * "sin conexión" (cuando los datos vienen de caché), spinner centrado y estado
 * vacío. Coherentes con la carcasa (colores de marca).
 */

export function OfflineBanner({ show }: { show: boolean }) {
  const t = useTranslations('shell');
  if (!show) return null;
  return (
    <View className="bg-amber-100 px-4 py-2">
      <Text className="text-center text-xs font-medium text-amber-800">
        {t('offline_banner')}
      </Text>
    </View>
  );
}

export function LoadingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator color={BRAND.navy} />
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <Text className="text-center text-sm text-zinc-400">{message}</Text>
    </ScrollView>
  );
}

export function ScreenTitle({ children }: { children: string }) {
  return (
    <Text className="px-4 pb-2 pt-4 text-xl font-semibold text-[#0F1B2E]">
      {children}
    </Text>
  );
}
