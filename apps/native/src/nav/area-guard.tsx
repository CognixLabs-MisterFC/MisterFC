import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { isAllowedInArea } from '@misterfc/core';
import { useSession } from '@/auth/session';
import { useApp } from '@/auth/context';
import { useActivePlayer } from '@/auth/active-player';
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
 *
 * S2 director-entrenador: se pasa `hasStaffTeams` (del AppProvider) para que un
 * director/admin_club con equipos asignados pase el guard del área 'staff' (modo
 * entrenador). Un director SIN equipos sigue denegado en 'staff'.
 *
 * MODO TUTOR: se pasa `hasLinkedPlayers` (del ActivePlayerProvider, que ya carga la
 * lista de hijos del club activo para CUALQUIER usuario) para que quien tenga hijos
 * vinculados pase el guard de 'family'. ESTA ES LA PUERTA: no hay otra comprobación
 * en la pantalla ni en el menú que valga por sí sola —el menú solo decide si pinta
 * la entrada—, así que quien no tenga hijos no entra ni escribiendo la ruta.
 */
export function useAreaGuard(area: ChromeArea): GuardStatus {
  const { user, loading: sessionLoading } = useSession();
  const app = useApp();
  const linkedPlayers = useActivePlayer();

  if (sessionLoading || app.loading) return 'loading';
  if (!user) return 'denied';

  const role = app.activeClub?.role ?? null;
  const allowed = isAllowedInArea(area, {
    kind: app.kind,
    role,
    hasStaffTeams: app.hasStaffTeams,
    hasLinkedPlayers: linkedPlayers.players.length > 0,
  });
  if (allowed) return 'allowed';

  // La lista de hijos llega en ASÍNCRONO, así que mientras carga un `false` no es una
  // negativa: es un "todavía no lo sé". Negar ahí rebotaría a un director-tutor fuera
  // de /family en cada arranque en frío. Solo espera el área que depende del dato; el
  // resto deniega al instante, como siempre.
  if (area === 'family' && linkedPlayers.loading) return 'loading';
  return 'denied';
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
