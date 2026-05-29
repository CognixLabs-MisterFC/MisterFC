- **Status**: Accepted
- **Date**: 2026-05-29
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase como backend), Fase 3 del Plan Maestro, `docs/specs/3.0-calendario-eventos.md`

# ADR-0005 — Estrategia de recurrencia en eventos: parent + children explícitos

## Context

Fase 3 (Calendario y eventos) introduce el modelo `events`. El dominio real del producto exige soportar recurrencias: en fútbol base la inmensa mayoría de entrenamientos son periódicos por construcción (martes + jueves 18:00–19:30 toda la temporada). Sin recurrencia, el entrenador crea 60–120 entrenamientos a mano por equipo y temporada, fricción suficiente como para matar la adopción del producto antes de la beta.

Al mismo tiempo, F3 está presupuestada en 6–9 h y la fase tiene 5 subfases (3.1–3.5). Cualquier estrategia que añada un riesgo de scope desproporcionado descalifica al producto frente al deadline de septiembre 2026.

Tres aproximaciones evaluadas:

- **A** — parent event con regla simple (`weekly` + days + count/until) que al guardar genera N children explícitos como filas separadas en la misma tabla, vinculadas por `parent_event_id`.
- **B** — modelo RRULE estilo iCalendar (rfc5545) almacenado en el parent. Sin children persistidos: las ocurrencias se expanden virtualmente al leer.
- **C** — sin recurrencia. El entrenador crea cada evento individualmente.

Tres clientes downstream van a heredar esta decisión: **F4** (asistencias por evento), **F5** (recordatorios cron sobre eventos), **F12** (planificador microciclo). La elección no es local a F3.

## Decision

**Opción A — parent + children explícitos** generados al guardar la serie. El parent guarda `recurrence_rule` (jsonb con esquema rígido validado por Zod). Cada child tiene `parent_event_id` apuntando al parent y `recurrence_rule = NULL`. La profundidad es siempre 1 por construcción (sin series de series).

### Reglas

- Esquema único soportado en F3: `freq: 'weekly' + interval (1–4) + by_weekday[] + (count XOR until)`.
- **`count` cuenta semanas, no hijos**. Hijos totales = `count × by_weekday.length`. El form de UI lo recalcula y lo muestra en directo.
- Límite duro: **52 semanas** de serie (un año), `until` ≤ 365 días desde el primer evento. Sin límite directo en número de hijos (3 días/semana × 36 semanas = 108 hijos válidos).
- Generación atómica: server action transaccional inserta parent + children en una sola transacción. Si falla cualquier child, rollback total.
- Edición:
  - "Solo esta instancia" → UPDATE del child individual.
  - "Esta y futuras" → DELETE children `starts_at >= esta_fecha` + INSERT regenerado.
  - "Toda la serie" → UPDATE del parent + DELETE children futuros + regeneración.
- Borrado:
  - "Solo esta instancia" → DELETE del child.
  - "Esta y futuras" → DELETE children con `starts_at >= esta_fecha`.
  - "Toda la serie" → DELETE del parent (`on delete cascade` borra todos los children).

### Implementación

- Generador puro `expandRecurrence(parentStartsAt, parentEndsAt, rule, tz)` en `packages/core/src/events/recurrence.ts`. Sin acceso a clock, sin side effects. Testeado con Vitest cubriendo:
  - weekly interval=1, by_weekday=[1] (lunes), count=4
  - weekly interval=2, by_weekday=[2,4] (mié+vie), until=date
  - DST marzo Madrid (último domingo de marzo)
  - DST octubre Madrid (último domingo de octubre)
  - count=52 con by_weekday=[1,3,5] → 156 instancias
  - until exactamente igual al último timestamp generado
- Persistencia: `events.parent_event_id uuid references public.events(id) on delete cascade`; `events.recurrence_rule jsonb`; CHECK `parent_event_id is null or recurrence_rule is null` (children no llevan regla).

## Consequences

### Positivas

- **Simplicidad de modelo**: una sola tabla, un join trivial (`parent_event_id`) para reconstruir la serie. SELECT por rango temporal no requiere expansión virtual: la BD ya tiene cada ocurrencia indexada.
- **Edición individual gratis**: cada child es una fila normal, editable como cualquier otro evento. F4 (asistencia por evento) escribe directamente contra `event_id`, no contra "ocurrencia de la serie X".
- **Performance de lectura**: `select * from events where starts_at between X and Y` es lineal en filas dentro del rango, sin lógica de expansión. Crítico para la vista mensual del calendario.
- **Indexable**: cada ocurrencia se indexa por `(team_id, starts_at)`, `(category_id, starts_at)`, `(club_id, starts_at)`. RRULE virtual no se indexa.
- **F5 (recordatorios cron) reutiliza**: el cron pregunta "eventos en las próximas 24h" → SELECT directo, sin expandir reglas en runtime.
- **F12 (planificador microciclo) reutiliza**: aunque las sesiones de F12 no son recurrentes per se, la idea de "duplicar microciclo de la semana pasada" es esencialmente la misma operación: copiar N filas desplazadas 7 días.

### Negativas

- **Volumen de filas**: una serie de 108 ocurrencias son 108 filas en `events`. Para un club con 8 equipos × 2 series/temporada × 100 ocurrencias = ~1600 filas/temporada. Postgres maneja órdenes de magnitud más sin parpadear; no es un riesgo real, pero es el coste a pagar frente a B.
- **Edición de la serie cuesta más**: "esta y futuras" implica DELETE + INSERT regenerado. Es una operación O(n) en hijos futuros vs O(1) en B (cambias el RRULE y ya está). Aceptable porque editar series es operación poco frecuente.
- **Sin excepciones complejas tipo iCal**: "todos los martes excepto el primero de septiembre". F3 no las soporta. Workaround: el usuario crea la serie y borra la instancia individual. Aceptable para el dominio (fútbol base no necesita excepciones complejas).
- **Cambio del parent que no propaga al pasado**: si el parent se mueve a otra fecha, los children pasados quedan donde estaban. Documentado: mover el parent es semántica "editar esta y futuras".

### Neutras

- Profundidad fija de 1: no hay "series de series". Si en el futuro hace falta, la migración es localizada (añadir nivel de indirección).
- `recurrence_rule` jsonb permite extender el formato sin migración: añadir `freq: 'monthly'` en F12 sería compatible hacia atrás. Pero no se diseña para eso: si llega esa necesidad, se reabre con un nuevo ADR.

## Alternatives considered

- **Opción B — RRULE iCalendar (rfc5545) con expansión virtual**: cubre casos exóticos ("tercer martes de cada mes excepto julio") y es el estándar de facto en calendarios. Descartada porque:
  - Coste de implementación correcto es alto: librerías como `rrule.js` añaden ~60KB al bundle de cliente, y la implementación server-side de la expansión (con DST + exclusiones + RECURRENCE-ID) es notoriamente bug-prone.
  - El dominio no lo necesita: en fútbol base nadie diseña entrenamientos con reglas tipo iCal.
  - Edición individual obligaría a un modelo de "exception dates" + "overrides" que complica el modelo de datos sin aportar valor para Ola 1.
  - Performance: cada query de calendario expande virtualmente N reglas, vs lectura directa indexada en A.

- **Opción C — sin recurrencia**: cero código, cero modelo. Descartada porque:
  - Fricción inaceptable: 100+ entrenamientos a mano por equipo y temporada.
  - El primer feedback de la beta sería "necesito copiar el entrenamiento de la semana pasada". Implementar A en F3 evita esa iteración.

- **Híbrido: regla simple en F3 con upgrade a RRULE en Ola 3 si se pide**: descartado porque el modelo de datos sería el mismo (parent + children), y los clientes downstream (F4, F5, F12) ya quedan resueltos con A. Pasar a RRULE significaría añadir capacidad de excepciones complejas, lo cual es un cambio independiente. No se planea.
