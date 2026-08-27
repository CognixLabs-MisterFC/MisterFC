import { Redirect } from 'expo-router';

/**
 * S2-2 director-entrenador — pestaña "Míster" de la barra de DIRECCIÓN. NO es una
 * pantalla: el tab intercepta el press en `navigator.tsx` y hace
 * `router.replace('/staff')` (modo entrenador). Este fichero existe solo porque
 * expo-router exige un fichero por ruta declarada; si se llegara por navegación
 * directa, redirige al área staff (el AreaGuard de #532 la bloquea si el director no
 * tiene equipos). El tab solo se muestra si `hasStaffTeams`.
 */
export default function MisterSwitchRoute() {
  return <Redirect href="/staff" />;
}
