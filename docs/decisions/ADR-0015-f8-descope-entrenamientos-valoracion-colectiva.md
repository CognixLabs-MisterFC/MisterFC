- **Status**: Accepted
- **Date**: 2026-06-08
- **Deciders**: Iker Milla
- **Related**: ADR-0014 (`club_settings`), Fase 8 del Plan Maestro, `docs/specs/8.0-valoraciones.md` (§14 cierre)

# ADR-0015 — F8: descope de entrenamientos y valoración colectiva en tabla aparte

## Context

F8 se planificó como "Valoraciones del partido **y del entrenamiento**" con una subfase 8.3 "UI post-entrenamiento". Durante la implementación surgieron dos decisiones de alcance/modelo que se apartan del plan original y conviene fijar (son inmutables y marcan patrón):

1. **¿Entra la valoración de entrenamientos en F8?** El modelo de 8.1 nació "unificado" (`evaluations` con `event_type` derivado, rating opcional en entreno). Pero el flujo de valorar entrenos (frecuencia diaria, criterios distintos, sin `match_player_stats` de contexto, sin MVP) tiene un producto propio que diluía el foco de F8 (el **partido**).

2. **La valoración COLECTIVA del equipo** (una nota 1-10 del partido para todo el equipo, no por jugador) **no estaba en el plan** y el cliente la pidió. Hay que decidir **cómo** convive con la valoración individual.

## Decision

### 1. Entrenamientos FUERA de F8 (descope)

F8 cubre **solo el partido**. La valoración de entrenamientos se saca del alcance. La antigua subfase 8.3 ("post-entrenamiento") se **reutiliza** para la colectiva (ver abajo). El PR #60 (UI de valoración de entreno, ya iniciado) queda **obsoleto** y no se mergea.

- El modelo de `evaluations` (8.1) **mantiene** la columna `event_type` derivada y el rating nullable-en-entreno como capacidad **latente** del esquema (no cuesta nada y no estorba), pero **no hay UI ni flujo** de entreno en F8. La cláusula del trigger que permite rating opcional en `training` queda dormida.
- Si se retoma, será una **fase/extensión nueva** con su propio alcance (UI, criterios, agregación). **No re-añadir desde el plan antiguo.**

### 2. Valoración colectiva en tabla separada `team_evaluations` (Opción B)

La colectiva se modela como **tabla aparte** (`team_evaluations`, PK `event_id`, una fila por partido) que **coexiste** con la individual (`evaluations`, por jugador). No se mezclan.

- **Opción A descartada** — meter la colectiva como una fila especial/columna de `evaluations`: rompe el grano (`evaluations` es por `(event_id, player_id)`), obliga a un `player_id` sentinela o a nullables, y mezcla dos lecturas distintas (la individual es **player-scoped**; la colectiva es **team-scoped** — la ve todo el equipo).
- **Opción B elegida** — tabla dedicada: grano limpio (una por partido), su propia RLS de lectura team-scoped (`user_can_see_shared_lineup` + `club_evaluations_visible`), `rating` 1-10 **obligatorio**. Reusa el **mismo flag de club** (`evaluations_player_visibility`) que la individual — una sola palanca de privacidad gobierna ambas.

### 3. Nota privada desacoplada de la valoración individual

(Consecuencia registrada aquí por cercanía; detalle en spec §14.) En 8.1 `evaluation_private_notes` tenía una FK a `evaluations` (exigía valoración previa). En 8.4 se decidió que la nota privada es **independiente** del rating: migración `20260624000000_evaluation_private_notes_decouple.sql` quita la FK y pasa la integridad a un trigger propio (evento = partido, jugador en el roster, deriva club/team). Así el entrenador puede dejar un apunte interno aunque no haya puesto nota.

## Consequences

### Positivas

- F8 queda enfocada y cerrable; el partido tiene su valoración completa (individual + colectiva + privada) sin arrastrar el producto de entrenos.
- Individual y colectiva tienen grano y RLS limpios y diferenciados, gobernados por un **único** flag de visibilidad por club.
- La nota privada es flexible (no acoplada al rating) sin perder el aislamiento column-leak.

### Negativas / coste asumido

- El esquema `evaluations` conserva soporte latente de `training` que hoy no se usa (deuda cosmética mínima, documentada).
- Una tabla más (`team_evaluations`) y su barrido pgTAP propio.
- El plan original queda desalineado con la realidad → mitigado documentando el cambio en plan-maestro (§Fase 8), progress (§Fase 8) y spec (§14), y marcando explícitamente "no re-añadir entrenos".

## Alternatives considered

- **Mantener entrenos en F8**: descartado por dilución de alcance y producto propio del entreno.
- **Colectiva en `evaluations` (Opción A)**: descartada por choque de grano y de scope de lectura (player vs team).
- **Nota privada acoplada por FK**: descartada en 8.4 — el apunte interno no debe exigir un rating previo.

## Referencias

- spec `docs/specs/8.0-valoraciones.md` (§14 cierre).
- migraciones `20260622000000_evaluations.sql`, `20260623000000_team_evaluations.sql`, `20260624000000_evaluation_private_notes_decouple.sql`.
- tests `supabase/tests/rls_evaluations.sql`, `rls_team_evaluations.sql`, `rls_evaluations_crossflag.sql`.
