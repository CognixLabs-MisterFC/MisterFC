# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar en su propio PR.

## Activas

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

## Resueltas

_(vacío todavía)_
