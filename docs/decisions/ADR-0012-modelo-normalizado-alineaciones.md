# ADR-0012 — Modelo de alineaciones normalizado (tablas) en vez de JSON blob

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: Iker Milla
- **Related**: F6 (Alineaciones), [spec 6.0](../specs/6.0-alineaciones.md) §2, [ADR-0009](ADR-0009-f6-f7-match-field-editor-compartido.md), F9 (estadísticas por jugador), F7 (toma de datos en directo).

## Context

F6 necesita persistir la alineación de un partido: el 11 titular sobre el campo, el banquillo, los jugadores fuera de convocatoria, y (en Lote B) cambios programados y notas tácticas. Un partido admite varias alineaciones (titular, plan B, segunda parte).

Había dos formas de modelar la posición de los jugadores:

- **A — normalizado**: una tabla `lineups` (cabecera) y una tabla `lineup_positions` (una fila por jugador, con `location` field/bench/out, `position_code`, coordenadas).
- **B — blob**: una tabla `lineups` con una columna `layout jsonb` que contiene todo el documento de la alineación (jugadores, posiciones, zonas) serializado.

Restricciones que pesan:

- **F9 (estadísticas posicionales por jugador)** está en el plan-maestro y consumirá este modelo: "minutos por posición", "nº de veces titular como lateral derecho", etc.
- **F6.7** introduce drag&drop bidireccional campo↔banquillo↔fuera: cada gesto mueve un jugador.
- El invariante de dominio "un jugador ocupa una sola zona" debe ser duro.
- El editor `<MatchFieldEditor>` (ADR-0009) y F7 leen y escriben estas posiciones con frecuencia.

## Decision

**Modelo normalizado (Opción A).** `lineups` + `lineup_positions`, con `location ∈ {field, bench, out}`, `unique (lineup_id, player_id)`, FK a `players`, y constraints declarativos de coherencia (`field` exige `position_code`; `out` exige `out_reason`; coordenadas solo en `field`). El catálogo de formaciones vive en código (ADR-0013); `lineups.formation_code` lo referencia por string.

## Consequences

- **Positivas**:
  - F9 obtiene sus stats con `GROUP BY player_id, position_code` indexable (índice `lineup_positions_player_idx`), sin desempaquetar JSON.
  - Cada drag&drop es un `UPDATE` de una fila — barato y sin riesgo de lost-update entre pestañas.
  - El invariante "un jugador, una zona" lo garantiza la BD (`unique`), no la app.
  - Integridad referencial real (FK a `players` con `on delete cascade`); sin basura silenciosa al dar de baja un jugador.
  - RLS y validaciones (trigger de roster histórico) operan a nivel fila.
- **Negativas**:
  - Más DDL ahora (dos tablas, triggers, varias policies) frente a una sola columna.
  - Guardar la alineación completa son N filas en vez de un documento; la app orquesta el upsert/borrado del set.
- **Neutras**:
  - `position_code` no se valida contra el catálogo en BD (el catálogo está en código). La coherencia "code pertenece a la formación" la valida la app. La BD solo garantiza `location ↔ position_code`.

## Alternatives considered

- **B — JSON blob (`layout jsonb`)**: aparente simplicidad (una columna, un upsert). Descartada porque (1) las queries de F9 sobre jsonb no son indexables y degradan con el histórico; (2) cada drop reescribe todo el documento, con riesgo de concurrencia; (3) no hay FK ni constraint de unicidad por jugador — el invariante quedaría en la app; (4) obligaría a un híbrido inconsistente, ya que 6.8 (`planned_substitutions`) y 6.9 (notas) son inevitablemente relacionales. La simplicidad del blob es ilusoria: traslada la complejidad a la app (serialización, validación, migraciones de forma del blob).
- **Tres tablas separadas (`field_positions`, `bench`, `out`)**: conceptualmente limpio pero triplica policies y triggers, y complica el invariante de exclusión mutua entre zonas. Descartada en favor de una sola tabla con `location`.
</content>
