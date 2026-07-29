/** @type {import('tailwindcss').Config} */
// NativeWind v4 exige Tailwind v3 (peer tailwindcss > 3.3.0) + su preset.
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
