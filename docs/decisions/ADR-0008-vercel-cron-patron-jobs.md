- **Status**: Accepted
- **Date**: 2026-05-29
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase como backend), ADR-0007 (códigos de asistencia), Fase 4 del Plan Maestro, `docs/specs/4.0-asistencia-convocatorias.md`

# ADR-0008 — Vercel Cron como patrón único de jobs programados

## Context

F4.7 introduce el **primer cron del proyecto**: un job diario que recorre eventos próximos y, sin enviar nada externamente, deja recordatorios pendientes en la tabla `notifications` (futuro-proof para F5/F16 según spec §5.1).

Tres fases siguientes van a necesitar jobs programados:

- **F5** push notifications: un consumer que toma `notifications` con `channel='push' AND status='pending'` y dispara Web Push.
- **F11** dashboard del club: agregaciones mensuales que un job recalcula 1×/mes.
- **F12** planificador microciclo: cron semanal que rota plantillas activas.

Decidir el patrón ahora evita reabrir la conversación en cada fase. Alternativas evaluadas:

- **A — Vercel Cron + endpoint App Router protegido por `CRON_SECRET`** (el modelo de la docs oficial de Vercel).
- **B — Supabase `pg_cron`** ejecutando funciones plpgsql.
- **C — GitHub Actions con schedule** que hace `curl` a un endpoint propio.
- **D — Servicio externo (AWS EventBridge / Trigger.dev)** dedicado a jobs.

## Decision

**Opción A — Vercel Cron** + endpoint `/api/cron/<name>/route.ts` protegido por header `Authorization: Bearer ${CRON_SECRET}`.

### Por qué Vercel Cron

- **Cero infra extra**: Vercel ya hostea la app web; añadir cron es una entrada en `vercel.json`.
- **Coste cubierto**: el plan Pro del usuario incluye Vercel Cron sin coste marginal por dispararlo 1×/día (hasta 100 jobs en Pro, suficiente para Ola 1+2).
- **Lógica TypeScript/Node**: el job comparte código con la app — schemas Zod, helpers de fechas, cliente Supabase, ADR-0007 (`attendance_code` enum) — sin reimplementar nada.
- **Observabilidad incluida**: Vercel UI muestra logs de cada ejecución + Sentry captura excepciones (config ya activa para el resto de la app).
- **Protección estándar**: el header `Authorization: Bearer ${CRON_SECRET}` lo setea Vercel automáticamente cuando dispara la entrada de `vercel.json`. Cualquier request manual sin el header recibe 401.

### Por qué NO `pg_cron` (Supabase)

- **Lógica plpgsql obligatoria**: F4.7 lee de `events`, `match_callup_meta`, `callup_responses`, `team_members`, `player_accounts` y escribe en `notifications`. Reescribir esa lógica en plpgsql duplicaría reglas (qué cuenta como "pendiente", composición de dedupe_key, payload jsonb) que ya viven en TypeScript.
- **No comparte schemas Zod**: los validadores de fecha y dedupe_key no son reutilizables desde plpgsql.
- **Observabilidad pobre**: errores en pg_cron se enmascaran salvo si auditamos `cron.job_run_details`. Mucha fricción frente al stack actual.
- **Reservamos pg_cron** para mantenimiento de BD (limpiar invitaciones expiradas, refrescar materialized views): trabajos que viven 100% en SQL.

### Por qué NO GitHub Actions cron

- **Latencia**: Actions tarda 30–90s en arrancar el runner para una tarea de 200ms.
- **Acoplamiento al repo**: si el repo está privado o el actor sin permisos, el cron falla silenciosamente.
- **Secret management duplicado**: hay que mantener `CRON_SECRET` en GitHub Secrets además de Vercel.
- **Ya tenemos un patrón web**: añadir un segundo (Actions) impone elegir cada vez.

### Por qué NO un servicio externo (EventBridge / Trigger.dev)

- **Infra extra a pagar/mantener** sin justificación para 1–3 jobs en Ola 1.
- **Latencia y observabilidad** comparables a Vercel Cron sin la ventaja de compartir código.
- **Vendor lock-in adicional** sin necesidad — ya estamos en Vercel.

## Convenciones que cierra este ADR

1. **Ruta de los endpoints cron**: `apps/web/src/app/api/cron/<name>/route.ts`. Un endpoint por job. Cada job lleva un nombre legible (`reminders`, `monthly-rollup`, etc.).
2. **Métodos aceptados**: `GET` y `POST`. Vercel Cron dispara GET por defecto; aceptar ambos facilita pruebas manuales con curl.
3. **Protección**: SIEMPRE `Authorization: Bearer ${CRON_SECRET}`. Sin secret en el header → 401. Sin `CRON_SECRET` en `process.env` → 401.
4. **Schedule**: definido en `apps/web/vercel.json` bajo `crons[]`. UTC literal — Vercel Cron no soporta TZ. Documentar la deriva DST en el endpoint y en la spec.
5. **Cliente Supabase**: `createSupabaseAdminClient()` (service role). Los crons bypassan RLS por diseño — no hay sesión de user.
6. **Idempotencia**: cada job tiene una clave de deduplicación natural. Para `reminders` es `dedupe_key` UNIQUE en `notifications` (ver `packages/core/src/notifications/dedupe.ts`). Si el cron corre dos veces el mismo día, el segundo no duplica.
7. **Logs**: el handler devuelve JSON con métricas (`{queued, inserted, …}`). Sentry captura excepciones automáticamente.
8. **Tests**: Vitest cubre los helpers puros (composición de claves, ventana temporal). El endpoint en sí se valida manualmente via curl en preview con el header.

## Consequences

### Positivas

- Un solo lugar donde añadir un job nuevo (vercel.json + un fichero `route.ts`).
- Reutiliza schemas, types y clientes que ya están en el repo.
- Coste operacional ≈ 0.
- F5/F11/F12 heredan el patrón sin re-justificación.

### Negativas / coste asumido

- **DST drift**: 09:00 Madrid en invierno = 10:00 Madrid en verano (cron es UTC). Para jobs sensibles al wall-clock-local, documentarlo. Para `reminders` (1×/día), aceptable.
- **Acoplamiento a Vercel**: si migramos de hosting, el cron se reescribe. Bajo riesgo en Ola 1; coste de migración acotado al fichero `vercel.json` + secrets.
- **No paralelismo**: Vercel ejecuta cada cron en una sola invocación serverless. Para jobs masivos (10k+ filas) hay que paginar manualmente. F4.7 no lo necesita.

## Plan de evolución

- **F5.7**: añadir un segundo endpoint `/api/cron/push-dispatch` que consuma `notifications WHERE channel='push' AND status='pending'` y dispare Web Push API.
- **F11**: `/api/cron/club-monthly-rollup` para precalcular KPIs.
- **F12**: `/api/cron/microciclo-rotate` para rotar plantillas activas semanalmente.
- Si superamos 10 jobs activos, evaluar Trigger.dev (mejor observabilidad por job) — pero ese umbral es Ola 3.

## Referencias

- spec `docs/specs/4.0-asistencia-convocatorias.md` §D5.
- código: `apps/web/src/app/api/cron/reminders/route.ts`.
- config: `apps/web/vercel.json`.
- helpers: `packages/core/src/notifications/dedupe.ts`.
