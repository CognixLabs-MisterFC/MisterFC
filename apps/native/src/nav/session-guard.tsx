import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';
import { useSession } from '@/auth/session';
import { isPublicRoute } from '@/nav/config';

/**
 * O2-2 — Guard GLOBAL de sesión. Si la sesión termina (cerrar sesión, expiración)
 * desde CUALQUIER pantalla, vuelve al login. El gatekeeper (app/index.tsx) solo
 * decide en la ruta raíz `/`; estando dentro de un área anidada (p.ej. /family)
 * hace falta este vigilante para no quedarse en una carcasa sin sesión. No pinta
 * nada: solo observa y redirige.
 *
 * QUÉ SE SALVA DE LA EXPULSIÓN lo decide `isPublicRoute` (nav/config), no una
 * comparación escrita aquí. Antes esto era `segments[0] === 'login'`, y esa línea
 * dejó la app EN BLANCO al añadirse la primera ruta pública que no era el login:
 * el login redirigía al selector de club, el guard devolvía al login, y vuelta a
 * empezar. Un bucle de navegación no lanza excepciones, así que no hubo crash, ni
 * evento en Sentry, ni job de CI en rojo.
 *
 * La lista vive en `nav/config` para que añadir una pantalla pública sea UN sitio
 * y no una condición que hay que acordarse de ampliar.
 */
export function SessionGuard() {
  const { user, loading } = useSession();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicRoute(segments)) {
      router.replace('/login');
    }
  }, [user, loading, segments]);

  return null;
}
