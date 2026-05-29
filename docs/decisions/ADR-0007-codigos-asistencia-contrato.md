- **Status**: Accepted
- **Date**: 2026-05-29
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase como backend), Fase 4 del Plan Maestro, `docs/specs/4.0-asistencia-convocatorias.md`

# ADR-0007 — Códigos de asistencia como enum SQL y contrato shared con F8/F9

## Context

F4 introduce el modelo de asistencia a entrenamientos. La spec (§D1) acuerda 10 códigos:

```
presente, ausente, ausente_con_aviso, entreno_diferenciado, lesionado,
enfermo, partido_oficial, viaje, sancionado, descanso
```

Tres fases downstream van a leer este valor con frecuencia:

- **F8 — Valoraciones del partido**: necesita correlacionar minutos jugados con asistencia previa (ej. "perdió titularidad por dos ausencias sin aviso").
- **F9 — Perfil del jugador**: agrega stats históricas de asistencia para el familiar y el cuerpo técnico.
- **F10 — Dashboard del club**: cross-equipo, agrega `% presencia` por equipo y categoría.

Decisiones a comparar:

- **A** — `text + CHECK (code in (...))`. Flexible: el frontend valida con Zod, la BD enforce un CHECK. Cambiar valores es ALTER CHECK + redeploy frontend.
- **B** — `enum SQL nativo` con `create type ... as enum (...)`. Tipo fuerte, los generators de Supabase emiten una union de strings literal, los IDEs autocompletan, los JOINs con `IN (...)` son `enum = enum` (más rápido que cast text). Cambiar valores en orden o eliminar valores es destructivo (no soporta `alter type ... drop value`).
- **C** — `tabla `attendance_codes` con FK`. Permite renombrar, ordenar y describir cada código con metadatos (color, descripción i18n) sin tocar el esquema. Coste: un JOIN extra en cada query de asistencia + complejidad de seed/migrar.

## Decision

**Opción B — enum SQL nativo**.

```sql
create type public.attendance_code as enum (
  'presente', 'ausente', 'ausente_con_aviso', 'entreno_diferenciado',
  'lesionado', 'enfermo', 'partido_oficial', 'viaje', 'sancionado', 'descanso'
);
```

### Reglas del contrato

1. **El orden importa.** Las 10 entradas tienen el orden de uso esperado (`presente`/`ausente`/`ausente_con_aviso` son los 3 más frecuentes; el ciclo rápido de la UI usa ese subset). Reordenar es BREAKING porque los exports en `packages/core` (`ATTENDANCE_QUICK_CYCLE`, `bucketOf`) asumen las posiciones.
2. **Añadir valores nuevos al final es compatible.** `alter type ... add value 'X'` no requiere downtime y mantiene la union TS abierta hacia arriba. Cambios así no rompen consumidores.
3. **Eliminar o renombrar un valor es BREAKING.** Postgres no soporta `alter type ... drop value`. Para retirar un código habría que migrar a un nuevo tipo y reescribir queries — coste claro, decisión consciente.
4. **Los 4 buckets stat-side `present / justified / unjustified / partial`** son una clasificación derivada que F8/F9 importan desde `@misterfc/core`. Si la clasificación cambia (un código pasa de `justified` a `unjustified`), F9 cambia el % retrospectivamente sin re-marcar nada — ese efecto es intencionado.
5. **La UI nunca expone el string literal del enum.** Toda visualización pasa por i18n `asistencia.codes.<valor>`. El día que renombremos `partido_oficial` a `match_with_other_team` solo cambia el label, no el enum.

### Por qué NO la opción A (text + CHECK)

- El generator de tipos de Supabase emite `string` para columnas text con CHECK, perdiendo la union literal. F8 y F9 tendrían que duplicar el array de valores válidos para autocompletar en sus propios módulos, divergiendo con el tiempo.
- Los CHECKs no se exponen al cliente; cualquier cambio en el array exige sincronizar 4 sitios (BD, Zod, types core, F8/F9 helpers) en lugar de 2 (BD + Zod).

### Por qué NO la opción C (tabla puente)

- 80 % de los casos no necesita los metadatos. El color en UI lo decidimos en frontend (no es contractual con el club). La descripción i18n vive en `messages/*.json`.
- Añade un JOIN a `attendance_codes` en CADA query de stats. F4.8 ya hace agregaciones complejas; un JOIN extra penaliza ROI.
- El precio del enum (cambios destructivos imposibles sin migración planeada) lo asumimos: los 10 códigos llevan año cocinándose con coaches reales y no esperamos eliminar ninguno en Ola 1.

## Consequences

### Positivas

- F8/F9 importan `AttendanceCode` desde `@misterfc/core` y obtienen autocompletado y exhaustive switch.
- Las queries de stats agrupan por enum directamente, sin cast.
- Los inserts inválidos se rechazan a nivel BD con mensaje claro de Postgres.
- ADR-0008 (Vercel Cron) puede leer asistencia sin redefinir el contrato.

### Negativas / coste asumido

- Cambiar el orden o eliminar un valor exige una migración planeada (varias horas) y coordinación con F8/F9.
- Los tests de F4 dependen de los valores literales del enum. ADR-0007 los sella; tests rotos al cambiar valores es la señal explícita de que hay que actualizar el ADR antes de mergear.

## Plan de cambio futuro

Si Ola 2 introduce un nuevo código (ej. `convocado_otra_categoria` para distinguir de `partido_oficial`):

1. `alter type public.attendance_code add value 'convocado_otra_categoria';`
2. Añadir al final del array en `packages/core/src/schemas/attendance.ts`.
3. Añadir a `messages/*.json` bajo `asistencia.codes.*`.
4. Decidir bucket stat-side (`justified` por default) y actualizar `bucketOf`.
5. F8/F9 no cambian: la union TS se extiende automáticamente.

## Referencias

- spec `docs/specs/4.0-asistencia-convocatorias.md` §D1 (justificación detallada de los 10 códigos).
- migración `supabase/migrations/20260601000000_training_attendance.sql` (definición del enum).
- `packages/core/src/schemas/attendance.ts` (contrato TS).
