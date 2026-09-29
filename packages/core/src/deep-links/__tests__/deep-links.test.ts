import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_CERT_SHA256,
  ANDROID_PACKAGE,
  DEEP_LINK_HOST,
  DEEP_LINK_LOCALES,
  INVITE_DEEP_LINK_PATHS,
  IOS_APP_ID,
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  ANDROID_DEBUG_KEYSTORE_SHA256,
  WEB_ORIGIN,
  inviteLink,
  inviteLinkBase,
  OPEN_IN_BROWSER_SEGMENT,
  openInBrowserPath,
  openInBrowserLink,
} from '../index';

/**
 * BUG-3 — Lo que se mide aquí no es «el JSON tiene la forma que escribí»: eso sería
 * copiar el fichero en la prueba. Se mide lo que se rompe EN SILENCIO.
 *
 * Un enlace profundo que deja de verificarse no da error, no deja log y no cambia
 * nada visible: vuelve a abrir el navegador, como antes. Las tres formas conocidas
 * de llegar ahí son (1) que la app y la web dejen de decir el mismo identificador,
 * (2) que falte una de las dos huellas de Android, y (3) que se reclame media web
 * sin querer. Los tres bloques de abajo son esas tres.
 */

const raiz = fileURLToPath(new URL('../../../../../', import.meta.url));
const appJson = JSON.parse(
  readFileSync(raiz + 'apps/native/app.json', 'utf8'),
) as {
  expo: {
    ios: { bundleIdentifier: string; associatedDomains?: string[] };
    android: {
      package: string;
      intentFilters?: {
        action: string;
        autoVerify?: boolean;
        category?: string[];
        data: { scheme: string; host: string; pathPrefix: string }[];
      }[];
    };
  };
};

describe('los dos lados dicen lo mismo', () => {
  it('el bundle identifier del Team ID es el de app.json', () => {
    // IOS_APP_ID es "<TeamID>.<bundle>"; si el bundle cambia en app.json y aquí no,
    // Apple deja de verificar y nadie se entera.
    expect(IOS_APP_ID.endsWith(`.${appJson.expo.ios.bundleIdentifier}`)).toBe(true);
    expect(IOS_APP_ID.split('.')[0]).toMatch(/^[A-Z0-9]{10}$/);
  });

  it('el paquete de Android es el de app.json', () => {
    expect(ANDROID_PACKAGE).toBe(appJson.expo.android.package);
  });

  it('app.json reclama el dominio en las dos plataformas', () => {
    expect(appJson.expo.ios.associatedDomains).toEqual([`applinks:${DEEP_LINK_HOST}`]);
    const filtros = appJson.expo.android.intentFilters ?? [];
    expect(filtros).toHaveLength(1);
    const filtro = filtros[0];
    if (!filtro) throw new Error('app.json no declara intentFilters');
    expect(filtro.autoVerify).toBe(true);
    expect(filtro.category).toEqual(['BROWSABLE', 'DEFAULT']);
  });

  it('las rutas de Android son las mismas que publica el fichero de Apple', () => {
    const datos = appJson.expo.android.intentFilters?.[0]?.data ?? [];
    expect(datos.map((d) => d.pathPrefix).sort()).toEqual(
      DEEP_LINK_LOCALES.map((l) => `/${l}/invite`).sort(),
    );
    for (const d of datos) {
      expect(d.scheme).toBe('https');
      expect(d.host).toBe(DEEP_LINK_HOST);
    }
  });
});

describe('assetlinks.json', () => {
  it('lleva las DOS huellas: sin la de Google los enlaces mueren en la tienda', () => {
    const entrada = buildAssetLinks()[0];
    if (!entrada) throw new Error('assetlinks vacio');
    expect(entrada.target.sha256_cert_fingerprints).toHaveLength(2);
    expect(entrada.target.sha256_cert_fingerprints).toEqual([...ANDROID_CERT_SHA256]);
  });

  it('las huellas tienen forma de SHA-256 en mayusculas y con dos puntos', () => {
    for (const h of ANDROID_CERT_SHA256) {
      expect(h).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });

  it('las dos huellas son distintas', () => {
    // Pegar dos veces la misma es el error facil, y deja media verificacion rota.
    expect(new Set(ANDROID_CERT_SHA256).size).toBe(2);
  });

  it('declara la relacion que Android espera, sobre android_app', () => {
    const entrada = buildAssetLinks()[0];
    if (!entrada) throw new Error('assetlinks vacio');
    expect(entrada.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(entrada.target.namespace).toBe('android_app');
  });
});

describe('apple-app-site-association', () => {
  it('emite las dos formas, la moderna y la antigua, con el mismo appID', () => {
    const aasa = buildAppleAppSiteAssociation();
    const moderna = aasa.applinks.details[0];
    const antigua = aasa.applinks.details[1];
    if (!moderna || !antigua) throw new Error('faltan las dos formas');
    expect(moderna.appIDs).toEqual([IOS_APP_ID]);
    expect(antigua.appID).toBe(IOS_APP_ID);
    expect(moderna.components?.map((c) => c['/'])).toEqual(antigua.paths);
  });

  it('NO reclama la web entera: solo las rutas de invitacion', () => {
    // Reclamar '/*' abriria la app con cualquier enlace de misterfc.es —el panel,
    // los textos legales, la portada de clubes—. Es el fallo caro de este fichero.
    const aasa = buildAppleAppSiteAssociation();
    const rutas = aasa.applinks.details.flatMap(
      (d) => d.paths ?? d.components?.map((c) => c['/']) ?? [],
    );
    expect(rutas.length).toBeGreaterThan(0);
    for (const r of rutas) {
      expect(r).toMatch(/^\/(es|en|va)\/invite\/\*$/);
    }
    expect(rutas).not.toContain('/*');
  });

  it('hay una ruta por idioma de la web', () => {
    expect(INVITE_DEEP_LINK_PATHS).toHaveLength(DEEP_LINK_LOCALES.length);
  });
});

/**
 * EL FALLO QUE ESTO IMPIDE. Un APK local no verifica los App Links porque
 * `build-apk.sh` lo firma con el `debug.keystore` de la plantilla de Expo. La
 * "solucion" tentadora es añadir esa huella aqui y que el enlace funcione en el
 * movil de quien prueba. Seria un agujero: ese keystore es el UNIVERSAL —lo tiene
 * cualquiera que haya abierto un proyecto Android—, asi que cualquier app firmada
 * con el quedaria verificada como manejadora oficial de los enlaces de invitacion
 * de misterfc.es. Y las invitaciones son de menores.
 */
describe('la huella de depuracion NO puede estar publicada', () => {
  it('assetlinks no lleva el debug.keystore universal', () => {
    expect(ANDROID_CERT_SHA256).not.toContain(ANDROID_DEBUG_KEYSTORE_SHA256);
  });

  // Ancla positiva: si la constante se vaciara, el `not.toContain` de arriba
  // pasaria sin comprobar nada.
  it('y la huella prohibida sigue teniendo forma de SHA-256', () => {
    expect(ANDROID_DEBUG_KEYSTORE_SHA256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

/**
 * El enlace del correo sale de UNA constante, no del host de la peticion. Antes lo
 * componian nueve senders con `x-forwarded-host`: desde un preview de Vercel salia
 * un enlace a `…vercel.app`, donde no hay ni assetlinks ni AASA.
 */
describe('el enlace de invitacion', () => {
  it('sale siempre de https://misterfc.es', () => {
    expect(WEB_ORIGIN).toBe('https://misterfc.es');
    expect(inviteLink('es', 'abc')).toBe('https://misterfc.es/es/invite/abc');
  });

  it('cae en una ruta que el fichero de Apple reclama, en los tres idiomas', () => {
    for (const locale of DEEP_LINK_LOCALES) {
      const url = inviteLink(locale, 'tok');
      expect(url.startsWith(`https://${DEEP_LINK_HOST}/${locale}/invite/`)).toBe(true);
      expect(INVITE_DEEP_LINK_PATHS).toContain(`/${locale}/invite/*`);
    }
  });

  it('un locale que no es de la web cae a es, no rompe el enlace', () => {
    expect(inviteLinkBase('de')).toBe('https://misterfc.es/es/invite');
  });

  // El host EXACTO importa: www no tiene certificado ni ficheros.
  it('nunca sale con www', () => {
    expect(inviteLink('es', 'x')).not.toContain('www.');
  });
});

/**
 * N-3a — LA RUTA ABRIDORA no la puede reclamar nadie.
 *
 * Existe para que el boton de la pantalla nativa (N-3b) mande al tutor al navegador
 * sin que el sistema le devuelva a la app: `/{locale}/invite/{token}` SI esta
 * reclamada, y abrirla con `Linking.openURL` lo devolveria al mismo sitio del que
 * venia. `abrir-invitacion` no lo esta, y el salto a `/invite` ocurre ya dentro del
 * navegador.
 *
 * Lo que vigila este bloque es que SIGA sin estarlo. Añadir el segmento al
 * `intentFilters` de app.json o al AASA reintroduce el bucle, y —como todo en este
 * fichero— en silencio: el enlace simplemente volveria a abrir la app.
 *
 * Y vigila el CONTROL NEGATIVO, que es lo que hace que lo anterior signifique algo:
 * los mismos emparejadores tienen que decir que `/es/invite/abc` SI esta reclamada.
 * Sin eso, un emparejador roto daria «no reclamada» para todo y el bloque pasaria
 * entero sin medir nada.
 */
const RUTAS_ANDROID = (appJson.expo.android.intentFilters ?? []).flatMap((f) =>
  f.data.map((d) => d.pathPrefix),
);
const RUTAS_APPLE = buildAppleAppSiteAssociation().applinks.details.flatMap(
  (d) => d.paths ?? d.components?.map((c) => c['/']) ?? [],
);

/** Android empareja por PREFIJO de path, tal cual. */
function androidLaReclama(path: string): boolean {
  return RUTAS_ANDROID.some((prefijo) => path.startsWith(prefijo));
}

/** Apple empareja con patrones tipo `/es/invite/*`. */
function appleLaReclama(path: string): boolean {
  return RUTAS_APPLE.some((patron) => {
    const re = new RegExp(
      '^' + patron.split('*').map((t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    );
    return re.test(path);
  });
}

describe('N-3a · la ruta abridora', () => {
  it('CONTROL NEGATIVO: los emparejadores dicen que la de invitacion SI esta reclamada', () => {
    for (const locale of DEEP_LINK_LOCALES) {
      const reclamada = `/${locale}/invite/abc123`;
      expect(androidLaReclama(reclamada), `android: ${reclamada}`).toBe(true);
      expect(appleLaReclama(reclamada), `apple: ${reclamada}`).toBe(true);
    }
  });

  it('NO la reclama Android', () => {
    for (const locale of DEEP_LINK_LOCALES) {
      const abridora = openInBrowserPath(locale, 'abc123');
      expect(androidLaReclama(abridora), `android reclama ${abridora}`).toBe(false);
    }
  });

  it('NO la reclama iOS', () => {
    for (const locale of DEEP_LINK_LOCALES) {
      const abridora = openInBrowserPath(locale, 'abc123');
      expect(appleLaReclama(abridora), `apple reclama ${abridora}`).toBe(false);
    }
  });

  it('el segmento no empieza por el reclamado, ni al reves', () => {
    // `pathPrefix` es un prefijo CRUDO: un segmento que empezara por «invite»
    // quedaria reclamado sin que nadie lo hubiera querido.
    expect(OPEN_IN_BROWSER_SEGMENT.startsWith('invite')).toBe(false);
    expect('invite'.startsWith(OPEN_IN_BROWSER_SEGMENT)).toBe(false);
  });

  it('sale del mismo origen escrito que el enlace del correo', () => {
    expect(openInBrowserLink('es', 'abc')).toBe(`${WEB_ORIGIN}/es/abrir-invitacion/abc`);
    expect(openInBrowserLink('va', 'abc')).toBe(`${WEB_ORIGIN}/va/abrir-invitacion/abc`);
  });

  it('un locale que no es de la web cae en es, igual que el enlace del correo', () => {
    expect(openInBrowserPath('pt', 'abc')).toBe('/es/abrir-invitacion/abc');
  });

  it('hay una ruta abridora por idioma, y ninguna choca con las reclamadas', () => {
    const abridoras = DEEP_LINK_LOCALES.map((l) => openInBrowserPath(l, 'abc'));
    expect(new Set(abridoras).size).toBe(DEEP_LINK_LOCALES.length);
    expect(abridoras.some((a) => INVITE_DEEP_LINK_PATHS.includes(a))).toBe(false);
  });
});

/**
 * El redirect vive en `next.config.ts` y se lee como TEXTO a propósito: importarlo
 * arrastraria los plugins de Next y Sentry a una prueba de core. Lo que importa es
 * que exista, que use EL MISMO segmento que esta escrito aqui, y que apunte a la
 * ruta reclamada — sin el salto, la abridora seria un 404.
 */
describe('N-3a · el redirect de la web', () => {
  const nextConfig = readFileSync(raiz + 'apps/web/next.config.ts', 'utf8');

  it('existe y usa el mismo segmento que core', () => {
    expect(nextConfig).toContain(`/abrir-invitacion/:token`);
    expect(OPEN_IN_BROWSER_SEGMENT).toBe('abrir-invitacion');
  });

  it('salta a la ruta de invitacion, que es la que la app sabe terminar', () => {
    expect(nextConfig).toContain(`destination: '/:locale/invite/:token'`);
  });

  it('es TEMPORAL: un 308 se cachea para siempre y no habria vuelta atras', () => {
    const i = nextConfig.indexOf('/abrir-invitacion/:token');
    const trozo = nextConfig.slice(i, i + 200);
    expect(trozo).toContain('permanent: false');
  });

  it('acota el locale a los tres de la web', () => {
    expect(nextConfig).toContain(`'/:locale(${DEEP_LINK_LOCALES.join('|')})/abrir-invitacion/:token'`);
  });
});
