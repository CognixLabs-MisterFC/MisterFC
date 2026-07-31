// El polyfill de URL debe cargarse ANTES de construir el cliente Supabase
// (supabase-js usa URL/URLSearchParams, incompletos en RN/Hermes). Primer import.
import 'react-native-url-polyfill/auto';
import '../global.css';

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/auth/session';
import { AppProvider } from '@/auth/context';
import { ActivePlayerProvider } from '@/auth/active-player';
import { SessionGuard } from '@/nav/session-guard';
import { NotificationsProvider } from '@/notifications/notifications-provider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppProvider>
          <ActivePlayerProvider>
            <StatusBar style="light" />
            <SessionGuard />
            <NotificationsProvider />
            <Stack screenOptions={{ headerShown: false }} />
          </ActivePlayerProvider>
        </AppProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
