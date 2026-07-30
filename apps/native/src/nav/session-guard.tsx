import { useEffect } from 'react';
import { router, useSegments } from 'expo-router';
import { useSession } from '@/auth/session';

/**
 * O2-2 — Guard GLOBAL de sesión. Si la sesión termina (cerrar sesión, expiración)
 * desde CUALQUIER pantalla, vuelve al login. El gatekeeper (app/index.tsx) solo
 * decide en la ruta raíz `/`; estando dentro de un área anidada (p.ej. /family)
 * hace falta este vigilante para no quedarse en una carcasa sin sesión. No pinta
 * nada: solo observa y redirige.
 */
export function SessionGuard() {
  const { user, loading } = useSession();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const onLogin = segments[0] === 'login';
    if (!user && !onLogin) {
      router.replace('/login');
    }
  }, [user, loading, segments]);

  return null;
}
