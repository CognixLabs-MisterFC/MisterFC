# Iconos PWA

Los que declara el manifiesto (`packages/core/src/marketing-site/manifest.ts`):

- `icon-192.png` — 192×192 (pantalla de inicio de Android).
- `icon-512.png` — 512×512 (splash y tiendas de apps web).

Salen del icono de la app nativa (`apps/native/assets/icon.png`, 1024×1024), escalados.
Son cuadrados y opacos, sin esquinas: el manifiesto los declara `any maskable` y es
Android quien los recorta (círculo, squircle…). El dibujo cabe en la zona segura
central (círculo del 80 %), así que el recorte no se come nada.

Los iconos de la pestaña (`favicon.ico`, `icon.png`, `apple-icon.png`) viven en
`apps/web/src/app/`.
