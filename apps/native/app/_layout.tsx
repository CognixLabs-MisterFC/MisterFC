// El polyfill de URL debe cargarse ANTES de construir el cliente Supabase
// (supabase-js usa URL/URLSearchParams, incompletos en RN/Hermes). Primer import.
import 'react-native-url-polyfill/auto';
import '../global.css';

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '@/auth/session';
import { AppProvider } from '@/auth/context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }} />
        </AppProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
