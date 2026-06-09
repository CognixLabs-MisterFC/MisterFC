- **Status**: Accepted
- **Date**: 2026-06-09
- **Deciders**: Iker Milla
- **Related**: Rework A, `docs/specs/A.0-categorias-equipos.md` (§3 D1/D2/D3, §5, §9), ADR-0001 (Supabase)

# ADR-0017 — Temporada en el equipo; categoría como plantilla permanente

## Context

En el modelo original de F2 la **temporada vive en la categoría** (`categories.season`, `NOT NULL`): cada "Infantil A" es una **fila distinta por temporada** y el equipo hereda la temporada de su categoría (`team → category.season`). Eso obliga a recrear las categorías cada año, mezcla "plantilla de edad" con "instancia temporal", y hace que el régimen de cambios / la duración (atributos permanentes de la edad) cuelguen de una fila que cambia con la temporada.

El Rework A invierte la relación: la **categoría** pasa a ser una **plantilla permanente** del club (`name + kind + half_duration_minutes`, sin temporada ni orden manual; el orden se deriva del `kind`/edad), y el **equipo** pasa a ser la **instancia por temporada**. "Infantil A 2025-26" y "Infantil A 2026-27" son equipos distintos, con su propio roster (`team_members`).

Esta ADR fija la decisión estructural. El **cómo** (migración por pasos, ripple, rutas) está en la spec A.0; el rework se ejecuta con el patrón **EXPAND → MIGRATE → CONTRACT** para no romper CI en ningún PR intermedio. Este ADR se escribe en **A1 (EXPAND)**, que añade `teams.season` + `teams.club_id` de forma aditiva (sin tocar aún `categories`).

## Decision

1. **La temporada vive en `teams.season`** (`text`, regex `^[0-9]{4}-[0-9]{2}$`, `NOT NULL`). La categoría deja de tener `season` (en la fase CONTRACT).
2. **La categoría es una plantilla permanente** por club: `name + kind + half_duration_minutes`. **Sin `season` ni `order_idx`**; el orden de listado se **deriva del `kind`** (constante `CATEGORY_KIND_ORDER` en `@misterfc/core`).
3. **Unicidad del equipo: `unique(club_id, name, season)`**. Para poder expresarla sin trigger ni columna generada, se **denormaliza `club_id` en `teams`** (FK a `clubs`, `NOT NULL`, backfill desde `category.club_id`; no cambia en la vida del equipo).

> **Garantía por trigger (A1)**: `teams.season` y `teams.club_id` son **`NOT NULL`** y se **derivan de la categoría** mediante el trigger `teams_derive_from_category` (BEFORE INSERT/UPDATE) — mismo patrón que `match_player_stats_validate`/`evaluations_validate`, que derivan `club_id`/`team_id` del evento. `club_id` se fuerza SIEMPRE (denormalización autoritativa, inmutable); `season` se rellena solo si llega `NULL` (fallback transicional = la temporada de la categoría, comportamiento previo). Así los writers existentes (el alta de `/categorias` y los fixtures) siguen funcionando sin cambios, manteniendo el `NOT NULL`. El **fallback de `season` se retira en A6 CONTRACT** (cuando se borra `categories.season`); la derivación de `club_id` permanece.
4. **El régimen de cambios y la duración NO cambian de sitio**: `categories.kind` + `teams.division` → `substitution_regimes`; `categories.half_duration_minutes`. La temporada no interviene en el régimen.

## Alternatives considered

- **Mantener la temporada en la categoría (statu quo).** Rechazado: obliga a recrear categorías cada temporada, acopla la plantilla de edad a una instancia temporal y complica los reportes multi-temporada (F9.4).
- **Tabla puente `seasons` (catálogo de temporadas) + FK desde teams.** Rechazado para este rework: añade una entidad y joins extra sin beneficio real al volumen actual; `season` como texto `YYYY-YY` validado por regex basta (mismo formato que ya usaba `categories.season`). Se puede promover a tabla en el futuro sin bloquearlo.
- **Unicidad sin denormalizar `club_id`** (trigger que valide contra `category.club_id`, o columna generada `club_id` desde la categoría). Rechazado: un `unique` nativo es más simple, barato y robusto que un trigger; la columna generada referenciando otra tabla no es trivial en Postgres. `club_id` de un equipo es inmutable → denormalizar no introduce anomalías.
- **Borrar `categories.season` en un solo paso (A1 todo-en-uno).** Rechazado: rompería el typecheck de los ~20 lectores de `teams.categories.season` aún sin migrar → CI rojo. Se hace EXPAND→MIGRATE→CONTRACT (spec §5/§9), con cada PR dejando `main` verde y F9 vivo.

## Consequences

### Positivas
- La categoría se define una vez y se reutiliza temporada tras temporada; el equipo es la unidad temporal natural (con su roster por año vía `team_members`).
- Reportes/fichas multi-temporada se apoyan en `team.season` sin recrear categorías.
- Régimen y duración quedan en la plantilla permanente (donde conceptualmente pertenecen).

### Negativas / coste asumido
- **`club_id` denormalizado en `teams`** (redundante con `category.club_id`): aceptable por inmutabilidad y porque habilita la unicidad nativa.
- **Ripple**: ~20 sitios que derivaban la temporada por `category.season` migran a `team.season` (6 filtros reales de F9 + ~14 de display). Se aborda por subfases (A2/A3) con el patrón EXPAND→MIGRATE→CONTRACT.
- **Dedup de categorías** en CONTRACT (A6): colapsar las filas que hoy solo difieren por temporada en una plantilla permanente, re-apuntando `teams`/`events`. Con los datos actuales no fusiona nada; queda escrita robusta.

### Fuera de alcance (futuro)
- Season rollover / clonado de equipos-rosters de una temporada a la siguiente.
- Persistencia/relación con `seasons` como entidad propia (si algún día se necesita).

## Estado de implementación (2026-06-10) — cerrado

El Rework A está **implementado y cerrado** (A1–A6 en `main`), con el patrón EXPAND→MIGRATE→CONTRACT. Estado **real** y reparto por PR/migración: [spec A.0 §12](../specs/A.0-categorias-equipos.md) y [progress.md → Rework A](../journey/progress.md).

Concreción de esta decisión sobre el **trigger de denormalización** `teams_derive_from_category`:

- **`club_id`**: se deriva **SIEMPRE** de la categoría (denormalización autoritativa, inmutable). Se mantiene de forma permanente.
- **`season`**: el **fallback transicional ya se retiró en A6 CONTRACT** (migración `20260630000000`), al borrarse `categories.season`. Desde A6 la `season` la aporta **siempre** el flujo `/equipos`; un insert de `teams` sin `season` falla por `NOT NULL` (comportamiento deseado).

Migraciones: `20260627000000` (A1 teams.season/club_id), `20260627000001` (A1 trigger), `20260628000000` (A4 nullable), `20260629000000` (A5 invite_email), `20260630000000` (A6 dedup + drop + unique + trigger sin fallback de season).
