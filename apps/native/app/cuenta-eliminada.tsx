import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslations } from '@/locale/provider';
import { BRAND } from '@/theme';

/**
 * BC-5 — "Tu cuenta ha sido eliminada". Ruta PÚBLICA (declarada en
 * `PUBLIC_ROUTE_SEGMENTS`, que es el único sitio donde se declara eso): cuando se llega
 * aquí la sesión ya está cerrada y la cuenta anonimizada y baneada, así que sin esa
 * declaración el SessionGuard la rebotaría al login y el usuario no llegaría a ver la
 * confirmación de que su borrado terminó.
 *
 * Es el plano final del vídeo para Apple. No hay ningún camino de vuelta a la cuenta:
 * solo al login, donde sus credenciales ya no valen.
 */
export default function CuentaEliminadaScreen() {
  const t = useTranslations('account_deletion');

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center gap-3 p-6">
        <Text className="text-2xl font-bold" style={{ color: BRAND.navy }}>
          {t('done_title')}
        </Text>
        <Text className="text-base text-zinc-500">{t('done_body')}</Text>
        <Pressable
          onPress={() => router.replace('/login')}
          className="mt-4 items-center rounded-xl border border-zinc-200 py-3 active:opacity-70"
        >
          <Text className="text-base font-medium text-zinc-700">{t('done_back')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
