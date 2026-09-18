import { Redirect } from 'expo-router';

/**
 * MODO TUTOR — pestaña de VUELTA de la barra de FAMILIA: devuelve a quien está en
 * modo tutor a su hogar (dirección o cuerpo técnico). NO es una pantalla: el tab
 * intercepta el press en `navigator.tsx` y hace `router.replace` al área destino.
 * Este fichero existe solo porque expo-router exige un fichero por ruta declarada.
 *
 * Si se llegara por navegación directa, redirige a la RAÍZ: el gatekeeper
 * (`app/index.tsx`) ya sabe cuál es el hogar de cada quien —y aquí no lo sabemos sin
 * volver a leer el rol—. Una familia normal que aterrizara aquí también acaba en su
 * sitio; el tab, a ella, no se le muestra.
 */
export default function RolSwitchRoute() {
  return <Redirect href="/" />;
}
