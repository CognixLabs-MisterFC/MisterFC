# Fase 10 — Resumen ejecutivo de cierre

> Subfase del Plan Maestro: **Fase 10 — Dashboard ejecutivo del club**.
> Estado: ☑ cerrada 2026-06-14 (10.1–10.6 entregadas y verificadas).
> Spec: [10.0 dashboard-ejecutivo](../specs/10.0-dashboard-ejecutivo.md) (toda la fase, **Variante A** — agregación por query directa + helpers puros, sin BD nueva).

F10 convierte la app en un **tablero de dirección**: una pantalla `/dashboard` agregada a nivel de club, solo para **`admin_club` y `coordinador`**, que reúne de un vistazo plantilla, resultados, asistencia, rankings y alertas — **reutilizando** los helpers de `@misterfc/core/player-profile` (núcleo de F9) sin rehacer agregaciones.

La fase se especificó **íntegra** en una sola spec (no por tramos) y se entregó **subfase a subfase**, cada una dejando `main` en verde.

---

## Fechas y volumen

- **Spec**: PR #118 (2026-06-13).
- **Implementación**: 2026-06-13 → 2026-06-14 (10.0–10.6).
- **Estimación de fase (plan)**: 6–8 h · 2–3 sesiones.
- **PRs**: #118 (spec) + #119–#127 de implementación (7 subfases). Todos **MERGED**, ninguno mergeado por el agente (los mergea el responsable).

> **Nota de fidelidad a la estimación** ⚠️: el roadmap etiquetó F10 como "reúso / riesgo bajo, 6–8 h" partiendo de que "reusa stats ya generadas". En la práctica la **agregación club-wide** (censo, resultados acumulados, asistencia agregada con tendencia y rankings cross-equipo) fue **net-new**: el núcleo de F9 da stats **por jugador / por equipo**, no por club. Lo reutilizable fue el *patrón* (D9-C: helpers puros + loaders que delegan) y piezas concretas (recharts + tabla `sr-only` de 9.B-2, buckets de asistencia ADR-0007), no la lógica de agregación. La fase **pudo rozar o exceder** el extremo alto de la estimación; ya anticipado como riesgo en la spec (§0, §11).

---

## Subfases entregadas con PR (mapa REAL verificado contra el repo)

> Troceo **Variante A** de la spec (§10): `10.0 → 10.1 → {10.2, 10.3, 10.4, 10.6} → 10.5`. Orden de entrega real abajo. La **10.1 del roadmap** ("modelo de stats agregadas + cache / vistas materializadas") se **reinterpretó** como "modelo de agregación club-wide en helpers puros" (sin MV) — ver `DT1`.

| Subfase | PR | Resumen |
|---|---|---|
| — (spec) | #118 | `docs(f10)`: spec del dashboard ejecutivo (cierra `D1`–`D7`, `DT1`–`DT3`; troceo Variante A; verificaciones RLS club-wide y existencia F2.10/F2.11) |
| 10.0 | #119 | **Helpers de agregación club-wide en core** (puros + Vitest): `aggregateClubStats` (censo), `aggregateTeamResults` (W-D-L / GF-GA con `D2`), `clubAttendanceAgg` (media + ranking + tendencia por semana ISO), `clubRankings` (por categoría, `D5`). Sin queries, sin UI, sin BD |
| 10.1 | #120 | **Ruta `/dashboard` + nav + loader base + censo**: gating server-side (`admin_club`/`coordinador`, redirige al resto), entrada de nav role-aware, `loadClubDashboardBase` + `loadSeasonCensus` (sin N+1, `IN(teamIds)`), sección plantilla con total y distribución por categoría/equipo |
| 10.2 | #121 | **Comparativa de plantilla + enlaces**: temporada activa vs anterior (`D1`) con deltas por categoría; enlaces a los listados completos `/jugadores` (F2.10) y `/cuerpo-tecnico` (F2.11) — no los duplica |
| 10.3 | #123 | **Resultados acumulados por equipo** (`aggregateTeamResults`): W-D-L y GF-GA con `D2` (solo `match_state.status='closed'`; GF/GA `null` en closed = marcador no registrado, no suma 0; "cerrado sin marcador" se nota aparte) |
| 10.4 | #125 | **Asistencia** (media + ranking + **tendencia**): `clubAttendanceAgg` sobre `training_attendance`; gráfico de línea por semana (`<AttendanceTrend>` recharts `dynamic(ssr:false)` + tabla `sr-only`, patrón de 9.B-2) |
| 10.6 | #126 | **Rankings por categoría** (`D5`): goleadores, MVPs y mejor media de valoración, segmentados por categoría (no global); top-N con empates (competition ranking) y suelo de muestra. **No** gateado por el flag de visibilidad (`D6`) |
| 10.5 | #127 | **Alertas** (cierra F10): baja asistencia (`D3`: `presentPct < 60%` y `≥ 5` sesiones) + inactivos (`D4`: en roster sin `match_player_stats` **ni** `training_attendance`). `loadClubAlerts` con 3 queries `IN(teamIds)`; estado "todo en orden" en verde cuando no hay alertas |

> **Nota de numeración**: la **10.6** (rankings) se entregó **antes** que la **10.5** (alertas) porque 10.5 depende de la agregación de asistencia de 10.4, mientras que 10.6 solo dependía de 10.1. El troceo de la spec ya lo contemplaba (`10.5` tras `10.4`; `10.6` en el lote paralelo). 10.5 fue la que **cerró** la fase.

---

## Decisiones de diseño (resumen desde spec 10.0 §6)

### Decisiones técnicas de la fase (`DT`)

| # | Decisión | Resolución aplicada |
|---|---|---|
| DT1 | ¿Materializar la agregación club-wide? | **No.** Query directa + helpers puros (patrón D9-C). La "10.1 vistas materializadas" del roadmap se reinterpretó como "modelo de agregación club-wide en helpers". **MV no materializada** → optimización futura (ver Diferidos). |
| DT2 | ¿Dónde vive el cálculo? | **Helpers puros en `@misterfc/core`** (testeables sin Supabase); loaders en `apps/web` leen de Supabase y **delegan**; **cero lógica de agregación en componentes**. |
| DT3 | ¿RLS cubre lecturas club-wide de admin/coord? | **Sí**, verificado (§4.3 de la spec). **Sin políticas nuevas, sin migraciones, sin pgTAP nuevo.** |

### Decisiones de producto (`D1`–`D7`)

| # | Decisión | Resolución aplicada |
|---|---|---|
| D1 | Alcance temporal | **Temporada activa** + comparativa con la anterior **solo** en la sección plantilla. Selector libre de temporada → v2. |
| D2 | Qué cuenta como "resultado" | **Solo** `match_state.status='closed'`; sin captura no computa. GF/GA `null` aun en closed = marcador no registrado → **no suma** (no es 0). |
| D3 | Umbral "baja asistencia" | `presentPct < 60%` (estricto) **y** `≥ 5` sesiones registradas. Umbrales en `CLUB_ALERT_THRESHOLDS` (core), estilo `BADGE_THRESHOLDS`. |
| D4 | "Jugador inactivo" | En el roster de la temporada **sin ningún** `match_player_stats` **NI** `training_attendance`. Una sola señal basta para no marcarlo. |
| D5 | Alcance de rankings | **Por categoría**, no un ranking único global. |
| D6 | Rankings de rating vs flag de visibilidad | **No se ocultan** por `evaluations_player_visibility`. **Ruptura deliberada de la regla de F9 (D5 de 9.B)**: aquí el público es solo admin/coord, que ya ven las valoraciones por RLS. El flag sigue protegiendo a la familia/jugador en *sus* vistas. |
| D7 | Export PDF del dashboard | **Diferido** (fuera del criterio de cierre). La infra PDF de 9.B queda disponible para v2. |

---

## Estado de verificación

Cada PR dejó `main` en verde con la batería estándar:

- **typecheck** ✅ · **lint** ✅ · **test** ✅ (Vitest de los helpers puros de core) · **build** ✅.

### Sin superficie de BD nueva

- F10 **no crea tablas, vistas, funciones ni políticas** (`DT1`/`DT3`): toda la lectura va por RLS heredada de admin/coord. → **sin migraciones y sin pgTAP nuevo** en toda la fase.
- En consecuencia, la limitación conocida de pgTAP-fuera-de-CI (F15.8 / `known-issues`) **no afecta** a F10: no hubo SQL nuevo que validar.

---

## Diferidos registrados (futuro)

El cierre deja fuera, deliberadamente, los siguientes puntos:

1. **Export PDF del dashboard** (`D7`) — la infra `@react-pdf/renderer` de 9.B (PDFs de jugador/equipo) queda disponible para reutilizar en v2.
2. **Vistas materializadas / cache de BD** (`DT1`) — la agregación club-wide es por query directa. Si con datos reales del piloto el dashboard fuese lento, la optimización natural es materializar `aggregateClubStats`/`clubAttendanceAgg` en una MV con función `SECURITY DEFINER` / vista `security_invoker` que preserve la RLS + refresco por cron o trigger. **Anotar como deuda solo si el perfilado lo exige; no se hace en v1.**
3. **Selector libre de temporada** (`D1`) — v2; v1 fija temporada activa + comparativa con la anterior solo en plantilla.

> **Roadmap adyacente**: la **F11B "pizarra táctica en vivo"** ya está registrada en el plan (intercalada **tras F11 y antes de F12**, sin renumerar F12–F16; PR #124). No depende de F10.

---

## Próximo paso

Con 10.1–10.6 cerradas, **F10 queda completa**. Según el orden del Plan Maestro, el siguiente hito es **F11 (Biblioteca de ejercicios)**, que introduce el `PitchEditor` reutilizado luego por **F11B** (pizarra en vivo) y F13.
