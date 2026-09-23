import { Redirect } from 'expo-router';

/**
 * CONMUTADOR DE ÁREA — pestaña de la barra de DIRECCIÓN. NO es una pantalla: el tab
 * intercepta el press en `navigator.tsx` y hace `router.replace` al área que toca
 * (míster o familia, según lo que el usuario tenga). Este fichero existe solo porque
 * expo-router exige uno por ruta declarada.
 *
 * Si se llegara por navegación directa, redirige a la RAÍZ y no a un área concreta:
 * el destino depende del usuario, y el gatekeeper (`app/index.tsx`) ya sabe cuál es el
 * hogar de cada quien. Mandar a un área fija dejaría aquí una suposición que el
 * conmutador ya no hace.
 */
export default function DireccionSwitchRoute() {
  return <Redirect href="/" />;
}
