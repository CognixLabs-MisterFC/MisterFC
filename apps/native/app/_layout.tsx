// El polyfill de URL debe cargarse ANTES de construir el cliente Supabase
// (supabase-js usa URL/URLSearchParams, incompletos en RN/Hermes). Primer import.
import 'react-native-url-polyfill/auto';
import '../global.css';
// Sentry (O2-12b): inicializa como EFECTO al importar, lo antes posible tras los
// polyfills, para capturar también errores del arranque de los providers.
import '@/lib/sentry';

import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/auth/session';
import { LocaleProvider } from '@/locale/provider';
import { AppProvider } from '@/auth/context';
import { ActivePlayerProvider } from '@/auth/active-player';
import { SessionGuard } from '@/nav/session-guard';
import { SubscriptionGuard } from '@/nav/subscription-guard';
import { SubscriptionProvider } from '@/subscription/provider';
import { NotificationsProvider } from '@/notifications/notifications-provider';

function RootLayout() {
  return (
    // GestureHandlerRootView (O2-8b): raíz obligatoria para los gestos nativos
    // (drag de la alineación). Envuelve toda la app; flex:1 para ocupar la pantalla.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          {/* LocaleProvider dentro de SessionProvider (necesita el userId) y por
              encima de todo lo visible: el cambio de idioma re-renderiza la app. */}
          <LocaleProvider>
            <AppProvider>
              <ActivePlayerProvider>
                {/* SU-4: por debajo de AppProvider (necesita la sesión) y por encima
                    de todo lo visible — el muro tiene que poder aparecer desde
                    cualquier pantalla, no solo desde la raíz. */}
                <SubscriptionProvider>
                  <StatusBar style="light" />
                  <SessionGuard />
                  <SubscriptionGuard />
                  <NotificationsProvider />
                  <Stack screenOptions={{ headerShown: false }} />
                </SubscriptionProvider>
              </ActivePlayerProvider>
            </AppProvider>
          </LocaleProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap añade el ErrorBoundary de Sentry y el contexto de navegación/toques.
// Es un passthrough si Sentry no llegó a inicializarse (DSN ausente).
export default Sentry.wrap(RootLayout);
