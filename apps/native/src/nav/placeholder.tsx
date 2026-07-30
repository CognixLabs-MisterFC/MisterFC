import { Text, View } from 'react-native';
import { t } from '@/i18n';

/**
 * O2-2 — Pantalla PLACEHOLDER. Muestra su nombre y nada más: cero funcionalidad,
 * cero datos, cero queries de negocio. Cada entrada de barra y de menú es una de
 * estas; se rellenan en O2-5 y siguientes. La cabecera/barra las pone el _layout
 * del área (carcasa con tema del club), así que aquí solo va el cuerpo.
 */
export function Placeholder({ labelKey }: { labelKey: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-white p-6">
      <Text className="text-xl font-semibold text-[#0F1B2E]">{t(labelKey)}</Text>
      <Text className="text-sm text-zinc-400">{t('nav.placeholder_hint')}</Text>
    </View>
  );
}
