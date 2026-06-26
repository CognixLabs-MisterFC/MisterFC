# ADR-0019 — Jugadas como banco común del club con ciclo de aprobación

- **Status**: Accepted
- **Date**: 2026-06-26
- **Deciders**: Iker Milla
- **Related**: F13 (pizarra de jugadas), [spec 13.10](../specs/13.10-informes-desarrollo.md) (no relacionada), patrón de F11 ejercicios (`supabase/migrations/20260715000001_exercises.sql`, `rls_exercises.sql`), [ADR-0002](ADR-0002-modelo-roles-capabilities.md) (roles y capabilities). Prerrequisito de "jugadas en sesiones" (F12↔F13, backlog/#192).

## Context

Las **jugadas** (`plays`, F13) se construyeron **team-scoped + creación directa**: cada jugada pertenece a un equipo (`team_id` inmutable), la crea cualquier staff con autoridad en ese equipo, y se comparte con la familia poniendo `visibility='team'`. No hay ciclo de revisión.

El usuario quiere el **mismo modelo que los ejercicios (F11)**: un **banco común del CLUB** con **ciclo de aprobación** (un entrenador propone una jugada; el coordinador/director de metodología la aprueba para que entre en el banco), y luego **cada equipo selecciona del banco** las jugadas que quiera para su playbook. Esto además es **prerrequisito de "jugadas en sesiones"** (se elegirán del playbook del equipo).

Estado de datos: **solo existe 1 jugada en toda la BD** (Club Beta, `visibility='team'`), por lo que la migración de datos es trivial y de riesgo ~0.

El **contrato de la jugada** (jsonb `play` con `frames`), el **editor** (pizarra + timeline), la **animación/reproducción** y el **fullscreen** son ortogonales al scope y **no se tocan**: solo cambia el "envoltorio" (scope del club + estados + selección por equipo + a quién se comparte).

## Decision

Migrar `plays` de **team-scoped + directo** a **club-scoped + ciclo de aprobación**, clonando el patrón de ejercicios (F11), con estas decisiones cerradas:

- **D1 — Aprobación con helper SEPARADO.** Nuevo `user_can_approve_plays(club_id) = admin_club ∪ coordinador`. **Los ejercicios NO cambian**: siguen con `user_can_publish_methodology(club_id) = solo admin_club`. (Se evita deliberadamente reutilizar el helper de ejercicios para no alterar su aprobación.)
- **D2 — Selección por equipo vía tabla `team_plays`.** El banco es del club; cada equipo arma su **playbook** añadiendo jugadas `published` del banco. `team_plays` = (`team_id`, `play_id`, quién añadió, …). Una jugada del banco está disponible para que cualquier equipo la seleccione; "las de mi equipo" = su subconjunto en `team_plays`.
- **D3 — Compartir con familia = flag `team_plays.shared_with_family`.** La visibilidad para jugadores/familias deja de vivir en `plays.visibility` (que desaparece) y pasa a ser **por selección de equipo**, porque la familia pertenece a un equipo concreto.
- **D4 — Migración de la jugada existente.** La única jugada real → `status='published'` en el banco (preservando `owner_profile_id`) + una fila `team_plays` para su `team_id` original con `shared_with_family=true` (preserva el comportamiento actual de que la familia la ve).
- **D5 — `team_id` sale de la identidad de `plays`.** La jugada es del **club**; el vínculo a equipo vive solo en `team_plays`. Sin `origin_team_id` (innecesario).
- **D6 — Crear/proponer club-scoped.** `user_can_create_plays(club_id)` clonado de `user_can_create_exercises`: `admin/coord ∪ principal de algún equipo del club ∪ capability can_create_plays`. (La capability `can_create_plays` ya existe; se reutiliza.)
- **D7 — Archivado.** Añadir `archived_at` a `plays` (v1), como ejercicios: las jugadas publicadas se **archivan**, no se borran.
- **D8 — Notificaciones del ciclo.** `play_approved` y `play_rejected` (con motivo) al proponente, análogas a `exercise_rejected`. El `play_published` actual (aviso a la familia) se re-apunta a la acción de **compartir** del equipo (sobre `team_plays`), no a la publicación en el banco.

**Lo que NO cambia:** contrato jsonb de la jugada (`play`/`frames`, `parsePlay`, `sceneAtTime`), editor, timeline de frames, animación, reproducción (`use-playback`) y fullscreen.

### Máquina de estados (igual que ejercicios)

`draft → proposed → published | rejected` (+ `archived_at` sobre `published`). Crear = `draft`; proponer = `proposed`; el aprobador (D1) publica o rechaza (con `rejection_reason`).

### Troceo (main verde en cada paso)

- **JR-0 — Modelo:** `plays` gana `status`/`approved_by`/`approved_at`/`rejection_reason`/`archived_at`, pierde `team_id`; nueva tabla `team_plays` (+`shared_with_family`); helpers `user_can_create_plays(club_id)` y `user_can_approve_plays(club_id)`; RLS por estado en `plays` + RLS de `team_plays`; migración de la jugada existente; pgTAP. Aplicar al remoto.
- **JR-1 — Biblioteca + ciclo de revisión:** `/jugadas` como banco con estados + pestaña "Pendientes de revisión" (aprobar/rechazar con motivo); editor con acciones `save_draft/propose/publish`; notificaciones `play_approved`/`play_rejected`.
- **JR-2 — Playbook por equipo + compartir con familia:** UI para añadir/quitar jugadas del banco al equipo (`team_plays`) + flag `shared_with_family`; re-apuntar `/mi-equipo/jugadas` y la notificación de compartir.
- **(siguiente, fuera de este ADR) — Jugadas en sesiones:** elegir del playbook del equipo dentro de una sesión. Depende de JR-2.

## Consequences

- **Positivas**: metodología unificada con ejercicios (mismo mental model y reúso masivo de F11); el banco evita duplicar jugadas entre equipos; control de calidad vía aprobación del coordinador; base lista para "jugadas en sesiones".
- **Negativas**: migración de modelo (drop `team_id`, drop `visibility`, nueva tabla `team_plays`, RLS reescrita) + pgTAP nuevo; dos conceptos a explicar en UI (banco vs playbook del equipo). La capability club-wide `can_create_plays` significa que un proponente puede proponer para el banco del club entero (mitigado por el ciclo de aprobación).
- **Neutras**: el editor/animación quedan idénticos; la jugada deja de "pertenecer" a un equipo y pasa a pertenecer al club + selecciones por equipo.

## Alternatives considered

- **A — Banco plano sin posesión por equipo** (todas las `published` disponibles para todos, sin `team_plays`): más simple, pero no modela "las de mi equipo" que pidió el usuario y deja sin base la selección de jugadas en sesiones. Descartada (D2).
- **B — Reutilizar `user_can_publish_methodology` (admin-only) para aprobar jugadas:** rompería el requisito de que **coordinador** apruebe, o forzaría a cambiar también la aprobación de ejercicios (efecto colateral no pedido). Descartada en favor de un helper separado (D1).
- **C — Mantener `visibility` en `plays` para compartir con familia:** incompatible con un banco del club (la jugada no es de un equipo); la familia es de un equipo concreto, así que el compartir debe vivir en `team_plays` (D3). Descartada.
- **D — Conservar `team_id` como `origin_team_id` informativo:** no aporta (la trazabilidad de autoría ya está en `owner_profile_id`); añade ambigüedad. Descartada (D5).
- **E — Mantener creación directa sin ciclo:** es justo lo que el usuario quiere cambiar. Descartada.
