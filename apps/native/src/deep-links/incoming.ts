/**
 * R-4 — de la URL que llega del sistema a la ruta de la app.
 *
 * El correo enlaza a `https://misterfc.es/{locale}/invite/{token}` (BUG-3: se reclama
 * ESO y nada más). La app no tiene locale en sus rutas, así que hay que traducir
 * `/es/invite/abc` → `/invite/abc`. Eso es todo lo que hace este módulo, y por eso es
 * puro: `+native-intent` no es un sitio donde se pueda depurar cómodamente —corre antes
 * que la app, y en arranque en frío antes que casi nada.
 *
 * NO SE USA `new URL`. El polyfill (`react-native-url-polyfill/auto`) se importa desde
 * `app/_layout.tsx`, y `+native-intent` puede ejecutarse ANTES de que ese módulo se haya
 * evaluado. Un `new URL` ahí es un crash en el arranque en frío, que es justo el camino
 * que menos se prueba y el único que el usuario ve la primera vez. Con expresiones
 * regulares no hay esa dependencia.
 *
 * SE DEVUELVE `null` PARA TODO LO DEMÁS, y es importante: `null` significa «no es mía,
 * que siga el camino normal». Devolver una ruta inventada para un enlace desconocido
 * mandaría a la app a una pantalla que no existe.
 */
import { DEEP_LINK_HOST, DEEP_LINK_LOCALES } from '@misterfc/core/rules';

/** El fragmento y la query se tiran: el token viaja en la RUTA. */
function soloRuta(raw: string): string {
  return raw.split('#')[0]?.split('?')[0] ?? '';
}

// El host y los idiomas vienen de core por `@misterfc/core/rules`, la entrada SIN
// cliente de Supabase: estaban escritos a mano aqui, y la cabecera del modulo de
// core avisa de que una copia que se queda atras rompe el enlace en silencio.
// `rules` no arrastra nada, asi que este modulo sigue siendo puro y sus tests
// rapidos (medido: 0,3 s de collect, frente a 10,4 s por el barrel).
const HOST = DEEP_LINK_HOST;
const LOCALES = new Set<string>(DEEP_LINK_LOCALES);

/**
 * Los segmentos de la ruta, o `null` si la URL no es nuestra.
 *
 * Los dos esquemas NO se tratan igual, y confundirlos fue el fallo que cazaron las
 * pruebas:
 *
 *   · `https://misterfc.es/es/invite/abc` — lo de después de `://` y hasta la primera
 *     barra es el HOST, y hay que COMPROBARLO. Sin esa comprobación,
 *     `https://otrositio.com/es/invite/abc` entraba como si fuera nuestro.
 *   · `misterfc://invite/abc` — aquí NO hay host: lo de después de `://` ya es la ruta.
 *     Tratarlo como host se comía el segmento `invite`, que es justo el que decide.
 */
function segmentosDe(ruta: string): string[] | null {
  const esquema = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(ruta);

  if (!esquema) {
    // Ruta ya relativa (expo-router la pasa así en algunos casos).
    return partir(ruta);
  }

  const protocolo = (esquema[1] ?? '').toLowerCase();
  const resto = ruta.slice(esquema[0].length);

  if (protocolo === 'http' || protocolo === 'https') {
    const barra = resto.indexOf('/');
    const host = (barra === -1 ? resto : resto.slice(0, barra)).toLowerCase();
    // El puerto no cambia de quién es el dominio.
    if (host.split(':')[0] !== HOST) return null;
    return barra === -1 ? [] : partir(resto.slice(barra));
  }

  // Esquema propio de la app: no hay host que quitar.
  return partir(resto);
}

function partir(ruta: string): string[] {
  return ruta.split('/').filter((s) => s.length > 0);
}

export function resolveInvitePath(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const segmentos = segmentosDe(soloRuta(raw.trim()));
  if (segmentos === null) return null;

  const sinLocale =
    segmentos[0] !== undefined && LOCALES.has(segmentos[0])
      ? segmentos.slice(1)
      : segmentos;

  if (sinLocale[0] !== 'invite') return null;

  const token = sinLocale[1];
  // Sin token no hay nada que abrir: que siga el camino normal en vez de aterrizar en
  // una pantalla que solo sabría decir «no encontrada».
  if (!token) return null;

  return `/invite/${token}`;
}
