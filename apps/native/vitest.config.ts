import { defineConfig } from 'vitest/config';

// Tests unitarios de lógica PURA de la app nativa (p.ej. la redacción de Sentry
// en src/lib/sentry-redact.ts). Entorno Node: no cargamos el runtime de RN — los
// ficheros bajo test no importan @sentry/react-native ni módulos nativos.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
