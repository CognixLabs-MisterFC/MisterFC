# ADR-0013 — Catálogo de formaciones en código (no en base de datos)

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: Iker Milla
- **Related**: F6 (Alineaciones), [spec 6.0](../specs/6.0-alineaciones.md) §3, [ADR-0012](ADR-0012-modelo-normalizado-alineaciones.md), [ADR-0003](ADR-0003-monorepo-y-ola-2-rn.md) (packages/core agnóstico de framework).

## Context

El editor de F6 dibuja un preset de formación (4-3-3, 1-3-3, etc.) con sus posiciones sobre el campo. Cada formación es un conjunto de slots `{code, role, x, y}` por modalidad (`teams.format`: F7 / F8 / F11). Había que decidir dónde vive ese catálogo: en una tabla de BD (`formations` + `formation_slots`) o como constante tipada en código (`packages/core`).

Datos del contexto:

- Las formaciones son **datos de referencia estáticos**: las comunes del fútbol base no cambian por club ni por temporada; cambian con un release.
- El único caso que requeriría filas en BD — **"plantillas de formación guardadas por entrenador"** — está **explícitamente fuera de alcance de F6** (queda para futuro).
- La modalidad ya está modelada: `teams.format` existe desde F1.1 con CHECK `('F7','F8','F11')`. No se infiere de `categories.half_duration_minutes` (eso es por edad, no por formato).
- `packages/core` es agnóstico de framework (ADR-0003) y se reutilizará desde `apps/native` en Ola 2.

## Decision

**El catálogo de formaciones vive en código, en `packages/core/src/lineups/formations.ts`**, como constante tipada con su esquema (`code`, `label`, `format`, `slots[]`). `lineups.formation_code` (BD) lo referencia por string; **no es FK**. La geometría asociada (resolver slots, snap de coordenadas, reasignación al cambiar de formación) son funciones puras en `packages/core/src/lineups/geometry.ts`, testeables con Vitest sin DOM y reutilizables por web y native.

## Consequences

- **Positivas**:
  - Cero overhead de BD: sin migración de seed, sin RLS, sin roundtrip de red por cada render del editor.
  - Acceso tipado y validado; el compilador conoce los códigos válidos.
  - Reutilizable por `apps/native` (Ola 2) sin depender del backend.
  - Degradación elegante: si un código se retira del catálogo, las alineaciones guardadas con ese código siguen existiendo en BD y la UI muestra el code crudo.
- **Negativas**:
  - Añadir o ajustar una formación requiere un release de código (no un cambio de datos). Aceptable: el catálogo cambia rara vez.
  - "Plantillas por entrenador" (futuro) necesitará tabla; cuando llegue, se añadirá una tabla de plantillas que **referencia** el catálogo base, sin invalidar esta decisión.
- **Neutras**:
  - La validación "el `position_code` guardado pertenece a la formación" la hace la app (coherente con ADR-0012: la BD no conoce el catálogo).

## Alternatives considered

- **Tabla `formations` + `formation_slots` en BD**: necesaria solo si las formaciones fueran datos editables por usuario o variables por club. No lo son en Ola 1. Pros: editable sin release; permitiría plantillas por entrenador desde ya. Contras: migración + seed + RLS + query por render, todo para datos que no cambian. Descartada por YAGNI — se reconsiderará cuando "plantillas por entrenador" entre en alcance.
- **Catálogo en `apps/web` (no en core)**: más simple a corto plazo pero rompería la reutilización por `apps/native` (Ola 2) y mezclaría datos de dominio con la capa de presentación. Descartada por ADR-0003.
</content>
