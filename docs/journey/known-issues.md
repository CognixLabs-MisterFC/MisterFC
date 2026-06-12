# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar en su propio PR.

## Activas

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

## Planificadas en plan-maestro

> Entradas que dejan de ser "deuda activa" porque han pasado a subfase concreta del plan-maestro con horas presupuestadas. El detalle del plan vive en [plan-maestro.md](plan-maestro.md); aquí solo el cross-reference al issue original para no perder el rastro de por qué entró al plan.

### F11.9 — Capabilities UI plana → agrupar por dominio
- **Issue original** (2026-05-29, spec 4.0 §D4): la lista plana de capabilities (11 switches en `/equipos/[teamId]/staff/[membershipId]/capabilities`) degrada UX cuando crezca a 13–15 con F6/F8/F10. Pre-deuda de UX, sin impacto en BD ni runtime.
- **Planificado en**: **F11.9** (1–2 h). Subgrupos colapsables `squad / match / calendar / attendance / comms`. Sin cambio de modelo.
- **Referencia**: `docs/specs/2.7-capabilities-ui.md` §8, `docs/specs/4.0-asistencia-convocatorias.md` §D4.

### F14.9 — RLS capabilities cross-team
- **Issue original** (2026-05-28, F2.7): el policy `capabilities_update` (F1.7) acepta admin/coord/principal del **club** sin filtrar por equipo. Un entrenador principal del Equipo A puede modificar caps de un ayudante asignado solo al Equipo B. La RLS sigue siendo la autoridad y el server action no chequea pertenencia por equipo.
- **Impacto en beta**: bajo (el primer club piloto opera con pocos equipos cuyos principales son la misma persona).
- **Planificado en**: **F14.9** (1–2 h). Helper `user_is_principal_of_assistant_team(membership_id)` + drop/create de policies de `capabilities` filtrando por `team_staff` específico + pgTAP con 4 casos. Sin cambio de modelo.
- **Referencia**: `docs/specs/2.7-capabilities-ui.md` §8.

### F14.10 — RLS events team-isolation
- **Issue original** (2026-05-29, spec 3.0 §4.6): la policy `events_select_member` abre SELECT a cualquier miembro autenticado del club. Un jugador del Equipo A puede listar via API eventos del Equipo B. El filtrado "jugador ve solo eventos de su equipo" es **UX, no seguridad**. Decisión deliberada de Ola 1.
- **Impacto en beta**: bajo (datos semi-públicos intra-club: título + fecha + lugar). Datos sensibles tienen su propia RLS.
- **Planificado en**: **F14.10** (1–2 h). Cambio del SELECT policy: `team_id IS NULL OR user_is_in_team(team_id)` para roles jugador/ayudante; admin/coord sin cambio. Migración + pgTAP con 4 casos.
- **Referencia**: `docs/specs/3.0-calendario-eventos.md` §4.6, comentario explícito en `supabase/migrations/20260530000000_events.sql`.

### F15.8 — pgTAP no se ejecuta en CI
- **Issue original** (2026-06-12, cierre de F9): el CI (`.github/workflows/ci.yml`) corre typecheck · lint · test · build pero **no ejecuta pgTAP**. Además, el sandbox de desarrollo no puede arrancar Docker (`no-new-privileges`, sin root), así que `pnpm db:test` tampoco corre localmente. Los tests pgTAP de funciones/RLS de BD (`supabase/tests/*.sql`) quedan **escritos pero sin ejecución automática**; su validación efectiva ocurre solo al aplicar la migración contra el remoto.
- **Impacto**: medio y **creciente**. La superficie de funciones SECURITY DEFINER no testeadas en pipeline crece con cada bug/feature de BD (p.ej. Bug 2·2a #106, 2c #107, **2b #116** con su guarda del último admin — todos con pgTAP escrito y sin correr en CI).
- **Planificado en**: **F15.8** (1–2 h). Job CI con Postgres+pgTAP en contenedor que corra `supabase/tests/*.sql`, o paso programado contra staging. Sin cambio de modelo.
- **Referencia**: `plan-maestro.md` F15.8, `fase-9-summary.md` (limitación de verificación).

---

## Resueltas

### F4b — redirect 308 `/mi-plantilla` → `/mis-equipos` retirado (2026-05-30, chore/diferida-a-plan)
- **Issue original** (2026-05-29, F4 Lote B): `apps/web/next.config.ts` mantenía un par de redirects 308 desde `/[locale]/mi-plantilla` para no romper bookmarks o links externos a la ruta vieja. Plan original: borrar a partir de 2026-06-28 tras 30 días de gracia.
- **Decisión 2026-05-30**: ejecutar ahora en lugar de esperar. App en beta cerrada con piloto único, sin bookmarks externos a la URL antigua, riesgo de breakage = 0.
- **Cómo se retiró**: borrado del bloque `redirects()` en `apps/web/next.config.ts` + verificación con `git grep mi-plantilla` de que no quedan referencias internas.

### Bug F2.7 latente — server action `toggleCapability` fallaba para todos los roles con 42501 — resuelto en fix/capabilities-admin-grant
- **Detectado en**: 2026-05-29, smoke test de F3 (`can_manage_calendar`). El user reportó que admin_club no podía activar la capability.
- **Síntoma reportado**: "no tengo permisos para activarlo" al pulsar el switch desde `/equipos/[teamId]/staff/[membershipId]/capabilities`.
- **Causa raíz** (no específica de `can_manage_calendar`): el server action usa `supabase.from('capabilities').upsert(..., { onConflict: ... })`. PostgREST lo traduce a `INSERT ... ON CONFLICT DO UPDATE`. PostgreSQL evalúa la policy INSERT WITH CHECK para todas las filas en el INSERT path, también cuando habrá conflict + UPDATE. La migración F1.7 solo creó policy UPDATE para `capabilities` (comentario explícito: "INSERT/DELETE solo vía trigger SECURITY DEFINER"). Resultado: el UPSERT fallaba con 42501 para CUALQUIER rol, no solo admin.
- **Por qué no se cazó en F2.7**: el pgTAP `rls_capabilities_update.sql` usa `UPDATE` plano, no UPSERT — distinto code path. El smoke manual de F2.7 (asumido como exitoso) probablemente no llegó a tocar realmente este flujo.
- **Aprendizaje (lección transversal)**: cuando una server action use `.upsert(..., { onConflict })`, asegurarse de que la tabla tiene policy INSERT compatible con el rol esperado, no solo UPDATE. El comentario "INSERT solo vía trigger" en RLS y el `.upsert()` en código son contradictorios — uno de los dos miente. Documentado en `docs/architecture/rls-policies.md` si llega el momento de añadirlo (gancho para F14 cuando se haga la auditoría de RLS).
- **Fix aplicado**: defensa en profundidad en dos capas.
  - **App**: `toggleCapability` cambiado de `.upsert()` a `.update()` plano. La fila siempre existe porque el trigger `ensure_assistant_capabilities` la siembra al crear membership ayudante + backfill F3.1 para `can_manage_calendar`. Si rows_affected = 0, devuelve 'forbidden' explícito.
  - **BD**: nueva policy `capabilities_insert_managers` con el mismo predicate que la UPDATE (admin_club + coordinador + entrenador_principal del club al que pertenece la membership). Por si un futuro cambio vuelve a UPSERT.
- **Tests añadidos**: `supabase/tests/rls_capabilities_upsert.sql` con 7 casos cubriendo el code path INSERT ON CONFLICT (U1–U7) — admin/coord/principal pueden, ayudante propio/jugador/admin-cross-club no, capability libre rechazada por CHECK.
- **Migración**: `supabase/migrations/20260530000002_capabilities_insert_policy.sql`.

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
