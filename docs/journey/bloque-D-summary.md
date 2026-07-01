# Bloque D — Subir jugadores a equipos superiores (summary)

> **Cerrado 2026-07-01.** PRs **#249–#253** (5 subfases: D1, D2, D2.1, D3, D4).

> Feature **transversal**: extiende F3 (calendario/eventos), F4 (convocatorias/asistencia), F6 (alineación), F7 (captura en directo/evaluaciones) y F13.10 (informes/ficha/PDF), más el bus de notificaciones (F5.7). No renumera ninguna fase; se documenta como bloque propio por trazabilidad con los 5 PRs.

## Objetivo

Un jugador puede **entrenar** o **jugar un partido** con un **equipo SUPERIOR** al suyo (por categoría o por división), además de su equipo base, **sin salir de su equipo base** (regla #1: no se toca `team_members`). La subida:

1. Se **registra** (tabla dedicada `player_promotions`, ligada a un evento del equipo superior).
2. **Integra** al jugador en ese evento como **un miembro más** (convocatoria, asistencia, alineación, captura/evaluación).
3. Se muestra como **seguimiento** para el staff y la familia (ficha web + PDF), con un highlight legible ("Entrenó 3 veces con el Cadete A" / "Jugó 1 partido con el Cadete A").

## D0 — Análisis previo

Antes de construir se hizo un análisis de modelo (matriz de hallazgos + decisiones a cerrar D1–D9 + troceo D1–D4). Hallazgos clave:

- La jerarquía de superioridad **ya era computable**: `categories.kind` + `CATEGORY_KIND_ORDER` (core) para la categoría, y `teams.division` + `substitution_regimes.ordinal` para la división. No hacía falta un modelo de jerarquía nuevo.
- El subsistema convocatoria/asistencia estaba **atado por trigger al roster** (`player_not_in_team_at_event`): ahí estaba el bloqueo para integrar a un jugador que **no** está en `team_members` del equipo del evento.
- No existía detección de conflicto de fechas → se resolvería en app.
- La resolución de destinatarios de notificaciones ya resolvía la familia vía `player_accounts` (reutilizable).

## Decisiones cerradas (D1–D9 + giro a opción 1)

| # | Decisión |
|---|---|
| **D1** | **Superioridad** = la **categoría manda** (mayor `category_kind_ordinal`) **O** (misma categoría **Y** división superior = menor `substitution_regimes.ordinal`). Nunca mismo/inferior. |
| **D2** | **Modelo B**: tabla dedicada `player_promotions` ligada a un evento del equipo superior. **NO se tocan `team_members`** (regla #1). |
| **D3** | **entrenar/jugar** derivado de `event.type` (`training`→train; `match`/`friendly`/`tournament`→match; `other`→rechaza). |
| **D4** | **1 equipo base**: invariante (verificado **0 dobles-roster** en remoto); documentada, **sin constraint nueva**. |
| **D5** | **Conflicto de fecha** = **avisar, no bloquear** (RPC `promotion_conflicts`; la UI muestra los solapes y permite "Subir de todas formas"). |
| **D6** | **Notificación** = tipo propio `player_promoted` a la familia (`player_accounts`), **mantenido** tras D2.1 (aviso inmediato + único para entrenos; no duplica la convocatoria nativa). |
| **D7** | **Visibilidad familia** = la RLS de `player_promotions` deja a la familia ver **siempre** las subidas de su jugador (ficha + PDF con el cliente de la request). No se abre nada nuevo. |
| **D8** | **Permisos** (quién sube) = **staff del equipo superior ∪ admin/coord** (admin/coord **explícitos**, gotcha team_staff vs rol de club), reutilizando `user_can_manage_callup(evento)`. |
| **D9** | **Orden de kind materializado en BD** (`category_kind_ordinal`), antes solo en TS, para poder validar superioridad en el trigger. |
| **Giro** | **Opción 3 → Opción 1**: de "solo aviso" a **integración plena** (convocatoria/asistencia/alineación/captura) vía **roster ∪ promociones**, aditivo y **scoped al `event_id`**. Decidido y aprobado tras el análisis PASO 0 de D2.1. |

## Alcance entregado (subfases + PR)

| Subfase | Fecha | PR | Entrega |
|---|---|---|---|
| D1 | 2026-07-01 | #249 | Modelo `player_promotions` + jerarquía en BD (`category_kind_ordinal`, `is_promotion_target_superior`) + trigger "solo superior" + RLS + pgTAP |
| D2 | 2026-07-01 | #250 | Alta desde UI (`PromotePlayerDialog` en evento de calendario) + notificación `player_promoted` + aviso de conflicto (RPC `promotion_conflicts`) + RPC `promotion_candidates` |
| D2.1 | 2026-07-01 | #251 | Integración opción 1 (roster ∪ promociones) en los 5 sitios + botón subir en convocatoria + filtro del picker + pgTAP 15 comprobaciones |
| D3 | 2026-07-01 | #252 | Seguimiento en la ficha web (highlight + lista) |
| D4 | 2026-07-01 | #253 | Seguimiento en el PDF del informe |

## Migraciones

Todas aplicadas al remoto vía `pnpm db:push` (append-only), pgTAP verificado **contra el remoto**:

- `20260817000000_player_promotions` — tabla `player_promotions` + `category_kind_ordinal(text)` + `is_promotion_target_superior(player, event)` + trigger "solo superior" (deriva `team_id`/`club_id`/`kind`, guard cross-club) + RLS (SELECT: staff base/superior ∪ admin/coord ∪ familia; INSERT/DELETE: `user_can_manage_callup`).
- `20260818000000_notification_type_player_promoted` — valor de enum `player_promoted`.
- `20260818000001_promotion_rpcs` — `promotion_candidates(event)` y `promotion_conflicts(player, event)` (SECURITY DEFINER, gated por `user_can_manage_callup`).
- `20260819000000_promoted_player_eligibility` — helper `player_promoted_to_event(player, event)` + `create-or-replace` **aditivo** de los 5 triggers de roster.

Tests pgTAP: `rls_player_promotions.sql` (superioridad, trigger, RLS) y `rls_promoted_eligibility.sql` (los 5 sitios × roster OK / subido OK / ni-ni rechaza / cross-club rechaza).

## Nota técnica — triggers de roster ampliados (roster ∪ promociones)

Los **5 triggers** que exigen pertenencia al roster de un evento se ampliaron de forma **ADITIVA** para aceptar también a los jugadores **subidos** a ese evento:

- `callup_responses_validate`
- `callup_decisions_validate`
- `training_attendance_validate_insert`
- `lineup_positions_validate`
- `match_assert_player_in_team` (helper compartido F7 → `match_starters`, `match_events`, `match_absences`, `match_player_stats`, `evaluations`)

El predicado de elegibilidad pasó de "está en el roster" a **`roster ∪ player_promotions(event)`** vía `player_promoted_to_event(player, event)`. Es aditivo (no cambia nada para los miembros del roster), scoped al `event_id` (una subida al evento X no da acceso al Y) y el jugador subido es del mismo club (el guard `player_cross_club` sigue protegiendo).

**⚠️ Al modificar cualquiera de estos triggers en el futuro, preservar la rama de promociones.** Ver también [rls-policies.md](../architecture/rls-policies.md).

## Known-issues / diferidos

- **Sin deuda nueva.** No se detectaron regresiones ni gaps.
- Nota menor no bloqueante (por diseño): si el equipo base de un jugador subido no es legible bajo RLS por el staff del equipo superior, el badge "Subido · {equipo}" cae con gracia a "Subido" sin nombre de equipo. No es un fallo.
