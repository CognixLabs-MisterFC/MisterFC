import { Redirect } from 'expo-router';

/**
 * S2-2 director-entrenador — pestaña "Club" de la barra de STAFF (modo Míster): vuelve
 * al área DIRECCIÓN. NO es una pantalla: el tab intercepta el press en `navigator.tsx`
 * y hace `router.replace('/direction')`. Fichero requerido por expo-router; navegación
 * directa → redirige a dirección (su hogar, siempre permitido). El tab solo se muestra
 * a quien tiene hogar en dirección (director/admin); un entrenador/coordinador NUNCA lo
 * ve (el AreaGuard lo rebotaría de /direction).
 */
export default function ClubSwitchRoute() {
  return <Redirect href="/direction" />;
}
