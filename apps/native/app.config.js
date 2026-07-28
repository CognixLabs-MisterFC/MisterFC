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
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? null,
  },
});
