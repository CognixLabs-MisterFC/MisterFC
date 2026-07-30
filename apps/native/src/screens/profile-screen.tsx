import { ScrollView, Text, View } from 'react-native';
import { t } from '@/i18n';
import { PushSettingsCard } from '@/notifications/push-settings-card';

/**
 * O2-4 PR-2 — Pantalla de Perfil compartida por las cuatro áreas. Sigue siendo
 * un placeholder salvo por la sección de notificaciones push, que es funcional
 * (la app necesita un punto donde el usuario active el permiso, réplica de la
 * pantalla de ajustes de notificaciones de la web). El resto del perfil se
 * rellena en O2-5+.
 */
export function ProfileScreen() {
  return (
    <ScrollView className="flex-1 bg-white">
      <View className="gap-4 p-6">
        <Text className="text-xl font-semibold text-[#0F1B2E]">
          {t('nav.perfil')}
        </Text>
        <Text className="text-sm text-zinc-400">{t('push.section_title')}</Text>
        <PushSettingsCard />
      </View>
    </ScrollView>
  );
}
