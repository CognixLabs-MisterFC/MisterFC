import { Redirect } from 'expo-router';

/**
 * CONMUTADOR DE ÁREA — pestaña de la barra de FAMILIA. NO es una pantalla: el tab
 * intercepta el press en `navigator.tsx` y hace `router.replace` al área que toca
 * (el hogar de quien está en modo tutor). Fichero requerido por expo-router.
 *
 * Navegación directa → la RAÍZ: el gatekeeper ya sabe cuál es el hogar de cada quien,
 * y aquí no lo sabemos sin volver a leer el rol. Una familia de nacimiento que
 * aterrizara aquí también acaba en su sitio; el tab, a ella, no se le muestra.
 */
export default function FamiliaSwitchRoute() {
  return <Redirect href="/" />;
}
