import { Text, View } from 'react-native';
import { useTranslations } from '@/locale/provider';
import { navI18nKey } from './menu';

/**
 * O2-2 — Pantalla PLACEHOLDER. Muestra su nombre y nada más: cero funcionalidad,
 * cero datos, cero queries de negocio. Cada entrada de barra y de menú es una de
 * estas; se rellenan en O2-5 y siguientes. La cabecera/barra las pone el _layout
 * del área (carcasa con tema del club), así que aquí solo va el cuerpo.
 */
export function Placeholder({ labelKey }: { labelKey: string }) {
  // Namespace vacío: `labelKey` viene de config con ruta completa (nav.<x> / shell.nav.<x>).
  const t = useTranslations('');
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-white p-6">
      <Text className="text-xl font-semibold text-[#0F1B2E]">{t(navI18nKey(labelKey))}</Text>
      <Text className="text-sm text-zinc-400">{t('shell.placeholder_hint')}</Text>
    </View>
  );
}
