# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar en su propio PR.

## Activas

### Botón "Cerrar sesión" ausente en `/onboarding`
- **Detectado en**: 2026-05-28, al cierre de Fase 1.
- **Síntoma**: un usuario autenticado sin club queda atrapado en `/onboarding` sin forma evidente de cambiar de cuenta. El único camino es vaciar cookies o abrir incógnito.
- **Impacto**: bajo (afecta testing y casos edge), pero rompe el principio de "siempre poder salir".
- **Plan**: añadir botón de logout en el layout de `/onboarding` (o en un header global accesible incluso sin membership). Abordar en **Fase 2** junto al refactor multi-club.

### Sentry server-side no captura excepciones en producción
- **Detectado en**: 2026-05-28, debug de invitaciones en `feat/auth-email-password`.
- **Síntoma**: en Vercel logs sólo aparece `[sentry][edge-init]`, nunca `[sentry][server-init]`. Los errores lanzados desde server actions (p. ej. `inviteUserByEmail`) no llegan a Sentry.
- **Hipótesis a investigar**: `instrumentation.ts` no está cargando `sentry.server.config.ts`, o el runtime de server está corriendo en edge cuando debería ser Node, o el SDK no se inicializa por una env var faltante en el contexto server.
- **Relación**: emparentado con la entrada "Sentry no recibe eventos (SENTRY_PROJECT slug mismatch + DSN a verificar)" más abajo, pero distinto: ese habla del slug del proyecto; este habla de que el init server ni siquiera se ejecuta.
- **Plan**: abordar en **Fase 15 (observabilidad)** junto al setup de alertas. Hasta entonces los server errors sólo son visibles vía Vercel logs.

### Log `[invitations][invite-email]` no aparece tras el insert
- **Detectado en**: 2026-05-28, debug de invitaciones.
- **Síntoma**: el `console.log` con prefijo `[invitations][invite-email]` que debería aparecer tras el insert en la tabla `invitations` no se ve en Vercel logs. El insert sí ocurre.
- **Hipótesis**: el logging está colocado en una rama de código que no se alcanza, o el server action está siendo throttled/serializado de forma que el log se pierde, o está antes de un `throw` que el SDK de Sentry tampoco captura (ver entrada anterior).
- **Acción**: verificar la colocación del logging en `apps/web/src/app/.../invitations/actions.ts`. Está bloqueado por el problema de Sentry server-side (mismo síntoma, mismo runtime).
- **Plan**: **Fase 15** junto con el fix de Sentry server.

### Email rate limit de Supabase free (HTTP 429) bloquea testing
- **Detectado en**: 2026-05-28, durante el testing de signup/invitaciones de Fase 1.
- **Síntoma**: el SMTP integrado de Supabase impone ~2-4 emails/hora en el plan free. Signup, invitaciones y reset password fallan con HTTP 429 al superarlo.
- **Mitigación temporal**: desactivar "Confirm email" en Supabase Auth Settings durante testing local + esperar a que se resetee el contador antes de continuar.
- **Solución definitiva**: SMTP propio (Brevo o Resend). Tracked como subfase **F16.0** en `plan-maestro.md`.
- **Plan**: convivir con la limitación durante F2–F15; resolver al arrancar **Fase 16** antes de invitar al primer club.

### Ventana de deploy mismatch al aplicar migraciones de RLS antes del merge
- **Detectado en**: 2026-05-27 ~15:48 UTC, durante el fix de Bug 1 (clubs INSERT RLS).
- **Observado**: tras la merge del PR #4 a las 15:48:29 UTC, Postgres logs muestran un INSERT en clubs fallido — el último intento de un user antes de que Vercel terminara de redesplegar el código actualizado.
- **Causa raíz**: el patrón de trabajo de Fase 1 aplica las migraciones al remoto **antes** de mergear el PR (vía `pnpm db:push` desde la rama feature). Eso significa que entre el momento en que la migración cambia el schema/policies y el momento en que Vercel redespliega el código nuevo, hay una ventana (típicamente 1–3 min tras el merge) en la que:
  - La BD remota tiene las **policies/funciones nuevas**.
  - El runtime de Vercel sigue corriendo el **código viejo**.
  - Cualquier user que ejecute un flow afectado en esa ventana ve un error que ya no se reproducirá después.
- **Caso concreto observado**: policy nueva `clubs_insert_forbidden` ya activa + código viejo de `/onboarding` haciendo `INSERT INTO clubs` directo → "new row violates row-level security policy for table clubs".
- **Impacto**: efímero (ventana de minutos), pero confuso al diagnosticar porque el error ya no se reproduce tras el redeploy.
- **Mitigaciones a evaluar**:
  - **(a)** Aplicar migraciones tras el merge, no antes — pero implica perder el ciclo "aplica + valida + commit" que da feedback rápido.
  - **(b)** En migraciones que cambien policies de forma estricta, mantener una versión transitoria que acepte ambos flows (viejo y nuevo) durante una ventana, y endurecer en una segunda migración posterior. Sobreingenieril para un proyecto en una sola región Vercel.
  - **(c)** Banner de mantenimiento en /onboarding y /invitations durante el rollout de migraciones críticas (RLS). Es lo más realista para Fases con bajo tráfico.
  - **(d)** Aceptar la ventana y comunicarla: en Fase 1 (beta cerrada con 1 club) el riesgo es mínimo. Documentar el patrón y avisar antes de cada rollout de migración estricta.
- **Plan**: por ahora aceptar y documentar (opción d). Revisar al cerrar Fase 14 (Beta cerrada con primer club) o cuando el tráfico justifique más complejidad.

### Onboarding action podría ejecutarse con memberships ya existentes (race)
- **Detectado en**: 2026-05-27, análisis del Bug 1.
- **Escenario hipotético**: user abre `/onboarding` (no memberships → página renderiza form), en paralelo abre otra pestaña con `/invite/{token}` y acepta una invitación (crea membership). Vuelve a la primera pestaña y submite el form. La página ya no se re-renderiza (estamos en post-submit), así que el action `createClub` se ejecuta a pesar de que ahora SÍ tiene membership.
- **Estado actual**: la función `create_club_with_admin` raise `already_in_a_club`, el action lo mapea a `error: 'already_in_a_club'` y el form lo muestra. Funciona, no es un bug bloqueante.
- **Posible mejora**: redirigir a `/` desde el action cuando vea `already_in_a_club` en vez de mostrar el error, ya que el user ya está dentro. Coste 5 minutos.
- **Plan**: arreglar en Fase 2 cuando refactoricemos el flow multi-club.

### Next.js 16 — deprecación de `middleware.ts` a favor de `proxy.ts`
- **Detectado en**: Fase 0 (subfase 0.5).
- **Mensaje**: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
- **Impacto**: solo warning de build, no rompe. La convención cambia de nombre en Next.js 16+; la API es la misma.
- **Plan**: renombrar `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts` en una subfase futura cuando next-intl haya actualizado sus docs/ejemplos a la nueva convención, para no divergir innecesariamente.

### Sentry no recibe eventos (SENTRY_PROJECT slug mismatch + DSN a verificar)
- **Detectado en**: 2026-05-28, durante el debug de `feat/auth-email-password`. El proyecto `mister-fc/javascript-nextjs` en sentry.io muestra "Get Started" — cero eventos recibidos desde el deploy de Fase 1, a pesar de varios `Sentry.captureException` ejecutados en producción (action de invitaciones, Bug 1, Bug 2 logging).
- **Causa raíz probable**:
  - **(1)** Slug del proyecto en sentry.io es `javascript-nextjs` (no `misterfc-web` como decía `.env.example`). Afecta SOLO al upload de source maps via `withSentryConfig` — los eventos en sí los enruta el DSN, no `SENTRY_PROJECT`. Pero si `SENTRY_PROJECT=misterfc-web` (slug inexistente), Vercel logs durante el build muestran fallo de upload de source maps que se confunde con fallo de captura.
  - **(2)** `NEXT_PUBLIC_SENTRY_DSN` puede estar vacío o apuntar a un proyecto distinto en Vercel Production. Verificar en Vercel UI: env var debe estar en *All Environments* (no solo Development) y debe coincidir con el DSN que aparece en `sentry.io → Settings → Projects → javascript-nextjs → Client Keys (DSN)`.
  - **(3)** Cualquier cambio en env var requiere **redeploy** en Vercel; las env vars NO se aplican en caliente al runtime.
- **Fix aplicado en este PR**:
  - `apps/web/sentry.{server,edge,client}.config.ts`: logging diagnóstico tras `Sentry.init`. Si el SDK se inicializa, aparece `[sentry][server-init] initialized { dsn_present: true, ... }` en Vercel logs al boot del runtime. Si el DSN falta, aparece `[sentry][server-init] NEXT_PUBLIC_SENTRY_DSN missing …` como `console.error`, grepeable de inmediato.
  - `apps/web/.env.example`: `SENTRY_PROJECT` actualizado a `javascript-nextjs` con comentario sobre por qué.
- **Acción pendiente del responsable** (no es código):
  1. En Vercel → Settings → Environment Variables del proyecto: verificar que `NEXT_PUBLIC_SENTRY_DSN` exista, esté marcada para *Production* y coincida exactamente con el DSN del proyecto `javascript-nextjs` en sentry.io.
  2. Verificar `SENTRY_PROJECT` en Vercel: debe ser `javascript-nextjs`. Actualizar si está `misterfc-web`.
  3. Redeploy en Vercel Production tras cambiar env vars.
  4. Tras el deploy, en Vercel logs buscar la línea `[sentry][server-init]` para confirmar que el SDK inicializó.
  5. Probar generar un error real (ej. invitar a un email inválido a propósito) y comprobar que llega a sentry.io en <1 min.

### Formato pre-existente del repo no pasa `pnpm format:check`
- **Detectado en**: 2026-05-28, durante el PR de `feat/auth-email-password` (ADR-0004). Al correr `pnpm format` el script reformateó ~17 archivos que ya estaban en `main` y que no formaban parte del cambio: `README.md`, varias páginas y actions de F1 (`onboarding/*`, `invitations/invite-form.tsx`, `page.tsx`), `_bootstrap/plan-maestro.md`, `docs/journey/*.md`, ADRs 0002/0003, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/core/src/auth/current-user.ts`, `packages/core/src/supabase/database.ts`, `apps/web/public/sw.js`, `docs/architecture/supabase-cli-without-link.md`.
- **Causa raíz**: el repo no tiene husky pre-commit ni `pnpm format:check` en CI, así que cambios merged desde Fase 0 y Fase 1 acumularon formato inconsistente. Prettier 3 normaliza al ejecutar `--write`.
- **Impacto**: no rompe build ni CI actual (CI solo corre typecheck/lint/build). Sí incomoda cualquier futuro PR cuyo autor corra `pnpm format` localmente y termine con diff espurio.
- **Plan**:
  - PR aparte tipo `chore: pnpm format global tras Fase 1` que aplique prettier a todo el árbol sin mezclar con feature.
  - Opcional: añadir `pnpm format:check` al workflow CI (`.github/workflows/ci.yml`) para que cualquier desviación bloquee merge.
  - Opcional: habilitar husky pre-commit con `lint-staged` para formato/lint incremental por commit.

## Resueltas

_(vacío todavía)_
