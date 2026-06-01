# Progreso — MisterFC Ola 1

Estado de cada una de las 17 fases del Plan Maestro. La fuente de verdad detallada es [plan-maestro.md](plan-maestro.md).

**Leyenda**: ☐ pendiente · ⟳ en curso · ☑ completada

| Fase | Título | Estado | Inicio | Cierre |
|---|---|---|---|---|
| 0 | Bootstrap del repositorio y andamiaje | ☑ completada | 2026-05-26 | 2026-05-27 |
| 1 | Identidad, Auth y modelo de roles base | ☑ completada | 2026-05-27 | 2026-05-28 |
| 2 | Estructura del club, plantilla y cuerpo técnico | ⟳ extendida 2026-05-29 | 2026-05-28 | lote inicial 2026-05-29 |
| 3 | Calendario unificado y comunicación básica | ☑ completada | 2026-05-29 | 2026-05-29 |
| 4 | Asistencia y convocatorias | ☑ Lote A + B entregados | 2026-05-29 | 2026-05-29 |
| 5 | Mensajería interna y push notifications | ☐ pendiente | — | — |
| 6 | Alineaciones y planificación del partido (ampliada 2026-05-29) | ☑ completada | 2026-05-31 | 2026-06-01 |
| 7 | Pantalla de toma de datos del partido (live) | ☐ pendiente | — | — |
| 8 | Valoraciones de partido y entrenamiento | ☐ pendiente | — | — |
| 9 | Perfil del jugador y evolución multi-temporada | ☐ pendiente | — | — |
| 10 | Dashboard ejecutivo del club | ☐ pendiente | — | — |
| 11 | Biblioteca de ejercicios | ☐ pendiente | — | — |
| 12 | Planificador de sesiones con plantillas microciclo | ☐ pendiente | — | — |
| 13 | Pizarra táctica 2D con animación | ☐ pendiente | — | — |
| 14 | RGPD para menores | ☐ pendiente | — | — |
| 15 | Testing E2E, observabilidad y runbook | ☐ pendiente | — | — |
| 16 | Beta cerrada con primer club | ☐ pendiente | — | — |

---

## Fase 2 — Subfases entregadas

> **F2 extendida 2026-05-29** con nuevas subfases (2.10, 2.11) tras feedback de uso real. Lote inicial (2.0–2.9) **sigue cerrado y sin cambios**; lo que se reabre es el alcance, no el código entregado. Ver [plan-maestro.md](plan-maestro.md) §Fase 2.

| Subfase | Cierre | Resumen |
|---|---|---|
| 2.0 | 2026-05-28 | App shell + nav role-aware + `/perfil` + avatares privados |
| 2.1 | 2026-05-28 | CRUD categorías + equipos |
| 2.2 | 2026-05-28 | Ficha del jugador + bucket privado `player-photos` + medical_notes con visibilidad |
| 2.3 | 2026-05-28 | Alta de jugador con dialog (sin cuenta vinculada) |
| 2.4 | 2026-05-28 | Vincular cuentas familia al jugador menor (`player_accounts` + invitations player_id) |
| 2.5 | 2026-05-28 | Histórico del jugador en el club (`team_members` con `joined_at`/`left_at`) |
| 2.6 | 2026-05-28 | Cuerpo técnico: tabla `team_staff` + UI `/equipos/[teamId]` |
| 2.7 | 2026-05-28 | UI capabilities del ayudante (shadcn Switch + optimistic UPSERT) |
| 2.8 | 2026-05-28 | Vista `/mi-plantilla` read-only del entrenador |
| 2.9 | 2026-05-29 | Import masivo CSV/Excel (wizard 4 pasos, primer Vitest del repo) |

### Fase 2 — Subfases pendientes (extensión)

| Subfase | Estado | Resumen | Spec |
|---|---|---|---|
| 2.10 | ☐ pendiente | Listado global de jugadores del club con filtros + asignación individual a equipo | [docs/specs/2.10-listado-global-jugadores.md](../specs/2.10-listado-global-jugadores.md) |
| 2.11 | ☑ 2026-05-29 | Gestión global de cuerpo técnico (`/cuerpo-tecnico`): listado + ficha con agenda F3 + acción mover staff (reuso `team_staff` joined_at/left_at) | [docs/specs/2.11-gestion-global-cuerpo-tecnico.md](../specs/2.11-gestion-global-cuerpo-tecnico.md) |

## Fase 5 — Subfases entregadas

> **Lote A** entregado 2026-05-30 (5.1 + 5.2 + 5.3). **Lote B + 5.8** entregado 2026-05-31 (5.4–5.8).

| Subfase | Cierre | Resumen |
|---|---|---|
| 5.1 | 2026-05-30 | Modelo `conversations`, `messages`, `announcements` + `audit_log` (acceso admin/coord logged) + helpers RLS + 18 pgTAP |
| 5.2 | 2026-05-30 | UI `/mensajes` (lista) + `/mensajes/[id]` (hilo con optimistic + read receipts) + botón "Enviar mensaje" en ficha jugador con `userCanMessageInClub` |
| 5.3 | 2026-05-30 | UI `/equipos/[teamId]/anuncios` (lista pinned-first + form gated por capability) + `/es/anuncios` global (admin/coord, audience club-wide / multi-team) + `/anuncios/[id]` detail page con delete autor-o-manager |
| 5.4 | 2026-05-31 | SW push + notificationclick (deep link, tag colapsable). VAPID keys ECDSA P-256. Helper `web-push.ts` server-side con `sendPushToUser` (respeta preferences, borra endpoints 404/410) |
| 5.5 | 2026-05-31 | Tabla `push_subscriptions` (endpoint UNIQUE) + RLS own-only + UI `/perfil/notificaciones` panel cliente con `Notification.requestPermission` + `pushManager.subscribe`. Banner explicativo iOS sin PWA |
| 5.6 | 2026-05-31 | Tabla `notification_preferences (user_id, type, channel, enabled)` + helper SQL `user_wants_notification` (LEFT JOIN default true). UI matrix con switches; `in_app` siempre on, `email` bloqueado hasta F16 |
| 5.7 | 2026-05-31 | Cron drainer + filas push espejo en `/api/cron/reminders`. Eager push en `sendMessage` / `createAnnouncement` / `createGlobalAnnouncement` / `publishCallup` via `notify-bus.ts`. Helpers puros `decideNotificationOutcome` con 11 Vitest |
| 5.8 | 2026-05-31 | Vista `/es/mi-equipo` (jugador): header team + compañeros + próximos 30d + anuncios + link a convocatorias. Selector si multi-team. Sidebar item solo jugador. Helpers `@misterfc/core/team-view` con 15 Vitest |

## Fase 4 — Subfases entregadas

> **Lote A** entregado 2026-05-29 (4.1 + 4.2 + 4.8). **Lote B** entregado 2026-05-29 (4.3–4.7).

| Subfase | Cierre | Resumen |
|---|---|---|
| 4.1 | 2026-05-29 | Enum `attendance_code` (10 códigos, ADR-0007) + tabla `training_attendance` con UNIQUE (event,player) + triggers (solo training, no futuro, roster histórico, recorded_by forzado, FKs inmutables) + helper RLS `user_can_record_attendance` + capability `can_mark_attendance` |
| 4.2 | 2026-05-29 | UI marcado por jugador (tabla con chips primarios + dropdown Otros + Clear, ver F4.2 redesign) + `/asistencia/[eventId]` + entry point desde event-dialog del calendario F3 |
| 4.3 | 2026-05-29 | 3 tablas separadas: `match_callup_meta` (citación + estado borrador/publicado) + `callup_responses` (yes/maybe/no del jugador/familia, RLS via player_accounts) + `callup_decisions` (called_up/discarded del cuerpo técnico) + helpers `user_can_manage_callup` y `user_owns_player_account` |
| 4.4 | 2026-05-29 | Acción `publishCallup` + UI `PublishCallupDialog` (guardar borrador / publicar; bloqueo de despublicación) + capability `can_manage_callups` |
| 4.5 | 2026-05-29 | UI `/convocatorias` (lista con badges yes/maybe/no) + ResponseButtons en `/convocatorias/[eventId]` para el jugador/familia con reason opcional |
| 4.6 | 2026-05-29 | Panel del entrenador: DecisionButtons (called_up/discarded + reason) por fila + resumen de descartes técnicos + lista de respuestas pendientes |
| 4.7 | 2026-05-29 | Tabla `notifications` futuro-proof (channel `in_app`/`push`/`email`, status, dedupe_key UNIQUE) + endpoint `/api/cron/reminders` (Vercel Cron `0 8 * * *` UTC, ADR-0008) + helpers `buildDedupeKey` / `dayBucketMadrid` |
| 4.8 | 2026-05-29 | Vista `/asistencia` con stats por código + por jugador, filtros temporales (7d/30d/temporada) + por equipo, lista de entrenamientos pendientes |
| 4.9 | 2026-05-31 | `categories.half_duration_minutes` (default 45) con backfill por categoría española estándar (querubín 15 … veterano 45, prefijo + unaccent). Helpers `computeEndsAt` / `computeCitacionAt` en `@misterfc/core`; `ends_at = starts_at + 2 × half + 15` (descanso constante 15 min). UI: event-dialog auto-rellena ends_at para type=match; publish-callup-dialog auto-rellena meeting_at = starts_at − 60 min. pgTAP `categories_half_duration_backfill.sql` |

## Fase 3 — Subfases entregadas

| Subfase | Cierre | Resumen |
|---|---|---|
| 3.1 | 2026-05-29 | Modelo `events` + capability `can_manage_calendar` + RLS + 19 pgTAP |
| 3.2 | 2026-05-29 | UI calendario (mes/semana/agenda) componente propio sobre Intl+Date |
| 3.3 | 2026-05-29 | CRUD eventos (createEvent / updateEvent / deleteEvent) con permisos |
| 3.4 | 2026-05-29 | Filtros equipo/categoría/tipo con estado URL serializado |
| 3.5 | 2026-05-29 | Recurrencia weekly opción A (parent + children, ADR-0005), 23 Vitest del generador |

## Fase 3 — Cierre

- **Inicio / Fin**: 2026-05-29 (un solo lote, dentro de presupuesto 6–9h).
- **PR**: uno único con spec + ADR-0005 + ADR-0006 + migraciones + UI + i18n es/en/va.
- **Tests añadidos**: 38 Vitest nuevos (15 TZ + 15 recurrencia + 8 schemas events) + 19 casos pgTAP RLS/CHECK/helpers de `events`. Sigue verde en CI.
- **Decisión de impl que difiere de spec original**: se eliminó `date-fns` durante la implementación (Intl + Date nativos cubren el caso con cero KB extra). ADR-0006 actualizado antes del merge.
- **Known-issue nueva**: `F3-rls-events-visibilidad` (jugador puede consultar API vía REST eventos de equipos a los que no pertenece; intencional Ola 1, endurecer en F14).

## Fase 2 — Cierre

- **Inicio**: 2026-05-28 — **Fin**: 2026-05-29
- **PRs**: #10 (lote A: 2.0 + 2.1), #11 + #12 (hotfixes F2.0), #13 (lote B: 2.2-2.5), #14 (lote C: 2.6-2.8), #15 (fix invitation accept flow), #16 (lote D: 2.9) — **7 PRs** (≈30 commits).
- **Lotes**: A (shell + CRUD), B (jugador + familia + foto + histórico), C (staff + capabilities + mi-plantilla), D (import).
- **Tiempo estimado**: 14–23h. **Real**: ≈18–20h efectivos (entró cómodamente en el rango).
- Más detalle en [fase-2-summary.md](fase-2-summary.md).

---

## Fase 6 — Subfases entregadas

> **Ampliada 2026-05-29**: F6 pasa de "Editor de alineaciones F7/F8/F11" → "Alineaciones y planificación del partido" con 4 subfases adicionales (6.6 importar convocatoria, 6.7 banquillo, 6.8 cambios programados, 6.9 notas tácticas). Pieza central `<MatchFieldEditor>` sienta la base reutilizable para F7 — ver [ADR-0009](../decisions/ADR-0009-f6-f7-match-field-editor-compartido.md).

> **Lote A entregado 2026-05-31** (PR #33): modelo + catálogo + `<MatchFieldEditor>` + página/editor del staff + permisos. Subfases 6.1–6.5 y 6.7 cerradas. Spec [6.0](../specs/6.0-alineaciones.md), ADR-0012 / ADR-0013.

> **Rediseño Lote B' 2026-06-01** (PR #34): la **convocatoria es la única fuente de verdad del roster**. La alineación trabaja SOBRE los convocados (called_up) y solo los distribuye en campo/banquillo — se elimina la zona "fuera" y `out_reason` de `lineup_positions` (migración `20260609000000`, las filas `out` migradas a `callup_decisions`). Sync ahora **unidireccional** convocatoria→alineaciones (descartar quita al jugador de todas las alineaciones; convocar lo añade al banquillo). Bugs cerrados: F (tope titulares por modalidad), G (re-publicar convocatoria con notificación `callup_updated`), B (tooltips), D (badge in_app por tipo + push). Mejora I (foto del jugador en los chips).

| Subfase | Estado | Resumen | Spec |
|---|---|---|---|
| 6.1 | ☑ 2026-05-31 | Modelo `lineups` + `lineup_positions` (normalizado, ADR-0012) + RLS | [docs/specs/6.0-alineaciones.md](../specs/6.0-alineaciones.md) |
| 6.2 | ☑ 2026-05-31 | Catálogo de formaciones F7 / F8 / F11 en código (ADR-0013) + geometría | [docs/specs/6.0-alineaciones.md](../specs/6.0-alineaciones.md) |
| 6.3 | ☑ 2026-05-31 | Editor visual drag&drop — `<MatchFieldEditor>` (mode edit/readonly/live-overlay) | [docs/specs/6.0-alineaciones.md](../specs/6.0-alineaciones.md) |
| 6.4 | ☑ 2026-05-31 | Múltiples alineaciones por partido + marcar oficial (una por evento) | [docs/specs/6.0-alineaciones.md](../specs/6.0-alineaciones.md) |
| 6.5 | ☑ 2026-05-31 · ↻ B' | Descartes: ahora son decisión de **convocatoria** (`callup_decisions`), no zona de la alineación (rediseño 2026-06-01 eliminó `out`/`out_reason`) | [docs/specs/6.0-alineaciones.md](../specs/6.0-alineaciones.md) |
| 6.6 | ☑ 2026-05-31 · ↻ B' | Sync **unidireccional** convocatoria→alineaciones (descartar quita; convocar añade a banquillo de todas) | [docs/specs/6.6-importar-convocatoria.md](../specs/6.6-importar-convocatoria.md) |
| 6.7 | ☑ 2026-05-31 · ↻ B' | Banquillo del partido + drag&drop campo↔banquillo (sin zona "fuera") | [docs/specs/6.7-banquillo.md](../specs/6.7-banquillo.md) |
| 6.8 | ☑ 2026-05-31 | Cambios programados (`planned_substitutions`, solo-staff) | [docs/specs/6.8-cambios-programados.md](../specs/6.8-cambios-programados.md) |
| 6.9 | ☑ 2026-05-31 | Notas tácticas (`lineup_tactical_notes`, solo-staff) + visibilidad equipo/familia | [docs/specs/6.9-notas-tacticas.md](../specs/6.9-notas-tacticas.md) |
| 6.10 | ☑ 2026-06-01 | Plantillas personalizadas de formación: tabla `coach_formations` (positions JSONB validado por trigger, unique `(owner, format, name)`, RLS owner∪admin/coord), ruta `/perfil/formaciones` (CRUD + editor drag&drop), grupo "Mis formaciones" en el selector del editor de alineación (adopta el layout) | [docs/specs/6.0-alineaciones.md](../specs/6.0-alineaciones.md) |

> **F6.10 entregada 2026-06-01** (PR pendiente): migración `20260610000000_coach_formations.sql`. Helpers de dominio en `packages/core` (`placeOnFormation`, `blankFormationPositions`, schema Zod con validación de nº de posiciones por modalidad). pgTAP `rls_coach_formations` (validación trigger + RLS SELECT/INSERT/DELETE por rol). Con esto **F6 queda cerrada** (6.1–6.10).

## Fase 11 — Subfases pendientes

> **+1 subfase 2026-05-30**: deuda diferida (capabilities UI plana) absorbida en F11.9. Ver [plan-maestro.md](plan-maestro.md) §Fase 11.

| Subfase | Estado | Resumen |
|---|---|---|
| 11.9 | ☐ pendiente | Agrupar capabilities por dominio en panel del ayudante (squad / match / calendar / attendance / comms) |

## Fase 14 — Subfases pendientes

> **+2 subfases 2026-05-30**: deuda diferida de RLS absorbida (F2.7 capabilities cross-team, F3 events visibilidad). Ver [plan-maestro.md](plan-maestro.md) §Fase 14.

| Subfase | Estado | Resumen |
|---|---|---|
| 14.9 | ☐ pendiente | Endurecer RLS de `capabilities` a `team_staff` específico (un principal solo edita ayudantes de SUS equipos) |
| 14.10 | ☐ pendiente | Endurecer RLS de `events` para aislamiento team-a-team (jugador del equipo A no ve eventos del equipo B vía API) |

## Fase 16 — Subfases pendientes (anticipadas)

| Subfase | Estado | Resumen | Spec |
|---|---|---|---|
| 16.x | ☐ pendiente (ESPERA F16.0) | Bulk-invite de jugadores con email + team vía Excel/CSV | [docs/specs/16.x-bulk-invite-excel.md](../specs/16.x-bulk-invite-excel.md) |

---

## Notas

- Al cerrar cada fase, mover su fila a `☑` y rellenar la fecha de cierre.
- Si una subfase concreta dentro de una fase cierra, registrar `[hecho YYYY-MM-DD]` en [plan-maestro.md](plan-maestro.md) (esta tabla solo refleja el cierre de fase).
- Cierres de fase con cierta complejidad (>5 subfases o >1 lote) van acompañados de un `fase-N-summary.md` con bugs cazados, decisiones técnicas y lecciones.
- Las **extensiones** sobre fases ya cerradas se marcan `⟳ extendida YYYY-MM-DD` en la tabla principal y se documentan en su sección con la nota de qué se reabre y qué no.
