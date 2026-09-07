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
