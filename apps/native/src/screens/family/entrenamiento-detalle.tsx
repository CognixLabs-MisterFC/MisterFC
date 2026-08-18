import { ScrollView, Text, View } from 'react-native';
import { useTranslations } from '@/locale/provider';

/** Día + hora sin segundos (mismo criterio que el resto de la app: `toLocaleString`). */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * O2 — Detalle de un entrenamiento SIN sesión compartida: solo los datos del propio
 * entrenamiento (título, día/hora y ubicación) más un aviso de que no hay sesión que
 * mostrar. Los entrenamientos CON sesión no pasan por aquí: abren `sesion-detalle`.
 * Los datos llegan por parámetros desde la lista (no hay segundo fetch).
 */
export function EntrenamientoDetalleScreen({
  title,
  startsAt,
  locationName,
}: {
  title: string | null;
  startsAt: string | null;
  locationName: string | null;
}) {
  const t = useTranslations('');

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <View>
          <Text className="text-xl font-bold text-[#0F1B2E]">
            {title || t('entrenamientos.untitled')}
          </Text>
          <Text className="text-xs text-zinc-400">
            {[startsAt ? formatDateTime(startsAt) : null, locationName]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <View className="rounded-2xl border border-zinc-200 p-4">
          <Text className="text-sm text-zinc-500">{t('entrenamientos.no_session')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
