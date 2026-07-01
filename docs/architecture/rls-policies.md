# RLS y triggers — notas transversales

Notas que aplican a varias fases sobre políticas RLS y triggers de validación. Varias cabeceras de migración enlazan aquí.

## MVCC en policies tras `INSERT ... RETURNING`

Un `INSERT` con `RETURNING *` vuelve a evaluar la policy **SELECT** de la tabla sobre la fila recién insertada, dentro de la misma transacción. Si el helper de esa policy consulta una tabla que **se muta en el mismo `INSERT`**, puede tropezar con el estado MVCC intermedio y fallar.

**Convención:** los helpers usados en policies SELECT deben leer tablas **NO mutadas** por la operación que dispara el `RETURNING` (memberships, team_staff, capabilities, events, team_members, etc.), no la propia tabla que se está insertando. Cuando no se pueda evitar, usar un helper *row-aware*.

## Elegibilidad de roster ∪ promociones (bloque D, 2026-07-01)

Los **5 triggers** que exigen pertenencia al roster de un evento —

- `callup_responses_validate`
- `callup_decisions_validate`
- `training_attendance_validate_insert`
- `lineup_positions_validate`
- `match_assert_player_in_team` (helper compartido F7 → `match_starters`, `match_events`, `match_absences`, `match_player_stats`, `evaluations`)

— aceptan además a los jugadores **SUBIDOS** a ese evento (bloque D "Subir jugadores") vía `player_promoted_to_event(player, event)`. El predicado de elegibilidad es `roster ∪ player_promotions(event)`: **aditivo** (no cambia nada para los miembros del roster) y **scoped al `event_id`** (una subida al evento X no da acceso al Y); el jugador subido es del mismo club, así que el guard `player_cross_club` sigue protegiendo.

> **⚠️ Al modificar cualquiera de estos triggers, preservar la rama de promociones** (`player_promoted_to_event`).

Detalle del bloque: [bloque-D-summary.md](../journey/bloque-D-summary.md).
