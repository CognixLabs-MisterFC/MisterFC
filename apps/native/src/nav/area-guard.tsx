import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { isAllowedInArea } from '@misterfc/core';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { BRAND } from '@/theme';
import type { ChromeArea } from './config';

type GuardStatus = 'loading' | 'allowed' | 'denied';

/**
 * O2-2 — Guard de ÁREA (defensa en profundidad). El gatekeeper (app/index.tsx)
 * protege la ENTRADA, pero las rutas /family, /staff, /direction y /spectator
 * existen como ficheros: se podría aterrizar en un área ajena por navegación
 * directa, saltándose el gatekeeper. Cada layout de área usa este guard para
 * verificar que el usuario PERTENECE al área antes de montar su carcasa.
 *
 * La regla "qué área corresponde a qué rol" viene SIEMPRE de core
 * (`isAllowedInArea` → `navAreaForRole`), no se reimplementa aquí.
 */
export function useAreaGuard(area: ChromeArea): GuardStatus {
  const { user, loading: sessionLoading } = useSession();
  const app = useApp();

  if (sessionLoading || app.loading) return 'loading';
  if (!user) return 'denied';

  const role = app.activeClub?.role ?? null;
  return isAllowedInArea(area, { kind: app.kind, role }) ? 'allowed' : 'denied';
}

/**
 * Envuelve la carcasa de un área. Mientras carga sesión/app → Splash; si el
 * usuario NO pertenece al área → redirige a "/" (el gatekeeper reenruta al área
 * correcta), NUNCA monta la carcasa ajena; si pertenece → la carcasa.
 */
export function AreaGuard({
  area,
  children,
}: {
  area: ChromeArea;
  children: ReactNode;
}) {
  const status = useAreaGuard(area);

  if (status === 'loading') return <AreaSplash />;
  if (status === 'denied') return <Redirect href="/" />;
  return <>{children}</>;
}

function AreaSplash() {
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: BRAND.navy }}
    >
      <ActivityIndicator color="#ffffff" />
    </View>
  );
}
