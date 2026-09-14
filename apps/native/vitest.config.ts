import { defineConfig } from 'vitest/config';

// Tests unitarios de lógica PURA de la app nativa (p.ej. la redacción de Sentry
// en src/lib/sentry-redact.ts). Entorno Node: no cargamos el runtime de RN — los
// ficheros bajo test no importan @sentry/react-native ni módulos nativos.
//
// El alias '@' es el mismo que resuelven Metro y tsconfig. Hace falta para poder
// probar módulos que importan por ruta absoluta (p.ej. `@/data/public-clubs`,
// que importa `@/lib/report-error`) y para que `vi.mock('@/…')` case con el
// especificador real del import.
export default defineConfig({
  resolve: {
    alias: {
      // `.pathname` y no `fileURLToPath`: el tsconfig de la app trae los libs de
      // DOM, así que `URL` resuelve al tipo del DOM y no al de node — y
      // `fileURLToPath` rechaza ese otro `URL` en typecheck.
      //
      // `decodeURIComponent` porque `.pathname` viene PERCENT-ENCODED: en un checkout
      // cuya ruta lleve un espacio ("Claude Code") el alias apuntaba a
      // `/…/Claude%20Code/…`, que no existe, y cualquier test que importara por `@`
      // moría con "Cannot find module". No se veía porque hasta R-3 ningún test usaba
      // el alias, y en CI la ruta no tiene espacios.
      '@': decodeURIComponent(new URL('./src', import.meta.url).pathname),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
