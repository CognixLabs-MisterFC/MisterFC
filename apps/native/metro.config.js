// Metro para Expo en MONOREPO pnpm + NativeWind v4.
// - watchFolders incluye la raíz del monorepo (para resolver @misterfc/core).
// - nodeModulesPaths cubre node_modules del paquete y de la raíz.
// - withNativeWind conecta el CSS de entrada (global.css).
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
