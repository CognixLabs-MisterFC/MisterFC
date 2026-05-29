# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar en su propio PR.

## Activas

### F2.7 — Capabilities cross-team: cualquier principal del club puede modificar caps de cualquier ayudante
- **Detectado en**: 2026-05-28, implementación de F2.7 (UI de capabilities del ayudante).
- **Síntoma**: la policy `capabilities_update` (F1.7) acepta a admin/coord/principal del **club** sin filtrar por equipo. Un entrenador principal del Equipo A puede modificar las caps de un ayudante asignado únicamente al Equipo B.
- **Causa**: la tabla `capabilities` es por `membership_id` (a nivel club), no por `(membership, team)`. La policy no tiene cómo distinguir "principal de qué equipo".
- **Impacto actual**: bajo. En la beta del primer club (un solo equipo activo en F16 según plan) el problema no se materializa.
- **Mitigación temporal**: el server action `toggleCapability` chequea membership.role pero NO chequea pertenencia por equipo. La RLS sigue siendo la autoridad.
- **Plan de endurecimiento**: cuando el primer club opere con ≥2 equipos cuyos principales sean personas distintas:
  - Refactor del modelo: añadir `team_id` a `capabilities` (o tabla puente `team_capabilities`) y recomputar al asignar/quitar staff.
  - O alternativa más simple: cambiar la policy para exigir que el principal sea el mismo del team activo del ayudante (vía `team_staff` introducido en F2.6).
- **Plan**: abordar en **F11** o antes si surge necesidad. Spec recoge la limitación (`docs/specs/2.7-capabilities-ui.md` §8).

### InviteStaffDialog — el form no resetea estado entre invitaciones consecutivas
- **Detectado en**: 2026-05-29, cierre de F2 (revisión post-lote-D).
- **Síntoma**: al invitar a un segundo miembro del staff sin cerrar el dialog, el banner del envío anterior sigue visible y los inputs no se limpian.
- **Causa**: `useActionState` retiene el último estado; el componente no escucha el `success` para limpiar fields ni cerrar el dialog.
- **Impacto**: UX, no funcional. La invitación se envía correctamente.
- **Plan**: pulido en un sub-task de F3 o cuando se vuelva a tocar `/equipos/[teamId]`. ≤30 min de trabajo.

### CSV import — funcionalidades fuera de alcance (F2.9)
- **Detectado en**: 2026-05-29, spec 2.9 §3 "Fuera de alcance".
- **Síntoma**: el wizard de `/plantilla/importar` no soporta: `medical_notes` (sensible), fotos, vinculación tutor (`player_accounts`), update masivo, asignación a múltiples equipos, mapping de columnas configurable.
- **Razonado**: dato sensible (medical), flujo individual mejor (fotos/tutor), conflicto operativo (update masivo desde CSV), complejidad UI (mapping).
- **Plan**: decidir al cerrar Ola 1 si Ola 2 (app nativa) incorpora alguna. Si una sale necesaria antes (típicamente "update masivo del dorsal por temporada"), abrir spec aparte y meter en F11 o F12.

### Email rate limit de Supabase free (HTTP 429) bloquea testing
- **Detectado en**: 2026-05-28, durante el testing de signup/invitaciones de Fase 1.
- **Síntoma**: el SMTP integrado de Supabase impone ~2-4 emails/hora en el plan free. Signup, invitaciones y reset password fallan con HTTP 429 al superarlo.
- **Confirmado en F2**: durante el debug del bug de invitation accept flow (PR #15) el rate limit bloqueó pruebas reales por email. Workaround usado: aceptar invitaciones vía token directo de tabla `public.invitations` + Confirm email OFF en Supabase Auth Settings.
- **Solución definitiva**: SMTP propio (Brevo o Resend). Tracked como subfase **F16.0** en `plan-maestro.md`.
- **Plan**: convivir con la limitación durante F3–F15; resolver al arrancar **Fase 16** antes de invitar al primer club.

### Ventana de deploy mismatch al aplicar migraciones de RLS antes del merge
- **Detectado en**: 2026-05-27 ~15:48 UTC, durante el fix de Bug 1 (clubs INSERT RLS).
- **Observado**: tras el merge del PR #4 a las 15:48:29 UTC, Postgres logs muestran un INSERT en clubs fallido — el último intento de un user antes de que Vercel terminara de redesplegar el código actualizado.
- **Causa raíz**: el patrón de trabajo aplica las migraciones al remoto **antes** de mergear el PR. Entre el momento en que la migración cambia el schema/policies y el momento en que Vercel redespliega el código nuevo hay una ventana (típicamente 1–3 min) en la que la BD tiene la lógica nueva y el runtime el código viejo.
- **Impacto**: efímero, confuso al diagnosticar porque el error no se reproduce tras el redeploy.
- **Plan**: por ahora aceptar y documentar. Revisar al cerrar Fase 14 (Beta cerrada con primer club) o cuando el tráfico justifique más complejidad.

### Onboarding action podría ejecutarse con memberships ya existentes (race)
- **Detectado en**: 2026-05-27, análisis del Bug 1.
- **Escenario hipotético**: user abre `/onboarding` y en paralelo otra pestaña acepta una invitación (crea membership). Vuelve a la primera y submite el form. La función `create_club_with_admin` raise `already_in_a_club`, el action lo mapea y el form lo muestra.
- **Estado tras F2**: F2 no tocó este flow directamente. Sigue funcionando vía error tipado, no es bloqueante.
- **Posible mejora**: redirigir a `/` desde el action cuando vea `already_in_a_club`. Coste 5 minutos.
- **Plan**: arreglar cuando se vuelva a tocar `/onboarding` (probable: F3 al introducir la primera "creación de evento" cross-club).

### Next.js 16 — deprecación de `middleware.ts` a favor de `proxy.ts`
- **Detectado en**: Fase 0 (subfase 0.5). Sigue activo tras F2 (el warning aparece en cada build).
- **Mensaje**: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
- **Impacto**: solo warning de build, no rompe. La convención cambia de nombre en Next.js 16+; la API es la misma.
- **Plan**: renombrar `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts` cuando next-intl haya actualizado sus docs/ejemplos a la nueva convención, para no divergir innecesariamente.

### Sentry — slug del proyecto (`SENTRY_PROJECT`) requiere verificación operativa en Vercel
- **Detectado en**: 2026-05-28, durante el debug de `feat/auth-email-password`.
- **Estado tras F2**: el SDK server inicializa correctamente (validado en PR #11/#12 — logs `[sentry][server-init]` aparecen y los `Sentry.captureException` desde server actions llegan al dashboard, confirmado durante el debug del accept flow en PR #15). Sigue pendiente la parte operativa:
  - `NEXT_PUBLIC_SENTRY_DSN` en Vercel Production debe apuntar al DSN del proyecto correcto.
  - `SENTRY_PROJECT` debe ser `javascript-nextjs` para que el upload de source maps funcione.
  - Cualquier cambio en env vars requiere **redeploy**.
- **Plan**: revisar al cerrar **F15 (observabilidad)** junto con el setup de alertas. Hasta entonces, verificación manual cuando se sospeche.

### Formato pre-existente del repo no pasa `pnpm format:check`
- **Detectado en**: 2026-05-28, durante el PR de `feat/auth-email-password` (ADR-0004).
- **Causa raíz**: el repo no tiene husky pre-commit ni `pnpm format:check` en CI; cambios merged desde Fase 0 y Fase 1 acumularon formato inconsistente.
- **Impacto**: no rompe build ni CI actual. Incomoda cualquier futuro PR cuyo autor corra `pnpm format` localmente y termine con diff espurio.
- **Plan**:
  - PR aparte tipo `chore: pnpm format global tras Fase 2` que aplique prettier a todo el árbol sin mezclar con feature.
  - Opcional: añadir `pnpm format:check` al workflow CI (`.github/workflows/ci.yml`).
  - Opcional: husky pre-commit con `lint-staged`.

## Resueltas

### Botón "Cerrar sesión" ausente en `/onboarding` — resuelto en F2.0 (PR #10)
- **Detectado en**: 2026-05-28, al cierre de Fase 1.
- **Síntoma**: un usuario autenticado sin club quedaba atrapado en `/onboarding` sin forma evidente de cambiar de cuenta.
- **Fix**: `/onboarding` queda fuera del route group `(authenticated)` y usa `OnboardingShell` con header minimal (brand + `LogoutButton`). El server action `signout` limpia también la cookie `active_club_id`.

### Sentry server-side no captura excepciones — resuelto en PR #11 + validado en PR #12 (2026-05-28)
- **Detectado en**: 2026-05-28, debug de invitaciones en `feat/auth-email-password`.
- **Síntoma**: en Vercel logs sólo aparecía `[sentry][edge-init]`, nunca `[sentry][server-init]`. Errores de server actions no llegaban a Sentry.
- **Fix**: PR #11 corrigió la carga del `sentry.server.config.ts` desde `instrumentation.ts` (runtime hint correcto) y PR #12 validó en producción que las `Sentry.captureException` desde server actions llegan al dashboard. El log `[invite][accept]` añadido en PR #15 confirmó retrospectivamente que el flujo es ahora observable end-to-end.
- **Pendiente residual**: la verificación de slug y DSN sigue en "Activas" como ítem operativo (no técnico).

### Log `[invitations][invite-email]` no aparece — superseded por la instrumentación de PR #15 (2026-05-29)
- **Detectado en**: 2026-05-28, debug de invitaciones.
- **Resolución**: la observabilidad del flujo entero de invitaciones se rehízo en PR #15 con prefijo `[invite][accept]` y heartbeats `pre-X` / `post-X` alrededor de cada `await`. Los Sentry tags `feature: 'invitations', step: 'accept-<step>'` cubren cada paso. El logging antiguo de `invitations/actions.ts` mantiene su prefijo `[invitations][invite-email]` y ahora sí se ve en Vercel logs (gracias al fix de Sentry server-side de PR #11/#12).

### Bug latente F2.4 — `player_accounts` RLS bloqueaba al invitee tutor — cazado preventivamente en PR #15 (2026-05-29)
- **Detectado en**: 2026-05-29, durante el repro local del fallo de invitation accept para staff (F2.6).
- **Síntoma observado**: `team_staff` falló con SQLSTATE 42501 (RLS) en el `attachToClub` del invitee.
- **Síntoma latente equivalente**: la policy `player_accounts_write_admin` (F1.7) solo permitía admin/coord. El comentario en `20260528180000_invitations_player_link.sql:19` asumía erróneamente que cubría también al aceptante. F2.4 nunca se había probado con un email virgen aceptando — habría fallado igual.
- **Fix**: migración `20260529000000_team_staff_insert_invitee.sql` añade DOS policies aditivas (`team_staff_insert_invitee` y `player_accounts_insert_invitee`) con el patrón calcado de `memberships_insert_bootstrap_or_admin`: el user puede insertar SU fila si existe invitación pendiente vigente que coincida en (membership/profile, email, token vigente).
- **Validación**: repro con puppeteer-core contra dev local. Ver `fase-2-summary.md` para la trace completa de pasos.
