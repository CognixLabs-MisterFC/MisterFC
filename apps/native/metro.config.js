// Metro para Expo en MONOREPO pnpm + NativeWind v4 + Sentry.
// - getSentryExpoConfig envuelve el default de Expo para generar los sourcemaps
//   con Debug IDs (imprescindible para que la subida a Sentry case el bundle con
//   su mapa). Devuelve la misma forma que getDefaultConfig, así que el resto de
//   ajustes del monorepo se aplican igual encima.
// - watchFolders incluye la raíz del monorepo (para resolver @misterfc/core).
// - nodeModulesPaths cubre node_modules del paquete y de la raíz.
// - withNativeWind conecta el CSS de entrada (global.css).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
