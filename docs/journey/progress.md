# Progreso — MisterFC Ola 1

Estado de cada una de las 17 fases del Plan Maestro. La fuente de verdad detallada es [plan-maestro.md](plan-maestro.md).

**Leyenda**: ☐ pendiente · ⟳ en curso · ☑ completada

| Fase | Título | Estado | Inicio | Cierre |
|---|---|---|---|---|
| 0 | Bootstrap del repositorio y andamiaje | ☑ completada | 2026-05-26 | 2026-05-27 |
| 1 | Identidad, Auth y modelo de roles base | ☑ completada | 2026-05-27 | 2026-05-28 |
| 2 | Estructura del club, plantilla y cuerpo técnico | ☑ completada | 2026-05-28 | extensión 2026-06-15 |
| 3 | Calendario unificado y comunicación básica | ☑ completada | 2026-05-29 | 2026-05-29 |
| 4 | Asistencia y convocatorias | ☑ Lote A + B entregados | 2026-05-29 | 2026-05-29 |
| 5 | Mensajería interna y push notifications | ☑ completada | 2026-05-30 | 2026-05-31 |
| 6 | Alineaciones y planificación del partido (ampliada 2026-05-29) | ☑ completada | 2026-05-31 | 2026-06-01 |
| 7 | Pantalla de toma de datos del partido (live) | ☑ completada | 2026-06-01 | 2026-06-07 |
| 8 | Valoraciones del partido | ☑ completada | 2026-06-08 | 2026-06-08 |
| 9 | Perfil del jugador y evolución multi-temporada | ☑ completada | 2026-06-08 | 2026-06-12 |
| 10 | Dashboard ejecutivo del club | ☑ completada | 2026-06-13 | 2026-06-14 |
| 11 | Biblioteca de ejercicios | ☑ completada | 2026-06-15 | 2026-06-17 |
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

### Fase 2 — Subfases de la extensión (☑ cerrada)

| Subfase | Estado | Resumen | Spec |
|---|---|---|---|
| 2.10 | ☑ 2026-05-29 (PR #21) | Listado global de jugadores del club con filtros + asignación individual a equipo. Ampliada: rework-A (#82), baja/C11a (#103), fix selectores (#105). Marcada en el tracker el 2026-06-15. | [docs/specs/2.10-listado-global-jugadores.md](../specs/2.10-listado-global-jugadores.md) |
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

## Fase 7 — Subfases entregadas

> **Numeración autoritativa** (renumber §8 del spec): la subfase nueva *Tiempo de juego por jugador* entró como **7.8**, desplazando *Línea de tiempo* → 7.9, *Cierre* → 7.10, *Rivales* → 7.11. Las sub-letras (7.4b/7.6b/7.6c/7.7b/7.7c) son refinamientos sobre la marcha. Detalle de cierre en [docs/specs/7.0-toma-datos-en-directo.md](../specs/7.0-toma-datos-en-directo.md) §16.

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| 7.1 | 2026-06-01 | #36 | Modelo `match_events` + tablas de sesión/reloj/once (`match_state`, `match_periods`, `match_starters`) + RLS `user_can_record_match` |
| 7.2 | 2026-06-01 | #37 | Armazón de la pantalla `/directo` (cronómetro + campo + paleta) |
| 7.3 | 2026-06-02 | #40 | Eventos sobre el jugador (gol, asistencia, tarjetas) + regla de expulsión derivada |
| 7.4 | 2026-06-02 | #41 | Eventos sobre el campo (córner, falta, fuera de juego, tiro) con ubicación |
| 7.4b | 2026-06-06 | #50 | Faltas detalladas (committed/received + jugador + ubicación) + córner a favor/en contra |
| 7.5 | 2026-06-02 | #42 | Sustituciones (2-step) + banquillo + "quitar al que no viene" |
| 7.6 | 2026-06-02 | #43 | Rival en la misma pantalla + eventos del rival + cambios corridos |
| 7.6b | 2026-06-03 | #44 | Mover jugadores + cambiar formación en vivo (estado táctico en `match_state`) |
| 7.6c | 2026-06-03 | #45 | Régimen de sustituciones por categoría + división |
| 7.7 | 2026-06-02 | #39 | Iniciar partido + cronómetro completo (motor puro, descanso, prórroga, ajuste, recuperable) — adelantada antes de 7.3 |
| 7.7b | 2026-06-04 | #47 | Flujo de periodos (1ª→2ª→finalizar; prórroga opcional) + finalizar partido |
| 7.7c | 2026-06-06 | #49 | Penaltis (evento durante el partido + tanda de desempate) y marcador |
| 7.8 | 2026-06-03 | #46 | *(NUEVA)* Tiempo de juego y stats por jugador en vivo (vista calculada) |
| 7.9 | 2026-06-06 | #51 | Línea de tiempo del partido editable (borrar/minuto/jugador/añadir) |
| 7.10 | 2026-06-07 | #52 | Cierre + consolidación `match_player_stats` + reabrir partido |
| 7.11 | 2026-06-07 | #53 | Rivales destacados + notas del partido |
| 7.12 | 2026-06-02 | #38 | Panel de próximo partido en Inicio |
| 7.13 | 2026-06-07 | #55 | Notas por jugador (persistentes): tabla `player_notes`, tocar jugador en `/directo` + ficha (fecha + autor); solo cuerpo técnico |
| 7.14 | 2026-06-07 | #55 | Asistencia a entrenos (lun–vie) en la convocatoria `(asistidos/total)`; motor puro, sin migración |
| 7.15 | 2026-06-07 | #55 | Contraste de la agenda: texto de eventos a color principal (negro en claro) |
| Fix RLS/pgTAP | 2026-06-07 | #54 | Recursión `team_staff`↔`invitations` (helper `user_is_principal_of_team`), policy INSERT `capabilities` recreada, test B8 `training_attendance` corregido; runner pgTAP en verde |

## Fase 7 — Cierre

- **Inicio / Fin**: 2026-06-01 / 2026-06-07. Dentro del presupuesto (10–14 h).
- **PRs**: #36–#53 (subfases) + #54 (fix pgTAP) + #55 (mejoras pre-cierre 7.13/7.14/7.15). NO mergeados por el agente (los mergea el responsable).
- **Migraciones**: `match_events` (#36) + ampliaciones de CHECK (formation_change, penalty/shootout) + `match_absences` + `substitution_regimes`/`teams.division` + `match_player_stats` + `match_rival_highlights` + `player_notes` + fix RLS (recursión + capabilities). Todas por CLI, sin editar aplicadas.
- **Tests**: motor puro de F7 en `@misterfc/core/match` + `@misterfc/core/attendance` (reloj, minutos, marcador/penaltis, contadores, línea de tiempo, consolidación, asistencia semanal); runner pgTAP completo en verde tras el fix #54.

## Fase 8 — Subfases entregadas

> **Descope (2026-06-08)**: los **entrenamientos quedaron FUERA de F8** (título cambiado a "Valoraciones del partido"). La 8.3 pasó de "post-entrenamiento" a **valoración colectiva del partido**. Detalle en [docs/specs/8.0-valoraciones.md](../specs/8.0-valoraciones.md) §14 y [ADR-0015](../decisions/ADR-0015-f8-descope-entrenamientos-valoracion-colectiva.md).

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| 8.1 | 2026-06-08 | #58 | Modelo: `evaluations` (rating 1-10 + comentario + MVP) + `evaluation_private_notes` + `team_evaluations` + `club_settings` + `match_state.post_match_done` + helpers (`user_is_account_of_player`, `club_evaluations_visible`) + triggers + RLS. ADR-0014 |
| 8.2 | 2026-06-08 | #59 | UI post-partido `/convocatorias/[eventId]/post-partido`: valoración **individual** por jugador (1-10 + comentario + MVP), `match_player_stats` como contexto de solo lectura, "Completar valoraciones" (`post_match_done`) |
| 8.3 | 2026-06-08 | #61 | Valoración **colectiva** del partido (`team_evaluations`, una por partido, lectura team-scoped; **coexiste** con la individual). PR #60 (valoración de entreno) **obsoleto**, no se mergea |
| 8.4 | 2026-06-08 | #62 | Nota privada del entrenador por jugador y partido (`evaluation_private_notes`), **desacoplada** de la valoración individual (migración `20260624000000` quitó la FK); nunca visible a jugador/familia |
| 8.5 | 2026-06-08 | #63 | Config de visibilidad por club: pantalla `/ajustes` + toggle `evaluations_player_visibility` (opt-in, default OFF, solo admin — D10) |
| 8.6 | 2026-06-08 | #64 | Barrido pgTAP completo de RLS (matriz tabla × rol × operación + cruce del flag sobre individual y colectiva) |

## Fase 8 — Cierre

- **Inicio / Fin**: 2026-06-08 / 2026-06-08. Dentro del presupuesto (8–13 h).
- **PRs**: #58–#64. PR #60 (valoración de entreno) quedó obsoleto al descopar entrenamientos — no se mergea. NO mergeados por el agente (los mergea el responsable).
- **Migraciones** (todas por CLI, sin editar las aplicadas): `20260622000000_evaluations.sql` (evaluations + evaluation_private_notes + club_settings + post_match_done + helpers), `20260623000000_team_evaluations.sql` (colectiva), `20260624000000_evaluation_private_notes_decouple.sql` (quita la FK de la nota privada → integridad por trigger).
- **Tests**: schemas Zod de valoración en `@misterfc/core` (Vitest); barrido pgTAP en `supabase/tests/rls_evaluations.sql` + `rls_team_evaluations.sql` + `rls_evaluations_crossflag.sql` — toda la matriz de visibilidad en verde.
- **Fuera de alcance / a F9**: la pantalla donde el jugador/familia VE su valoración (F8 solo abrió el permiso a nivel de datos). Valoración de **entrenamientos**: descopada, no planificada (fase/extensión futura si se retoma).

## Fase 9 — Subfases entregadas ✅

> **Cerrada 2026-06-12.** El **núcleo** (9.1/9.2/9.3/9.5) y el **segundo tramo 9.B** (9.4/9.6/9.7/9.8 + entrada de menú de stats por equipo) están **entregados y verificados** (typecheck · lint · test · build en verde; limitación pgTAP en CI = F15.8). Alineado con la tabla principal (☑ completada) y con [plan-maestro.md → Fase 9](plan-maestro.md). Especificación del núcleo en [docs/specs/9.0-perfil-jugador.md](../specs/9.0-perfil-jugador.md) (§15); del segundo tramo en [docs/specs/9.B-segundo-tramo.md](../specs/9.B-segundo-tramo.md). Resumen ejecutivo en [fase-9-summary.md](fase-9-summary.md). Decisiones de visibilidad **cerradas (2026-06-08)**: 🔒 **D9-1** (stats objetivas SIEMPRE visibles al jugador/familia, sin flag) · 🔒 **D9-2** (asistencia del propio jugador SIEMPRE, sin flag) · 🔒 **D9-3** (colectiva como contexto, con flag ON).

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| 9.1 | 2026-06-08 | #67 | Perfil con stats agregadas (vista staff): extiende `/jugadores/[playerId]` con resumen de temporada (SUM de `match_player_stats`); selector de temporada; agregación por **query directa** (no materializada — D9-C); helpers puros en `@misterfc/core/player-profile` |
| 9.2 | 2026-06-08 | #68 | Stats derivadas (ratios: goles/partido, goles/90′, % titularidad, etc.) + desglose de asistencia por código, **reusando los buckets de [ADR-0007](../decisions/ADR-0007-codigos-asistencia-contrato.md)**; cálculo puro sobre 9.1 |
| 9.3 | 2026-06-08 | #69 | Evolución intra-temporada (**recharts**, [ADR-0016](../decisions/ADR-0016-recharts-libreria-graficos.md)): línea de la valoración individual + colectiva como contexto; partidos sin valorar = hueco (no 0); componente de gráfico **reutilizable** + tabla `sr-only` equivalente; `next/dynamic` ssr:false (mitiga OOM de build) |
| 9.5 | 2026-06-09 | #70 | Vista jugador/familia: ruta nueva `/mi-ficha` (resolución vía `player_accounts` + selector si hay varios) **reutilizando** los bloques de 9.1/9.2/9.3; **policy SELECT nueva en `match_player_stats`** (`user_is_account_of_player`, sin flag — 🔒 D9-1) + pgTAP; stats/ratios/asistencia SIEMPRE, valoraciones solo con el flag ON, nunca lo privado; entrada de menú "Mi ficha" |

- **Migración del núcleo** (por CLI, sin editar las aplicadas): `20260625000000_match_player_stats_player_select.sql` — policy SELECT player-scoped sobre `match_player_stats` (D9-1), se combina por OR con la de staff (no la toca).
- **Tests**: helpers de `player-profile` en `@misterfc/core` (Vitest); pgTAP `supabase/tests/rls_match_player_stats.sql` (jugador/familia leen sus stats sin flag; ajenos no; staff igual; sin INSERT/UPDATE/DELETE; cross-check matriz F8: subjetivo solo con flag, privado nunca). Toda la verificación (typecheck · lint · test · build + `db:test`) en verde.
- **PRs**: #67–#70. NO mergeados por el agente (los mergea el responsable).
- **Listo para reaprovechar en el segundo tramo**: recharts (ADR-0016) + el componente de gráfico reutilizable → 9.4 multi-temporada; la tabla `sr-only` + diseño "la pantalla ES el reporte" → 9.7/9.8 PDF; los helpers de agregación ya aceptan `season` → 9.4 itera temporadas sin lógica nueva.

## Fase 9 — Segundo tramo 9.B entregado ✅

> **Entregado 2026-06-12** (PRs #108 spec + #109–#115). Especificado en [docs/specs/9.B-segundo-tramo.md](../specs/9.B-segundo-tramo.md). Con esto **F9 queda cerrada**. Habilitador previo **9.B-0** (`aggregateTeamStats` en core + query, #109): lo consumen 9.B-3, 9.B-7 y los badges de equipo.

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| 9.4 | ☑ 2026-06-12 | #110 (core 9.B-1) + #111 (UI 9.B-2) | Evolución multi-temporada del jugador (`careerBySeason`/`careerTotals`/`seasonComparison`; toggle Temporada/Carrera + tabla por temporada + gráfico de comparación) |
| 9.6 | ☑ 2026-06-12 | #113 (core 9.B-4) + #114 (UI 9.B-5) | Tracking de logros (badges automáticos **sin persistencia** — D6; 12 badges; las rating-sensibles gateadas por el flag — D5) |
| 9.7 | ☑ 2026-06-12 | #115 (9.B-6) | Reportes mensuales del jugador en PDF (descargables/imprimibles, no email — D10; `@react-pdf/renderer`) |
| 9.8 | ☑ 2026-06-12 | #115 (9.B-7) | Reportes de equipo en PDF (resumen mensual; consume 9.B-0; comparte infra PDF + branding con 9.7) |
| — | ☑ 2026-06-12 | #112 (9.B-3) | Entrada de menú "Estadísticas agregadas por equipo" para el cuerpo técnico + vista de equipo (consume 9.B-0; spec 9.0 §8.1) |

### Fase 9 — Diferidos (backlog, NO pendientes de F9)

> F9 **está cerrada**; estos puntos se sacaron del alcance deliberadamente y viven en el backlog (no bloquean el cierre). Detalle en [plan-maestro.md → Diferidos de F9](plan-maestro.md).

| Diferido | Destino | Por qué |
|---|---|---|
| Badge "debutante" | Backlog de badges | Regla sin cerrar (primer partido ± ventana de fechas); requiere decisión de producto. Sin modelo nuevo. |
| Badges absolutas por categoría | Refinamiento v2 | Umbrales absolutos (10 goles; 50/100/200 partidos) no escalan entre benjamines y seniors; v1 usó umbrales únicos + badges relativos auto-ajustables. D4 lo dejó abierto. |
| PDF v2 | v2 PDF | (a) gráficos dentro del PDF (hoy tabla `sr-only` equivalente — D8); (b) escudo del club en cabecera (falta `clubs.logo_url`). Presentación pura sobre el dato ya calculado. |

## Rework A — categorías ↔ equipos (la temporada vive en el equipo) ✅

> **Mejora estructural, no fase numerada** — intercalada entre el **núcleo de F9** y su segundo tramo (9.4 multi-temporada se apoya en `teams.season`). ✅ **Cerrado 2026-06-10**. La **temporada** baja de la categoría al **equipo**; la **categoría** queda como plantilla permanente del club (`name + kind + half_duration_minutes`, sin season ni orden). Patrón EXPAND→MIGRATE→CONTRACT, cada PR deja `main` verde. Detalle en [plan-maestro.md → Rework A](plan-maestro.md), [spec A.0](../specs/A.0-categorias-equipos.md) y [ADR-0017](../decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md).

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| A1 EXPAND | 2026-06-09 | #80 | `teams.season` + `teams.club_id` (aditivo, solo `teams`) + backfill + `NOT NULL`/regex/FK + `unique(club_id,name,season)` + trigger `teams_derive_from_category` (deriva `club_id` siempre; `season` fallback si NULL). ADR-0017 |
| A2 MIGRATE | 2026-06-09 | #81 | F9 (crítico): 6 filtros + selectores de temporada de `jugadores/[playerId]` y `mi-ficha` → `teams.season` |
| A3 MIGRATE | 2026-06-09 | #82 | Ripple display/DTO (~14 puntos): listados/cabeceras leen la temporada por `teams.season` |
| A4 MIGRATE | 2026-06-09 | #83 | `categories.season`/`order_idx` → NULLABLE + `/equipos` (listado por temporada + alta) + `/equipos/plantillas` (sin season/orden) + nav "categorías"→"equipos" + redirects 308 + retirada del CRUD viejo de `/categorias` |
| A5 MIGRATE | 2026-06-09 | #84 | Import: equipo por fila (resolución nombre→`team_id` en club+temporada activa; no crea equipos) + columna `players.invite_email` (🔒O2, solo guardar) + selector de lote como fallback |
| A6 CONTRACT | 2026-06-10 | #86 | Dedup de categorías por `(club_id, lower(name))` (re-apunta `teams`/`events`) → DROP `categories.season` + `order_idx` + `unique(club_id, lower(name))` + retirada del fallback de `season` del trigger (la de `club_id` se queda). pgTAP |

**Migraciones** (todas por CLI, sin editar las aplicadas):

| Migración | Subfase | Qué hace |
|---|---|---|
| `20260627000000_rework_a1_teams_season_expand` | A1 | `teams.season` + `teams.club_id` + backfill + endurecer + `unique(club_id,name,season)` |
| `20260627000001_teams_derive_from_category_trigger` | A1 | Trigger BEFORE: deriva `club_id` (siempre) + `season` (fallback si NULL) |
| `20260628000000_rework_a4_categories_season_nullable` | A4 | `categories.season`/`order_idx` → NULLABLE (check season "NULL o regex") |
| `20260629000000_rework_a5_players_invite_email` | A5 | `players.invite_email` NULLABLE + check de formato (🔒O2) |
| `20260630000000_rework_a6_categories_contract` | A6 | Salvaguarda + dedup + DROP `season`/`order_idx` + `unique(club_id,lower(name))` + trigger sin fallback de season |

**Cierre**:

- **PRs**: #80–#84 + #86. NO mergeados por el agente (los mergea el responsable). *(El #85 — A6 apilado sobre la rama de A5 — se cerró solo al borrarse su base en el merge de #84; se rehízo rebaseado a `main` como #86.)*
- **Verificación**: typecheck · lint · test · build en cada PR; `db:test` (pgTAP contra remoto) en verde tras A6 (`categories_contract.sql` + 25 fixtures ajustados al modelo nuevo).
- **Estado final**: nada lee `categories.season`; la categoría es plantilla permanente; la temporada vive en `teams.season`.
- **Fuera de alcance (futuro)**: season rollover / clonado de equipos-rosters entre temporadas; auto-envío real del `invite_email` (solo se persiste).

## Fase 10 — Subfases entregadas ✅

> **Cerrada 2026-06-14.** Dashboard ejecutivo del club (`/dashboard`, solo admin_club/coordinador). Spec íntegra [10.0](../specs/10.0-dashboard-ejecutivo.md) (**Variante A**: agregación por query directa + helpers puros, sin BD nueva). Cierre detallado en [fase-10-summary.md](fase-10-summary.md). La **10.0** (helpers core) se añadió como habilitador y la **10.1** del roadmap ("vistas materializadas") se reinterpretó como agregación en helpers (`DT1`).

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| — (spec) | 2026-06-13 | #118 | `docs(f10)`: spec del dashboard (cierra `D1`–`D7`, `DT1`–`DT3`; troceo Variante A; verificación RLS club-wide + existencia F2.10/F2.11) |
| 10.0 | 2026-06-13 | #119 | Helpers de agregación club-wide en core (puros + Vitest): `aggregateClubStats`, `aggregateTeamResults` (`D2`), `clubAttendanceAgg` (media/ranking/tendencia), `clubRankings` (por categoría, `D5`) |
| 10.1 | 2026-06-13 | #120 | Ruta `/dashboard` + nav role-aware + gating server-side + loader base + censo (loaders sin N+1, `IN(teamIds)`, RLS heredada) |
| 10.2 | 2026-06-13 | #121 | Plantilla: total + distribución por categoría/equipo + comparativa con temporada anterior (`D1`); enlaces a `/jugadores` (F2.10) y `/cuerpo-tecnico` (F2.11), no los duplica |
| 10.3 | 2026-06-14 | #123 | Resultados acumulados por equipo (W-D-L / GF-GA, `D2`: solo `closed`; GF/GA null ≠ 0) |
| 10.4 | 2026-06-14 | #125 | Asistencia: media + ranking + tendencia por semana (recharts `dynamic(ssr:false)` + tabla `sr-only`, patrón 9.B-2) |
| 10.6 | 2026-06-14 | #126 | Rankings por categoría (goleadores, MVPs, mejor media; `D5`); **no** gateados por el flag de visibilidad (`D6`) |
| 10.5 | 2026-06-14 | #127 | Alertas: baja asistencia (`D3`: <60% y ≥5 sesiones) + inactivos (`D4`: ni stats ni asistencia). Estado "todo en orden" en verde. **Cierra F10** |

## Fase 10 — Cierre

- **Inicio / Fin**: 2026-06-13 / 2026-06-14. Estimación 6–8 h. *(Nota de fidelidad: la agregación club-wide fue **net-new** pese al "reúso/riesgo bajo" del roadmap; pudo rozar el extremo alto — ya anticipado en la spec §0/§11.)*
- **PRs**: #118 (spec) + #119–#127. NO mergeados por el agente (los mergea el responsable).
- **Migraciones**: **ninguna**. F10 no crea tablas/vistas/funciones/políticas (`DT1`/`DT3`) → sin pgTAP nuevo; la limitación pgTAP-fuera-de-CI (F15.8) no aplica a esta fase.
- **Tests**: helpers puros de `@misterfc/core/player-profile/club` en Vitest (censo, resultados con GF/GA null y partidos no cerrados, asistencia con tendencia y suelo de muestra, rankings por categoría con empates, límites exactos de `D3`/`D4`). typecheck · lint · test · build en verde en cada PR.
- **Diferidos**: export PDF del dashboard (`D7`, infra 9.B reutilizable); vistas materializadas como optimización futura (`DT1`); selector libre de temporada (`D1`, v2).

## Fase 11 — Subfases entregadas ✅

> **Cerrada 2026-06-17.** Biblioteca de ejercicios del club: contrato del diagrama + modelo `exercises` con ciclo de metodología (`draft → proposed → published/rejected` + `archived`), editor visual `<PitchEditor>`, CRUD propio, aprobación del Admin con cola de revisión + bucle de corrección, import/export JSON. Spec íntegra [11.0](../specs/11.0-biblioteca-ejercicios.md). Orden de ejecución reordenado para sacar el riesgo pronto (§9 de la spec), `main` verde en cada PR.

| Subfase | Cierre | PR | Resumen |
|---|---|---|---|
| — (spec) | 2026-06-15 | #142 | `docs(f11)`: spec biblioteca de ejercicios (modelo + ciclo + diagrama + troceo) |
| 11.0 | 2026-06-15 | #143 | Contrato PURO del diagrama en `@misterfc/core` (Zod, coords %, ids estables/frame-extensible) + Vitest |
| 11.5a | 2026-06-15 | #144 | Renderer read-only del diagrama (`<DiagramView>`, SVG sobre `FieldMarkings`) |
| 11.1 (+11.1b) | 2026-06-15 | #145 | Modelo `exercises` + trigger de validación + RLS por estado + pgTAP + capability `can_create_exercises` (backfill `granted=false`) |
| 11.5a | 2026-06-16 | #146 | Renderer: medio campo + orientación vertical |
| 11.3 | 2026-06-16 | #147 | Listado con filtros (táctico/técnico/categoría/intensidad/espacio), reúsa patrón F2.10; RLS = gate |
| 11.4 | 2026-06-16 | #148 | Ficha read-only del ejercicio (campos + diagrama) |
| 11.5b | 2026-06-16 | #149, #150 | Editor `<PitchEditor>`: reducer puro (PR1 puntos + seleccionar/mover/borrar + undo/redo) + dibujados flecha/línea/zona (PR2) |
| (tamaños) | 2026-06-16 | #151 | Tamaño seleccionable (sm/md/lg) de elementos de punto (contrato + renderer + editor) |
| 11.6 | 2026-06-17 | #152, #153 | Crear (PR1: formulario + editor integrado + guardar) + editar/proponer/borrar/archivar (PR2: ciclo de vida) |
| (zona verde) | 2026-06-17 | #154 | Zona con relleno verde semi-transparente (contrato + renderer + editor) |
| 11.7 | 2026-06-17 | #155 | Estados/metodología: aprobar/rechazar (motivo) + cola de revisión (Admin) + notificación `exercise_rejected` (F5) + bucle de corrección (editar y reproponer un rechazado) |
| 11.8 | 2026-06-17 | #156 | Import/export individual a JSON (envoltorio versionado, solo contenido; valida antes de crear) |
| 11.9 | 2026-06-17 | #157 | Agrupar capabilities por dominio en el panel del ayudante (Entrenamientos / Partidos / Calendario / Jugadores·Plantilla / Comunicación); fix de labels i18n ausentes |
| 11.2 | — | — | Catálogo inicial **SIN seed** (subfase vacía de datos): el club crea su metodología por el flujo normal de 11.6 |

## Fase 11 — Cierre

- **Inicio / Fin**: 2026-06-15 / 2026-06-17. PRs **#142–#157** (cada uno con typecheck · lint · test · build en verde; varias subfases verificadas además en el harness CDP / build local servido, al estar el preview tras el SSO de Vercel).
- **Migraciones**: 11.1 (`exercises` + RLS + trigger + helpers de ciclo) y 11.1b (EXPAND del CHECK de `capabilities` + backfill `granted=false`) + enum `exercise_rejected`. El resto de subfases **aditivas sin modelo** (contrato/editor/UI). El **bucle de corrección de 11.7 no necesitó migración**: la RLS de 11.1 ya permitía al autor editar un `rejected` y la transición `rejected→proposed`.
- **Tests**: contrato del diagrama + reducer del editor + lógica de formulario/estados/import-export en Vitest (`@misterfc/core`); pgTAP de RLS de `exercises` (verificado **contra el remoto** — ver F15.8). Total suite core ≈ 790.
- **Reuso para F12**: el "ciclo de metodología del club" (`draft→proposed→published/rejected`, helpers `user_can_publish_methodology`) queda como pieza reutilizable por las plantillas de sesión (§7 de la spec).
- **Follow-ups** (en [known-issues.md](known-issues.md)): pasada de nav (patrón hub al resto del menú, antes de F12); animación por frames → F13 (el ejercicio estático = un frame; el contrato ya es frame-extensible).

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
