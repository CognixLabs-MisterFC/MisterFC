- **Status**: Proposed (borrador; se acepta al cerrar Rework C)
- **Date**: 2026-06-10
- **Deciders**: Iker Milla
- **Related**: Rework C, `docs/specs/C.0-categorias-estandar-y-rollover.md` (§2, §4 D-a..D-d, §5), ADR-0017 (temporada en el equipo)

# ADR-0018 — Categorías estándar fijas + transición de temporada (rollover) sin destruir histórico

## Context

Tras Rework A la **categoría** es una plantilla permanente del club (`name + kind + half_duration_minutes`, orden derivado de `kind`) y el **equipo** es la instancia por temporada (`teams.season`, roster en `team_members`). Pero el alta de categorías quedó **libre** en `/equipos/plantillas` (A4): cada club inventa sus nombres/kinds, lo que impide informes comparables y complica el cambio de temporada.

Además **no existe** un modelo de "temporada" (no hay tabla `seasons` ni temporada activa de club): la temporada actual se infiere del reloj (`currentSeason()`, cambia el 1-ago). No hay un flujo para **cerrar una temporada y abrir la siguiente** reasignando jugadores, lo que el club necesita cada verano.

Hechos del modelo real relevantes (auditoría 2026-06-10):
- Vínculo jugador↔equipo **solo** vía `team_members` (no hay `players.team_id`); es un **historial** (`joined_at`/`left_at`) y las queries de roster filtran por **ventana de fechas** → el histórico es coherente en el tiempo.
- La temporada vive **solo** en `teams.season`; todo lo demás (stats F9, evaluaciones F8, asistencia, eventos) cuelga de `team_id`.
- **`teams.category_id` es `ON DELETE CASCADE`** (schema_base.sql:81): borrar una categoría arrastra sus equipos y, en cascada, su histórico. ⚠️ Riesgo a blindar.

## Decision

Rework C fija cuatro decisiones (D-a..D-d de la spec C.0):

- **D-a — Catálogo estándar fijo; el club no crea categorías; custom grandfathered.** Se siembran las **10 categorías estándar** de fútbol base (kinds canónicos O1, con `half_duration` canónico y nombre es-ES/CV), marcadas `is_standard=true` y no borrables. El club **solo crea equipos**. Las categorías custom preexistentes (A4) **se conservan** (`is_standard=false`), pero **no se pueden crear nuevas** (la UI/acción de alta se retira en C4, no destructivo).
- **D-b — Modelo de temporada explícito.** Tabla `seasons(club_id, label, status active|finalized)` con **una activa por club**, controlada por el **admin**. Los equipos nuevos toman la temporada activa por defecto; se **desacopla del reloj** `currentSeason()`.
- **D-c — Rollover por reasignación en bloque, sin borrar.** Asistente de **mapeo equipo→equipo** con checklist de jugadores, idempotente, que reutiliza la mecánica de `assignPlayerToTeam` (cerrar `left_at` origen + abrir fila destino con `joined_at = inicio de la nueva season`). **Invariante: nunca borra equipos** (preserva el histórico, evita el CASCADE).
- **D-d — Migración EXPAND→MIGRATE→CONTRACT** (como Rework A) para #3.

## Alternatives considered

- **Catálogo libre (mantener A4):** descartado — sin consistencia entre clubs ni informes comparables; el rollover "sube de categoría" se vuelve frágil.
- **Solo fijas, borrando custom:** descartado — destructivo; rompe clubs reales (femenino, escuela, grupos especiales). Se elige grandfathering.
- **Temporada derivada del reloj (sin tabla):** descartado para #4 — no permite "finalizar/abrir" auditable ni una activa controlada por el admin.
- **Rollover por `UPDATE team_id` / borrado de equipos viejos:** descartado — rompería la ventana de fechas del histórico y el CASCADE destruiría stats/evaluaciones/asistencia.

## Consequences

- C1 (esta tanda) añade `categories.is_standard` + `seed_standard_categories(club_id)` (idempotente) + backfill. No destructivo, no toca custom, re-ejecutable.
- C2 reutiliza `seed_standard_categories` en `create_club_with_admin`.
- C3/C4 retiran el alta de categorías y reconcilian; **C3/C4 deben blindar el FK CASCADE** `teams.category_id` (p.ej. impedir borrado de categorías con equipos, o pasar a RESTRICT) para que ninguna acción de categoría pueda destruir histórico.
- C5–C8 introducen `seasons` + el asistente de rollover.
- Subfases en orden con dependencias; **#3 (C1–C4) antes que #4 (C5–C8)**.
