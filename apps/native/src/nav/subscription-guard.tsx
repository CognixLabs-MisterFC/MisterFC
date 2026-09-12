import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';
import { useSession } from '@/auth/session';
import { useSubscription } from '@/subscription/provider';
import { isSubscriptionExemptRoute } from '@/nav/config';

/**
 * SU-4 — Guard GLOBAL del muro de pago, hermano de `SessionGuard` y por el MISMO
 * motivo, que es la lección de BC-3: el gatekeeper (`app/index.tsx`) solo decide en la
 * ruta raíz. Alguien que ya está dentro de `/family` no vuelve a pasar por ahí, así que
 * sin este vigilante una suscripción que vence con la app abierta seguiría dando acceso
 * hasta que la persona reiniciara — y el gate estaría puesto en el sitio equivocado.
 *
 * No pinta nada: observa y redirige.
 *
 * Lo que se salva del muro lo decide `isSubscriptionExemptRoute` (nav/config), NO una
 * comparación escrita aquí. Es exactamente el error que dejó la app en blanco cuando el
 * `SessionGuard` llevaba su condición dentro: un bucle de navegación no lanza
 * excepciones, así que no hay crash, ni Sentry, ni CI en rojo.
 */
export function SubscriptionGuard() {
  const { user, loading: sessionLoading } = useSession();
  const { blocked, loading } = useSubscription();
  const segments = useSegments();

  useEffect(() => {
    if (sessionLoading || loading || !user) return;
    if (!blocked) return;
    if (isSubscriptionExemptRoute(segments)) return;
    router.replace('/suscripcion');
  }, [blocked, loading, sessionLoading, user, segments]);

  return null;
}
