# ADR-0020 — Ola 2: app nativa con Expo + EAS Build

- **Status**: Accepted
- **Date**: 2026-07-28
- **Deciders**: Iker Milla
- **Related**: ADR-0003 (Monorepo + Ola 2 RN — concreta la elección "Expo vs bare RN" que aquella dejó explícitamente pendiente), ADR-0010 (Web Push Ola 1 con limitación iOS — su roll-forward a APNs/FCM nativos se materializa aquí), ADR-0004 (Email + contraseña como método de autenticación), [plan-maestro.md §7 Ola 2](../journey/plan-maestro.md).

## Context

MisterFC es hoy **web-only**: `apps/web` (Next.js App Router) es una PWA instalable en iPad, Android y desktop; **no existe app nativa en el repo** (ni `apps/native`, ni proyecto Expo, ni `eas.json`). Ola 2 consiste en **construir la app nativa** para App Store y Google Play, reutilizando `packages/core` como manda ADR-0003.

Estado base sobre el que se decide: `main` #399, con la auditoría pre-producción hecha y el smoke del circuito de jugadores cerrado. ADR-0003 ya fijó "React Native + Reanimated 3 + gesture-handler" pero **dejó sin decidir Expo vs bare RN** ("se documentará en su propio ADR cuando se aborde Ola 2"); este ADR es ese registro y toma el resto de decisiones de arranque de Ola 2.

Restricciones que condicionan la decisión:

- La máquina de desarrollo es un **Chromebook, sin Mac** → no se puede compilar iOS en local.
- La app maneja **datos de menores y datos médicos** → la persistencia de sesión debe ser segura.
- El stack de backend/infra ya en uso (Supabase, Stripe, Firebase, Sentry) debe seguir soportado.
- Constitución de **Cognix Labs, S.L.** en curso: necesaria para abrir cuentas de organización en las stores, pero **no** para desarrollar ni compilar.

Este ADR registra decisiones **ya tomadas**. No reabre alternativas ya descartadas en ADR-0003 (Capacitor, Flutter, PWA pura).

## Decision

**Construir la app nativa de Ola 2 con Expo + EAS Build, como app genérica de marca MisterFC que se AÑADE a la web (no la sustituye), con el tema de cada club leído de base de datos, login email+contraseña, y offline de solo lectura.**

### Decisión 1 · Stack: Expo + EAS Build

React Native gestionado con **Expo**, compilado en la nube con **EAS Build**. Motivos: la máquina de desarrollo es un Chromebook sin Mac, y EAS compila iOS y Android en la nube sin necesidad de hardware Apple local; el stack (Supabase/Stripe/Firebase/Sentry) está soportado por Expo; y el rendimiento es equivalente a bare RN gracias a la Nueva Arquitectura.

Complementos decididos:

- **expo-router** — enrutado por ficheros, alinea con el App Router de la web.
- **expo-secure-store** — persistencia de la sesión en el almacén seguro del dispositivo, exigido por el tratamiento de datos de menores y datos médicos.
- **NativeWind** pineado por major.

### Decisión 2 · La app SE AÑADE, NO sustituye

La web sigue **viva y completa para todos los roles, sin excepción**.

- Para **cuerpo técnico y dirección**, la app es un **subconjunto** de la web (pantallas de campo): toda pantalla de la app existe también en web.
- Para **familias y seguidores**, la app cubre el **100 %**, **pero su web NO se retira**.

La retirada de la web de familias/seguidores queda **fuera de Ola 2** y solo ocurrirá cuando el product owner lo decida expresamente, con la app publicada en store y testeada. **Ninguna fase de Ola 2 la contempla.**

### Decisión 3 · Identidad de la app

Una app **genérica** en las stores: nombre **"MisterFC"**, `bundleIdentifier` y `package` **`com.misterfc.app`**, `scheme` **`misterfc`**. El icono de store es el de MisterFC para todos los clubs.

El **tema del club** (escudo, colores, nombre) se lee de **base de datos**, nunca hardcodeado, para no cerrar la puerta al **white-label por club** (app propia por club) como producto futuro, pendiente de evaluar costes.

Nota: el escudo del club en el escritorio del móvil ya es posible hoy instalando `misterfc.es/{slug}` como PWA.

### Decisión 4 · Entrada y club activo

**Login email + contraseña** (coherente con ADR-0004). El club se resuelve **tras el login** por las `memberships` del usuario; **no hay puerta por slug** en la app.

Si el usuario pertenece a más de un club: entra directo al **último club usado**, y el **cambio de club** es un selector **siempre accesible en la cabecera**.

### Decisión 5 · Offline = SOLO LECTURA

Sin cobertura se puede **leer lo ya descargado** (convocatoria, alineación, plantilla, sesión del día, ficha). Toda **escritura** (asistencia, alineación, directo, mensajes) **exige conexión** y muestra un aviso claro de "sin conexión".

**No hay cola de sincronización ni resolución de conflictos.** Motivo: guardar-y-sincronizar es la mayor fuente de bugs en apps de campo y aún no hay evidencia de uso real que lo justifique.

### Decisión 6 · Modelo de roles (corregido por el censo del repo)

Roles de club **reales: 6** → `admin_club`, `director`, `coordinador`, `entrenador_principal`, `entrenador_ayudante`, `jugador`.

- **superadmin** = flag de plataforma, **no** rol de club.
- **delegado** = `team_staff_role`; a nivel de club **colapsa a `entrenador_ayudante`**.
- **familiar/tutor** = **no es rol**; es la cuenta `jugador` operada vía `player_accounts`.
- **seguidor** = spectator, con carcasa y navegación aparte.

En el menú, `entrenador_principal` y `entrenador_ayudante` **proyectan lo mismo**; sus diferencias viven en capabilities y RLS dentro de las páginas.

### Decisión 7 · Cobertura por banda

Cobertura de la app por banda de rol:

- **Familias (jugador/tutor) y seguidores**: **100 %** en app.
- **Cuerpo técnico (principal, ayudante, delegado, coordinador)**: **~80 %**.
- **Dirección (admin_club, director)**: **~50 %**.
- **Superadmin (`/platform`)**: **0 %**, nunca en app.

> **PENDIENTE (a aportar por el product owner)**: la **lista cerrada de pantallas APP/WEB** que concreta estas bandas se reproducirá **literal** en esta sección, sin reordenar ni completar. No se ha inventado aquí. Ver "Discrepancias detectadas".

### Decisión 8 · `packages/core` es la base

El censo confirma que `packages/core` es **~100 % reutilizable**: cero imports de `react`/`next`/DOM, solo `@supabase/*` y `zod`, 18 módulos de dominio con tests. Único ajuste: **inyectarle el adaptador de sesión de React Native**. La lógica **no se duplica** entre web y app; vive en core.

### Decisión 9 · Deuda previa al porte

El censo detectó **10 rutas sin gate de rol explícito**, que hoy se apoyan solo en RLS y en el **redirect del servidor de Next**: `/formaciones`, `/calendario`, `/directos`, `/directos/[eventId]`, `/directos/seguir`, `/equipos/[teamId]`, `/equipos/[teamId]/anuncios`, `/equipos/[teamId]/staff/[membershipId]/capabilities`, `/jugadores/[playerId]`, `/convocatorias/[eventId]/estadisticas`.

En nativo **no existe ese redirect**. Se **auditan ANTES** de portar pantallas.

### Fases de Ola 2

- **O2-0** — andamiaje + primer EAS build (APK preview instalable, pantalla vacía)
- **O2-1** — auth + club activo + selector de club + tema del club desde BD
- **O2-2** — navegación por rol + capa de datos + caché de lectura + aviso sin conexión
- **O2-3** — auditoría de las 10 rutas sin gate explícito
- **O2-4** — push FCM v1 + deep links (incluido arranque en frío) + enlaces de email
- **O2-5** — familias
- **O2-6** — seguidores
- **O2-7** — campo A: asistencia y convocatorias
- **O2-8** — campo B: alineación
- **O2-9** — campo C: directo + entrada rápida + post-partido
- **O2-10** — cuerpo técnico, resto de la banda 80 %
- **O2-11** — dirección, banda 50 %
- **O2-12** — pulido: i18n es/en/va, Sentry activo, iconos/splash, assets de store, QA
- **O2-13** — submit (bloqueado por constitución de la S.L.)

## Consequences

- **Positivas**:
  - Compilación iOS + Android en la nube sin Mac (EAS), viable desde el Chromebook.
  - Sesión en almacén seguro (expo-secure-store), acorde al tratamiento de datos de menores/médicos.
  - Sin reescritura de lógica: la app reusa `packages/core` tal cual; la lógica no diverge entre superficies.
  - Push nativo fiable (FCM/APNs) que resuelve la limitación iOS de la PWA registrada en ADR-0010.
  - La puerta al white-label por club queda abierta sin deuda: el tema se lee de BD desde el día uno.

- **Negativas**:
  - **Dos superficies vivas** (web + app) para staff y dirección → la lógica **debe** vivir en `packages/core` obligatoriamente; cualquier regla que se cuele en `apps/web` rompe la promesa.
  - Offline de solo lectura: sin cobertura no se puede registrar en campo (asistencia/directo), asumido a cambio de no cargar con guardar-y-sincronizar.
  - Deuda a saldar antes de portar: 10 rutas dependen del redirect de Next, inexistente en nativo (Decisión 9).
  - Dependencia de EAS (servicio gestionado) para builds.

- **Neutras**:
  - **Bloqueante solo del submit final** (O2-13): la constitución de **Cognix Labs, S.L.** para abrir cuentas de organización en App Store ($99/año) y Google Play ($25 único). **No bloquea** el desarrollo ni la generación del AAB/APK.
  - La web de familias/seguidores permanece; su eventual retirada es una decisión futura del PO, fuera de este ADR.

## Alternatives considered

- **Bare React Native (sin Expo)**: mismo runtime y rendimiento (Nueva Arquitectura), pero exige gestionar toolchain nativa y **compilación iOS en Mac** — inviable en un Chromebook sin hardware Apple. Descartado frente a EAS Build en la nube.
- **Wrapper de la PWA (Capacitor)**: ya descartado en ADR-0003 por capar la calidad de las pantallas de campo (F7 toma de datos, F12 pizarra) sobre WebView en hardware modesto. No se reabre.
- **Offline con cola de sincronización y resolución de conflictos**: mayor fuente de bugs en apps de campo; sin evidencia de uso real que lo justifique todavía. Se opta por offline de **solo lectura** (Decisión 5).
- **App por club / white-label desde el inicio**: multiplicaría builds, identidades de store y coste operativo sin validación de demanda. Se opta por **una app genérica** con tema desde BD, dejando el white-label como producto futuro a evaluar (Decisión 3).
- **Puerta por slug en la app** (equivalente a `misterfc.es/{slug}` en web): innecesaria en nativo, donde el club se deriva de las `memberships` tras el login; se descarta a favor del selector de club en cabecera (Decisión 4).

## Discrepancias detectadas

Anotadas, **no corregidas** (este ADR es solo documentación de Ola 2):

1. **Lista literal de pantallas APP/WEB (Decisión 7) no aportada**: el mensaje de decisión referencia una "lista cerrada" que debía pegarse pero no se incluyó. Se ha dejado la sección con las **bandas de cobertura** (100/80/50/0) y un marcador **PENDIENTE**; no se ha inventado el detalle por pantalla. Debe completarla el product owner.
2. **Índice de ADRs incompleto** ([docs/decisions/README.md](README.md)): la tabla del índice **omite las filas ADR-0007 … ADR-0013** (los ficheros existen en `docs/decisions/`). Este ADR añade únicamente su propia fila (0020); no rellena las ausentes para no exceder su alcance.
3. **ADR-0003 y §7 del plan-maestro** describían Ola 2 como "React Native" con una única propuesta `O2.1` y estimación 50–70 h / 18–25 sesiones. Este ADR **concreta** el stack (Expo+EAS) y **desglosa** las fases O2-0…O2-13. No se reabre ADR-0003 (inmutable); el plan-maestro se actualiza para reflejar el desglose sin inventar horas por fase.
