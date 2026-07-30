import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { navAreaForRole } from '@misterfc/core';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { AREA_SEGMENT } from '@/nav/config';
import { BRAND } from '@/theme';
import { t } from '@/i18n';

/**
 * O2-2 — GATEKEEPER de navegación (fichero ÚNICO de enrutado por rol, patrón del
 * RootNavigator de VERTEX). Tras login resuelve el tipo de usuario y monta el
 * árbol que corresponde:
 *
 *   sin sesión            → /login
 *   seguidor (espectador) → /spectator
 *   miembro con rol       → navAreaForRole(rol) → /family | /staff | /direction
 *   sin acceso reconocible→ pantalla "sin acceso" (NUNCA un árbol de más
 *                           privilegio; fallback seguro con cerrar sesión).
 *
 * No hay pantalla propia aquí: solo decide y redirige (o muestra el dead-end
 * seguro). Las carcasas viven en app/<area>/_layout.tsx.
 */
export default function Index() {
  const { user, loading: sessionLoading } = useSession();
  const app = useApp();

  if (sessionLoading) return <Splash />;
  if (!user) return <Redirect href="/login" />;
  if (app.loading) return <Splash />;

  if (app.kind === 'spectator') {
    return <Redirect href={`/${AREA_SEGMENT.spectator}`} />;
  }

  if (app.kind === 'member' && app.activeClub) {
    const area = navAreaForRole(app.activeClub.role);
    return <Redirect href={`/${AREA_SEGMENT[area]}`} />;
  }

  // Fallback seguro: cuenta sin club/rol reconocible. Nunca más privilegio.
  return <NoAccess onSignOut={app.signOut} />;
}

function Splash() {
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: BRAND.navy }}
    >
      <ActivityIndicator color="#ffffff" />
    </View>
  );
}

function NoAccess({ onSignOut }: { onSignOut: () => void }) {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center gap-3 p-6">
        <Text className="text-2xl font-bold text-[#0F1B2E]">
          {t('home.no_access_title')}
        </Text>
        <Text className="text-base text-zinc-500">
          {t('home.no_access_body')}
        </Text>
        <Pressable
          onPress={onSignOut}
          className="mt-4 items-center rounded-xl border border-zinc-200 py-3 active:opacity-70"
        >
          <Text className="text-base font-medium text-zinc-700">
            {t('nav.cerrar_sesion')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
