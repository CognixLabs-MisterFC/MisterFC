// Babel para Expo SDK 57 + NativeWind v4.
// - babel-preset-expo con jsxImportSource "nativewind" para que className funcione.
// - preset "nativewind/babel" para la transformación de estilos.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
