// Capa DINÁMICA sobre app.json (estático y committeable).
//
// Regla crítica (ADR-0020): `eas init` escribe `expo.extra.eas.projectId` en
// app.json. Aquí NO se debe pisar. Por eso partimos de `config` (lo estático) y
// hacemos merge PRESERVANDO `config.extra` — así el projectId sobrevive:
//
//     extra: { ...config.extra, <lo nuestro> }
//
// Si en su lugar pusiéramos `extra: { <lo nuestro> }` a secas, borraríamos el
// projectId que inyecta `eas init`. Cuidado ahí.
//
// Solo AÑADIMOS las EXPO_PUBLIC_* (URL y anon key de Supabase, ambas públicas;
// NO son secretos) para tenerlas accesibles vía expo-constants. Los secretos
// reales van como EAS secrets de proyecto, nunca aquí.
//
// Cada clave se añade por SPREAD CONDICIONAL: si la variable de entorno no está
// definida, la clave NO se escribe (antes, con `?? null`, `eas init` serializaba
// esos null como objetos vacíos `{}` y ensuciaba app.json).
//
// ---------------------------------------------------------------------------
// PERMISOS BLOQUEADOS (`android.blockedPermissions` en app.json)
// ---------------------------------------------------------------------------
// app.json es JSON puro y no admite comentarios, así que el porqué vive aquí.
//
// La app declaraba CAMERA, RECORD_AUDIO y SYSTEM_ALERT_WINDOW sin usar ninguno:
//
//   CAMERA              lo declara expo-image-picker, porque la librería PUEDE
//                       abrir la cámara. Esta app no: sus dos únicos usos,
//                       profile-screen.tsx y family/gestion.tsx, llaman a
//                       `launchImageLibraryAsync` (galería). No hay una sola
//                       llamada a `launchCameraAsync` en el proyecto.
//   RECORD_AUDIO        venía en la plantilla de prebuild de Expo. No hay
//                       ninguna dependencia ni API de audio en la app.
//   SYSTEM_ALERT_WINDOW lo declara react-native para sus overlays de desarrollo
//                       (redbox). En release no pinta nada.
//
// Importaban porque salen en la ficha de Google Play como «Cámara», «Micrófono»
// y «Mostrar sobre otras apps»: una familia leería que la app puede usar la
// cámara y el micrófono de su hijo, y no es verdad.
//
// ⚠️ Si algún día se añade una pantalla que haga fotos con `launchCameraAsync`,
// hay que quitar CAMERA de esa lista o la llamada fallará en tiempo de ejecución.
//
// ---------------------------------------------------------------------------
// ORIENTACIÓN LIBRE (`orientation: "default"` en app.json)
// ---------------------------------------------------------------------------
// Mismo motivo para vivir aquí: app.json no admite comentarios.
//
// Estaba en `"portrait"`, y Play lo señala: «quita las restricciones de
// redimensionamiento y orientación para que sea compatible con pantallas
// grandes». Con `portrait`, el manifest sale con
// `android:screenOrientation="portrait"` y la app no gira ni se redimensiona,
// lo que en una tablet o en pantalla partida deja una franja vertical.
//
// `orientation` es una clave DE PRIMER NIVEL y no admite variante por
// plataforma (el esquema solo acepta `default`, `portrait` y `landscape`), así
// que esto desbloquea Android Y iOS. Es una decisión tomada: a Apple no le
// molesta, y mantener iOS en vertical habría exigido un config plugin propio
// para relajar solo el manifest de Android — más piezas para menos.
//
// ⚠️ LO QUE HAY QUE MIRAR EN DISPOSITIVO al girar, que es donde esto se rompe
// si se rompe: `ui/lineup-field.tsx` mide COORDENADAS DE VENTANA para el
// arrastrar y soltar (`fieldRectRef` / `benchRectRef`), y una rotación
// invalida esas medidas hasta que se vuelven a tomar. Los tres sitios que
// dependen del ancho están acotados —`Math.min(winW - 32, 420)` en
// lineup-field, 460 en play-field y `width - 64` en el gráfico del dashboard—
// así que en pantalla ancha no se estiran; el resto es flex y reflowea.
// ---------------------------------------------------------------------------
// LA VERSIÓN (`version` en app.json)
// ---------------------------------------------------------------------------
// Mismo motivo para vivir aquí: app.json no admite comentarios.
//
// `expo.version` es la ÚNICA fuente del nombre de versión para las DOS
// plataformas: sale como `CFBundleShortVersionString` en iOS y como
// `versionName` en Android. Cambiarlo aquí cubre las dos; no hay un sitio por
// plataforma que mantener.
//
// Y NO hay `ios.buildNumber` ni `android.versionCode` en app.json a propósito:
// eas.json lleva `cli.appVersionSource: "remote"` y `autoIncrement: true` en el
// perfil `production`, así que **el número de BUILD lo guarda y lo sube EAS
// solo**. El nombre de versión NO: ese es manual y es este.
//
// 1.0.0 → 1.0.1 el 07-10-2026 porque App Store Connect rechazó el build 9:
//
//   ITMS-90186  el tren de la 1.0.0 está cerrado
//   ITMS-90062  CFBundleShortVersionString debe ser mayor que la versión ya
//               aprobada, 1.0.0
//
// Una vez Apple APRUEBA una versión, ese tren se cierra y no acepta más builds
// para él: hace falta subir el nombre de versión, no solo el build.
//
// ⚠️ ANDROID NO LO EXIGE, y eso es justo lo que despista: Play solo pide un
// `versionCode` mayor —el que EAS ya incrementa—, así que un AAB sube bien con
// el `versionName` viejo. El «1.0.1» que se teclea al crear la release en Play
// es solo una ETIQUETA de la consola; lo que ven las familias en los ajustes del
// teléfono es el `versionName` del binario. O sea que el binario de Play estaba
// diciendo 1.0.0. Se arregla con este mismo cambio, sin tocar nada más.
//
// `apps/native/android/` es prebuild LOCAL y está en .gitignore: su
// `versionName` (0.1.0) es basura rancia que no lee nadie, y se regenera desde
// aquí. La app no PINTA su versión en ninguna pantalla (nada lee
// `expoConfig.version` ni `nativeApplicationVersion`), así que esto no cambia
// ninguna interfaz.

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    ...(process.env.EXPO_PUBLIC_SUPABASE_URL
      ? { supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL }
      : {}),
    ...(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
      ? { supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY }
      : {}),
    // O2-5 F1 — dominio de la web (route handlers de Next). Pública, no secreto.
    ...(process.env.EXPO_PUBLIC_WEB_URL
      ? { webUrl: process.env.EXPO_PUBLIC_WEB_URL }
      : {}),
  },
});
