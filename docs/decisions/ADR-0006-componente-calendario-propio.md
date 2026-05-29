- **Status**: Accepted
- **Date**: 2026-05-29
- **Deciders**: Iker Milla
- **Related**: ADR-0000 (stack técnico), ADR-0005 (estrategia de recurrencia), Fase 3 del Plan Maestro, `docs/specs/3.0-calendario-eventos.md`

# ADR-0006 — Componente propio de calendario sobre date-fns, no FullCalendar ni react-big-calendar

## Context

La Fase 3 introduce la vista `/calendario` con tres modos (mes, semana, agenda). Tres caminos posibles:

- **FullCalendar** (open-source + plugins). Estándar de facto. Soporte React 19 estable. ~150 KB gz + DOM relativamente pesado. Tema CSS propio que choca con Tailwind v4 / shadcn / Radix existentes.
- **react-big-calendar**. API más simple, pero arrastra `moment` o adaptador `date-fns`. Soporte táctil en iPad mediocre. UI menos pulida.
- **Componente propio** sobre `date-fns@^4` (TZ-aware) + primitivas shadcn/Radix existentes (`Tabs`, `Dialog`, `Sheet`, `Popover`, `Button`). Tailwind v4 CSS Grid para las celdas.

El target prioritario de la app es **iPad apaisado** (la pantalla de toma de datos en directo del partido en F7 también lo es). La PWA es Ola 1: cada KB importa. La estética del producto ya está fijada por shadcn (new-york + neutral) y cualquier librería externa rompe coherencia visual sin override pesado.

Adicionalmente, hay dos consumidores downstream del mismo grid temporal:

- **F12 — Planificador de sesiones**: vista de microciclo semanal. El layout es el mismo grid 7 columnas × slots verticales que la vista semana del calendario. Reutilizable al 100% si el componente vive en `apps/web` y exporta primitivas.
- **F4 — Asistencia y convocatorias**: vista agenda compacta del entrenador. Reutiliza la vista agenda y los pills de evento.

Reescribir el grid en F12 si se mete una librería externa en F3 supondría 4–6h de duplicación, además del riesgo de inconsistencia visual entre `/calendario` y `/planificador`.

## Decision

**Componente de calendario propio**, construido sobre:

- **`Intl.DateTimeFormat` + `Date` nativos** para aritmética y formateo TZ-aware (Europe/Madrid). En la implementación se descartó `date-fns@^4` (planeado en la spec original) porque las funciones que íbamos a usar (`startOfWeek`, `addDays`, `eachDayOfInterval`, `format`) se cubren con ~150 LoC de helpers propios que comparten lógica TZ-aware con el generador de recurrencia (`packages/core/src/events/tz.ts`).
- Tailwind v4 CSS Grid para layouts mes/semana.
- Primitivas existentes de shadcn/Radix (`Tabs`, `Dialog`, `Popover`, `Button`, `Select`, `Switch`, `AlertDialog`).
- Iconos lucide-react ya presentes.

Vive en `apps/web/src/app/[locale]/(authenticated)/calendario/_components/` con tres componentes principales (`CalendarMonth`, `CalendarWeek`, `CalendarAgenda`) y subcomponentes (`EventPill`, `EventDialog`, `EventDeleteDialog`, `CalendarHeader`, `CalendarFilters`).

Las funciones de cálculo puras (semana actual, lista de días del mes, agrupación por día para agenda) viven inline en el componente; las que tienen valor cross-fase (recurrencia, expansión por TZ, validaciones) viven en `packages/core/src/events/`.

### Presupuesto

3–4 h extra dentro del rango total de F3 (6–9 h). Si en implementación se va más allá, se pausa y se reevalúa antes de seguir (instrucción explícita del responsable).

## Consequences

### Positivas

- **Bundle**: cero KB extra de librerías de fechas (Intl es nativo), frente a ~150 KB gz de FullCalendar o ~25 KB del subset de date-fns inicialmente planificado. Crítico para la PWA en iPad/Android.
- **Coherencia visual**: 100% Tailwind v4 + shadcn/Radix. Sin override CSS, sin temas paralelos, sin `!important` para imponer estilos.
- **Reutilización F12 al 100%**: el grid semanal se exporta como primitiva y F12 lo embebe sin reescritura. Ahorro estimado: 4–6 h en F12.
- **Reutilización F4**: vista agenda y pills se reutilizan en `/asistencia` sin adaptación.
- **Control sobre iPad apaisado**: layout grid + touch nativo (sin gestos custom) da mejor UX que adaptar drag-and-drop de FullCalendar.
- **Accesibilidad**: focus management + ARIA heredados de Radix. Predecible, testeable.
- **Cero dependencia nueva externa significativa**: solo `date-fns`. Mantenimiento operativo bajo.
- **Server Components first**: como no necesita librería cliente, el render principal es Server Component. Solo los componentes interactivos (`EventDialog`, `CalendarFilters`) son `"use client"`. Reduce JS enviado.

### Negativas

- **Esfuerzo inicial mayor**: 3–4 h extra en F3 vs ~1 h de wiring de una librería externa. Asumido en la estimación 6–9 h de la fase.
- **Reinventar lo conocido**: corner cases que FullCalendar ya resuelve (overlap de eventos, scroll de horarios, accesibilidad de selección por teclado) los tenemos que cubrir manualmente. Aceptable por scope acotado de Ola 1: no necesitamos drag-and-drop de eventos en el grid, no necesitamos "vista anual", no necesitamos export iCal.
- **No tenemos un tercero que mantenga**: bugs futuros del componente los arreglamos nosotros. Aceptable porque la superficie es chica (~300–500 LoC) y las dependencias (date-fns + Tailwind) son ultra-estables.
- **Riesgo de scope creep**: si la implementación destapa edge cases (eventos solapados en la vista semana, zonas horarias mixtas en el futuro), podríamos exceder el presupuesto. Mitigación: si al cerrar 3.2 el bundle del componente excede claramente las 4 h estimadas, parar y reevaluar (instrucción explícita).

### Neutras

- **Cero dependencias nuevas en F3** (eliminado date-fns durante implementación). El TZ-awareness se hace con `Intl.DateTimeFormat` resolviendo offsets de DST en dos pasadas (helper `fromZonedFields` en `packages/core/src/events/tz.ts`, ~60 LoC). Cubre DST primavera/otoño Madrid con tests Vitest.
- El componente queda en `apps/web` (no en `packages/core`) porque depende de React, Tailwind y shadcn/Radix. La lógica pura (recurrencia, schemas, TZ) sí vive en `packages/core` para reusabilidad en Ola 2 (React Native, donde Intl también está disponible).

## Alternatives considered

- **FullCalendar (open-source) con plugins**: descartado por bundle (~150 KB), choque visual con shadcn, sobrecoste de override CSS, falta de reutilización para F12 (su grid microciclo es semánticamente distinto y obligaría a un segundo componente). Las features avanzadas (drag-and-drop de eventos, resize, export iCal) no se necesitan en Ola 1; pagar el coste sin usar las ventajas no se justifica.

- **react-big-calendar**: descartado por dependencia histórica de `moment` (legacy aunque permite adaptador date-fns), UX táctil mediocre en iPad apaisado, y el mismo problema de reutilización que FullCalendar para F12. Su API es la más simple de las tres librerías, pero esa simplicidad no compensa los otros vectores.

- **Componente propio sobre Luxon en vez de date-fns**: Luxon tiene mejor manejo de TZ pero es ~70 KB vs ~25 KB de date-fns subset. date-fns v4 ya incluye TZ nativo, lo cual cierra la ventaja de Luxon. Descartado por bundle.

- **Componente propio sobre Temporal (proposal nativo)**: API limpia pero polyfill ~30 KB y aún no estable en todos los browsers objetivo (Safari iOS principalmente). Reevaluable en Ola 2 cuando madure.

- **Componente propio sin date-fns, solo `Intl` y `Date`**: técnicamente posible para mes/semana básicos, pero TZ + DST + locale (es/en/va) es justo lo que date-fns resuelve bien. Reinventarlo sería sub-óptimo y bug-prone.
