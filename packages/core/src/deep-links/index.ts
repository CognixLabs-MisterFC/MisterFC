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
 *   · subida (EAS) — la del `.aab`/APK que sale de EAS;
 *   · Google (Play App Signing) — firma lo que descargan los usuarios.
 * Con solo una, los enlaces funcionan en un sitio y en el otro no.
 *
 * ── LO QUE ESTE COMENTARIO DECIA MAL, Y COSTO UNA TARDE ──────────────────────
 *
 * Aqui ponia que la huella de subida «firma el APK que se prueba a mano». NO es
 * verdad con el flujo de esta casa: el APK de mano sale de
 * `apps/native/build-apk.sh`, y el `build.gradle` que genera `expo prebuild`
 * trae `release { signingConfig signingConfigs.debug }` — o sea que firma con el
 * `debug.keystore` de la plantilla de Expo:
 *
 *     CN=Android Debug, O=Unknown (valido desde 2013)
 *     FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
 *
 * Esa huella NO esta en esta lista, asi que ese APK no verifica los App Links
 * NUNCA. El enlace abre el navegador, exactamente igual que si el montaje
 * estuviera mal — y el montaje esta bien: la API publica de Digital Asset Links
 * de Google devuelve las dos sentencias sin error, y el AASA ya esta en la CDN
 * de Apple.
 *
 * Y NO SE ARREGLA AÑADIENDOLA. Ese keystore es el UNIVERSAL de la plantilla:
 * lo tiene cualquiera. Publicarlo aqui dejaria que cualquier app firmada con la
 * clave de depuracion estandar quedara verificada como manejadora oficial de los
 * enlaces de invitacion de misterfc.es — invitaciones de menores incluidas. Hay
 * un test que lo impide.
 *
 * Para probar el enlace en un APK local, ver la nota del final de build-apk.sh.
 */
/**
 * La huella del `debug.keystore` de la plantilla de Expo. Esta escrita AQUI para
 * una sola cosa: para que el test compruebe que NO aparece en la lista de abajo.
 * No es un secreto —la tiene todo el mundo— y ese es justamente el problema.
 */
export const ANDROID_DEBUG_KEYSTORE_SHA256 =
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';

export const ANDROID_CERT_SHA256 = [
  'B7:AA:76:CE:97:FC:0C:30:66:A8:36:2D:D6:59:9D:14:BE:95:80:C0:9D:EA:D9:CC:48:B7:40:03:5F:9F:56:0A',
  'D0:E7:6D:50:56:BD:38:95:04:3C:59:75:A8:A1:4A:9C:FA:76:55:FE:2F:37:07:26:93:B8:AB:A0:5E:40:6C:A0',
] as const;

/** El dominio que se reclama. El del `linkBase` que arma el correo. */
export const DEEP_LINK_HOST = 'misterfc.es';

/**
 * El ORIGEN del que sale TODO enlace de invitación. Escrito, no deducido.
 *
 * Antes cada sender lo componía con el host de la petición
 * (`x-forwarded-host`), y eran NUEVE sitios haciendo lo mismo. Eso ata el enlace
 * que recibe una familia al dominio por el que entró quien invitó: desde un
 * preview de Vercel salía un enlace a `…vercel.app`, y ahí no hay ni
 * `assetlinks.json` ni AASA. El enlace abre el navegador y nadie se entera —el
 * modo de fallo de siempre en esto.
 *
 * Y el enlace tiene que ser EXACTAMENTE este dominio: `www.misterfc.es` no vale
 * (ni certificado ni ficheros), y un dominio distinto tampoco, porque
 * `resolveInvitePath` de la app comprueba el host antes de abrir nada.
 */
export const WEB_ORIGIN = `https://${DEEP_LINK_HOST}`;

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
 * El locale, si es uno de los de la web; si no, `es`.
 *
 * Normaliza en vez de lanzar A PROPÓSITO. Esto lo llama un sender que YA ha
 * escrito la invitación en la base de datos: una excepción aquí dejaría la fila
 * creada y el correo sin salir. Un enlace en castellano para quien esperaba
 * inglés es peor que nada, pero mucho menos peor que un enlace roto —o que
 * ninguno—. Hoy no puede pasar: los tres callers sacan el locale del segmento
 * `[locale]` de next-intl.
 */
function localeODefecto(locale: string): string {
  return (DEEP_LINK_LOCALES as readonly string[]).includes(locale) ? locale : 'es';
}

/**
 * La base del enlace de invitación: `https://misterfc.es/{locale}/invite`.
 *
 * Existe para que NINGÚN sender vuelva a componerlo a mano. Es la misma ruta que
 * reclaman `assetlinks.json`, el AASA y el `intentFilters` del binario: si se
 * escribe en otro sitio y se queda atrás, el enlace deja de abrir la app sin que
 * nada falle.
 */
export function inviteLinkBase(locale: string): string {
  return `${WEB_ORIGIN}/${localeODefecto(locale)}/${INVITE_SEGMENT}`;
}

/** El enlace completo que va en el correo. */
export function inviteLink(locale: string, token: string): string {
  return `${inviteLinkBase(locale)}/${token}`;
}

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
