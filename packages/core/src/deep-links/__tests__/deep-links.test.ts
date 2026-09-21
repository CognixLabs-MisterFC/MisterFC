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
