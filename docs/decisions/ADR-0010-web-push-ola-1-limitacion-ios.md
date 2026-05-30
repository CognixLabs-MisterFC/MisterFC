# ADR-0010 — Web Push en Ola 1 PWA con limitación iOS, push nativo en Ola 2

- **Status**: Accepted
- **Date**: 2026-05-30
- **Deciders**: Iker Milla
- **Related**: F5 (Mensajería y notificaciones push), [plan-maestro.md §Fase 5](../journey/plan-maestro.md), spec `docs/specs/5.0-mensajeria-push.md`, ADR-0003 (monorepo + Ola 2 React Native).

## Context

F5 introduce notificaciones push reales (no solo filas `notifications.channel='push'` como hizo F4). En una PWA hay dos caminos para lograrlo:

1. **Web Push API + VAPID** (estándar W3C). Funciona en Chrome, Firefox, Edge desktop y Android sin requisitos extra. En iOS Safari solo funciona si **se cumplen dos condiciones**: la PWA está instalada en la pantalla de inicio (Añadir a inicio) **Y** iOS ≥ 16.4. iOS 15-16.3 no soporta Web Push en absoluto. iOS 16.4+ tampoco lo soporta si la página se abre en Safari normal sin instalar.

2. **Push nativo (APNs)** usando un wrapper Capacitor/Cordova alrededor de la PWA, o moviendo a app nativa React Native con Firebase/APNs reales.

Ambos tienen contras. Web Push tiene la limitación iOS conocida y comunicable. APNs vía wrapper duplica el stack (PWA + wrapper) sin entregar valor adicional al usuario Android. La app React Native completa es el target real, pero entra en Ola 2 (ADR-0003).

En la beta del primer club:

- ~70% de los clubs amateurs reales operan con Android mayoritario (entrenadores y padres). El push nativo Android cubre el caso con Web Push estándar sin requisitos extra.
- El subconjunto iOS suele coincidir con la directiva del club (presidente, tesorero) más que con la operativa diaria (entrenadores, jugadores). Aceptable que reciban el push tras instalar la PWA (acción de 30 segundos que ya hacen para tenerla a mano).
- La alternativa "esperar a Ola 2 para tener push en todos" deja a la beta sin un componente crítico de UX (mensaje del coach a la familia a las 22h) durante meses.

## Decision

**Adoptar Web Push API + VAPID en Ola 1**, aceptando explícitamente la limitación iOS Safari (requiere PWA instalada + iOS 16.4+).

Implementación:

1. **VAPID keys** generadas con `npx web-push generate-vapid-keys`. Public en `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private en `VAPID_PRIVATE_KEY` (server only, Vercel encrypted).
2. **Tabla `push_subscriptions`** (one row per user × device).
3. **Service worker existente extendido** con handler `push` y `notificationclick`. Sin librerías terceras de SW.
4. **Detección de capacidades en cliente** y banner honesto en `/perfil/notificaciones` cuando el navegador no soporta push (típicamente iOS Safari sin PWA instalada).
5. **No empaquetamos un wrapper Capacitor en Ola 1**. Si en Ola 1 el feedback del piloto exige push iOS nativo antes de Ola 2, se reabre.

## Why not the alternatives

- **APNs vía wrapper Capacitor en Ola 1**: añade un build extra, requiere cuenta Apple Developer ahora, duplica configuración de notificaciones, y desbloquea push iOS sin instalación pero con un coste de mantenimiento desproporcionado para 1 club piloto. Mejor empujar a Ola 2 que ya es React Native completa.
- **Web Push + service worker custom complejo (Firebase Cloud Messaging, OneSignal)**: añaden vendor lock-in y datos del user salen a tercero (RGPD añade riesgo). VAPID puro es estándar W3C, sin tercero, con sólo `web-push` npm para enviar.
- **Esperar a Ola 2**: la mensajería de F5 pierde la mayor parte de su valor sin push (mensaje sin notificación es ruido). Aceptable diferir UI avanzada de chat, no push.

## Consequences

**Positivas**:
- Push real en Chrome, Firefox, Edge desktop + Android desde Ola 1 (cubre >80% del piloto).
- Sin librerías terceras ni vendor lock-in.
- Bases técnicas (VAPID, SW push handler) reutilizables conceptualmente en Ola 2 cuando se sustituyan por APNs/FCM nativos.

**Negativas**:
- iOS Safari sin PWA instalada: sin push. Comunicado honestamente en UI.
- Endpoint de un push puede expirar (browser update). El cron drainer (ADR-0011) detecta 410 Gone y borra la subscription; el user vuelve a suscribirse al activar push en `/perfil/notificaciones`.
- Sin métricas de "delivered" estándar (Web Push devuelve 201 cuando el server FCM/APNs acepta, no cuando el usuario realmente ve el push). Aceptable en Ola 1, no construimos analytics de push.

**Roll-forward a Ola 2**:
- Ola 2 (React Native) sustituye Web Push por APNs (iOS) + FCM (Android) nativos. La tabla `push_subscriptions` cambia su shape (`endpoint`+`p256dh`+`auth` → `device_token`+`platform`); migración aditiva, no destructiva.
- `notification_preferences` se reusa tal cual (modelo agnóstico a transport).
