/**
 * BUG-3 — Enlaces profundos: identidades, rutas y los dos ficheros que publican
 * Apple y Google. TODO en un sitio, a propósito.
 *
 * EL MODO EN QUE ESTO FALLA ES EN SILENCIO. Si el bundle id, el paquete o las rutas
 * se escriben dos veces y una se queda atrás, el enlace deja de verificarse y abre
 * el navegador. No hay error, no hay log, no hay nada que mirar: simplemente vuelve
 * a comportarse como antes. Por eso los valores viven aquí y hay una prueba que
 * compara este fichero contra `apps/native/app.json`.
 *
 * POR QUÉ ESTO SIRVE AHORA Y NO ANTES. El correo de invitación enlazaba a
 * `{{ .ConfirmationURL }}`, un enlace de `supabase.co` que REDIRIGE a misterfc.es.
 * Universal Links y App Links deciden por el dominio del enlace QUE SE TOCA, y
 * ninguno se dispara en una redirección de servidor: con aquel correo, estos
 * ficheros no se habrían consultado nunca. Medido:
 *
 *     GET …supabase.co/auth/v1/verify?token=…&redirect_to=…
 *     → 303, location: https://misterfc.es/es/invite/abc#error=…
 *
 * La plantilla de invitación ya usa `{{ .RedirectTo }}`, que enlaza a misterfc.es
 * directamente. La de RECUPERACIÓN sigue con `{{ .ConfirmationURL }}` y tiene que
 * seguir así: esa sí necesita la sesión que crea el verify de Supabase.
 *
 * NO SON SECRETOS. El Team ID y las huellas del certificado se publican en los dos
 * ficheros por diseño: son identificadores, no credenciales. Van escritos y no en
 * variables de entorno porque una variable sin definir en producción publicaría un
 * fichero vacío —peor que no tenerlo, y también en silencio.
 */

/** Team ID de Apple + bundle identifier (`ios.bundleIdentifier` de app.json). */
export const IOS_APP_ID = '8GQKG86PS9.com.misterfc.app';

/** `android.package` de app.json. */
export const ANDROID_PACKAGE = 'com.misterfc.app';

/**
 * Las DOS huellas SHA-256, y las dos hacen falta:
 *   · subida (EAS) — firma el APK que se prueba a mano;
 *   · Google (Play App Signing) — firma lo que descargan los usuarios.
 * Con solo una, los enlaces funcionan en un sitio y en el otro no.
 */
export const ANDROID_CERT_SHA256 = [
  'B7:AA:76:CE:97:FC:0C:30:66:A8:36:2D:D6:59:9D:14:BE:95:80:C0:9D:EA:D9:CC:48:B7:40:03:5F:9F:56:0A',
  'D0:E7:6D:50:56:BD:38:95:04:3C:59:75:A8:A1:4A:9C:FA:76:55:FE:2F:37:07:26:93:B8:AB:A0:5E:40:6C:A0',
] as const;

/** El dominio que se reclama. El del `linkBase` que arma el correo. */
export const DEEP_LINK_HOST = 'misterfc.es';

/** Los idiomas de la web (next-intl). El enlace del correo lleva el locale dentro. */
export const DEEP_LINK_LOCALES = ['es', 'en', 'va'] as const;

/** El segmento que la app reclama. Solo este. */
export const INVITE_SEGMENT = 'invite';

/**
 * Lo ÚNICO que se reclama: `/{locale}/invite/{token}`.
 *
 * Reclamar `/*` haría que CUALQUIER enlace de misterfc.es abriera la app —el panel
 * entero, los textos legales, la portada de clubes— y la web es una aplicación
 * completa por su cuenta. Se reclama lo que la app sabe terminar y nada más.
 */
export const INVITE_DEEP_LINK_PATHS: readonly string[] = DEEP_LINK_LOCALES.map(
  (locale) => `/${locale}/${INVITE_SEGMENT}/*`,
);

/**
 * `apple-app-site-association`. Se emiten las DOS formas: `components`/`appIDs`
 * (iOS 13+) y `paths`/`appID` (anteriores). Son equivalentes; Apple usa la que
 * entiende.
 */
export function buildAppleAppSiteAssociation() {
  return {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: INVITE_DEEP_LINK_PATHS.map((ruta) => ({
            '/': ruta,
            comment: 'Aceptar una invitacion de MisterFC',
          })),
        },
        { appID: IOS_APP_ID, paths: [...INVITE_DEEP_LINK_PATHS] },
      ],
    },
  };
}

/**
 * `assetlinks.json`. Aquí NO se restringen rutas: Android verifica el DOMINIO, no
 * los paths. Qué enlaces abre la app lo decide el `intentFilters` del binario.
 */
export function buildAssetLinks() {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [...ANDROID_CERT_SHA256],
      },
    },
  ];
}
