# Fase 9 — Resumen ejecutivo de cierre

> Subfase del Plan Maestro: **Fase 9 — Perfil del jugador, evolución y reportes**.
> Estado: ☑ cerrada 2026-06-12 (núcleo + segundo tramo 9.B entregados y verificados).
> Specs: [9.0 perfil-jugador](../specs/9.0-perfil-jugador.md) (núcleo) · [9.B segundo-tramo](../specs/9.B-segundo-tramo.md) (multi-temporada · badges · PDFs).

F9 se entregó en **dos tramos** con un **rework estructural intercalado**:

- **Núcleo (9.1/9.2/9.3/9.5)** — milestone cerrado 2026-06-09 (detalle en spec 9.0 §15). Convirtió `/jugadores/[playerId]` y `/mi-ficha` en un expediente deportivo **de una temporada**.
- **Rework A** (la temporada baja al equipo, `teams.season`) — cerrado 2026-06-10, entre el núcleo y el segundo tramo (la multi-temporada se apoya en él). Tiene su propia sección en el plan-maestro y [ADR-0017](../decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md); no se re-resume aquí.
- **Segundo tramo (9.B: 9.4/9.6/9.7/9.8 + entrada de menú)** — cerrado 2026-06-12. Es el objeto principal de este documento.

---

## Fechas y volumen

- **Núcleo**: entregado 2026-06-09 · **PRs**: #67 (9.1), #68 (9.2), #69 (9.3), #70 (9.5).
- **Segundo tramo 9.B**: spec 2026-06-12, implementación 2026-06-12.
- **Estimación de fase (plan)**: 16–32 h · **Sesiones**: 6–8.
- **PRs del segundo tramo**: #108 (spec) + #109–#115 (7 PRs de implementación). Todos **MERGED**.

---

## Subfases entregadas con PR (mapa REAL verificado contra el repo)

### Núcleo (spec 9.0)

| Subfase | PR | Resumen |
|---|---|---|
| 9.1 | #67 | Perfil deportivo con stats agregadas (vista staff, agregación por query directa — D9-C; selector de temporada; helpers en `@misterfc/core/player-profile`) |
| 9.2 | #68 | Stats derivadas (ratios) + desglose de asistencia por código (cálculo puro, buckets ADR-0007) |
| 9.3 | #69 | Gráfico de evolución intra-temporada de la valoración (recharts, **ADR-0016**; tabla `sr-only` equivalente) |
| 9.5 | #70 | Vista jugador/familia `/mi-ficha` + policy SELECT nueva en `match_player_stats` (`user_is_account_of_player`, sin flag — 🔒 D9-1) + pgTAP |

> Migración del núcleo: `20260625000000_match_player_stats_player_select.sql`.

### Segundo tramo 9.B (spec 9.B)

| Subfase | PR | Resumen |
|---|---|---|
| — (spec) | #108 | `docs(f9)`: spec del segundo tramo (multi-temporada · badges · PDFs) |
| 9.B-0 | #109 | **Agregado de stats de equipo por temporada** (habilitador): `aggregateTeamStats` en core + query. Lo consumen 9.B-3, 9.B-7 y los badges de equipo |
| 9.B-1 | #110 | **9.4 multi-temporada (core)**: `careerBySeason`, `careerTotals`, `seasonComparison` + tests |
| 9.B-2 | #111 | **9.4 multi-temporada (UI)**: toggle Temporada/Carrera en `/jugadores/[playerId]` y `/mi-ficha`; tabla por temporada + gráfico de comparación (recharts + tabla `sr-only`). Respeta recortes de /mi-ficha |
| 9.B-3 | #112 | **Estadísticas agregadas por equipo (UI + menú)**: vista de equipo (consume 9.B-0) + entrada `estadisticas_equipo` para cuerpo técnico (§5 del spec) |
| 9.B-4 | #113 | **9.6 badges (core)**: `evaluateSeasonBadges` / `evaluateCareerBadges` sin persistencia (D6) + thresholds documentados |
| 9.B-5 | #114 | **9.6 badges (UI)**: sección "Logros" con chips/tooltips en expediente y /mi-ficha; badges rating-sensibles computados en servidor y gateados por el flag (D5) |
| 9.B-6 + 9.B-7 | #115 | **PDFs de jugador y equipo** (juntos: comparten infra y branding). `@react-pdf/renderer` en Route Handlers heredando RLS (D7); `PlayerPdfDocument` + `TeamPdfDocument`; botones "Exportar PDF". Sin gráficos (D8), idioma = locale del usuario (D9), solo descarga (D10) |

> **Nota de numeración**: 9.B-6 (infra + PDF jugador) y 9.B-7 (PDF equipo) se entregaron en **un solo PR (#115)** por compartir infraestructura (`lib/pdf/shared.tsx`) y branding. El spec los troceaba como dos subfases; la realidad de entrega los unió.

---

## Decisiones de diseño D1–D11 (resumen desde spec 9.B §6)

| # | Decisión | Resolución aplicada |
|---|---|---|
| D1 | Ratios de carrera | **Sobre los agregados** (Σgoles·90 / Σmin), nunca media de medias. |
| D2 | Multi-equipo en una temporada | **Sumar** los equipos dentro de la temporada (un partido = un equipo). |
| D3 | Rating en total de carrera | **Por temporada** y en comparación; en carrera, media etiquetada + nº de valoraciones. |
| D4 | Catálogo de badges + umbrales | Catálogo §3.2; **umbrales fijos en core (v1)**, configurables más adelante. |
| D5 | Badges sensibles a valoraciones | Computados en **servidor** y gateados por `club_settings.evaluations_player_visibility` (no se envían si oculto). |
| D6 | Persistir badges | **No** en este tramo: derivados al vuelo. Tabla `player_badges` = fase futura. |
| D7 | Librería PDF | **@react-pdf/renderer**, server Route Handler, RLS heredada (no es puerta trasera). |
| D8 | Gráficos en PDF | **Fuera de v1**: tabla equivalente (`sr-only`). → diferido v2 PDF. |
| D9 | Idioma/branding PDF | Locale del usuario; cabecera con nombre del club + verde de marca. (`clubs` **no tiene** columna de escudo → escudo diferido a v2.) |
| D10 | Alcance export | Solo **descarga** (sin email) en este tramo. → email diferido a comunicaciones. |
| D11 | Ruta de stats de equipo | Sub-ruta/sección dentro del equipo, con botón Exportar PDF al lado. |

---

## Catálogo de badges aprobado (12 implementadas)

Derivadas al vuelo de stats existentes (D6, cero persistencia). Umbrales fijos en core (D4) — `BADGE_THRESHOLDS` en `packages/core/src/player-profile/badges.ts`. Las rating-sensibles se gatean por el flag del club (D5).

**Relativas al roster (temporada):**
- `top_scorer_team` — máximo de goles del equipo (Pichichi del equipo).
- `top_assister_team` — máximo de asistencias del equipo.

**Por jugador, absolutas (temporada):**
- `top_scorer` — goles ≥ 10.
- `iron_man` — partidos ≥ 15 (regularidad).
- `clean_play` — 0 rojas y ≤ 0,25 amarillas/partido con ≥ 5 partidos.
- `penalty_killer` — ≥ 3 penaltis con ratio de acierto ≥ 0,8.
- `starter_streak` — % titularidad ≥ 90% con ≥ 5 partidos.
- `perfect_attendance` — 100% de presencia con ≥ 5 sesiones.

**Rating-sensibles (temporada, gateadas por el flag — D5):**
- `mvp_match` — conteo de selecciones reales del entrenador (`evaluations.is_mvp`); niveles [1, 3, 5] (×N).
- `mvp_season` — **relativa**: mejor media de valoración del equipo con suelo de muestra.
- `high_rating` — **absoluta**: media ≥ 7,5 con ≥ 5 valoraciones.

**Carrera:**
- `veteran` — hitos de partidos de carrera [50, 100, 200].

> **Revisión de producto durante 9.B-4**: la idea original de un único badge "MVP" se **desdobló** en tres para no mezclar conceptos distintos:
> - **`mvp_match`** = selección real del entrenador (dato duro, `evaluations.is_mvp`), por conteo.
> - **`mvp_season`** = mérito **relativo** dentro del equipo (mejor media), con suelo de muestra para que no lo gane quien jugó un solo partido.
> - **`high_rating`** = mérito **absoluto** (umbral 7,5), independiente del resto del roster.
>
> El badge **"debutante"** del catálogo del spec (§3.2) **no se implementó**: su regla quedó sin cerrar (primer partido registrado, ± ventana) → diferido (ver plan-maestro, diferidos de F9).

---

## Estado de verificación

Cada PR del segundo tramo dejó `main` en verde con la batería estándar:

- **typecheck** ✅ · **lint** ✅ · **test** ✅ (Vitest de los helpers puros de core) · **build** ✅.

### ⚠ Limitación conocida — pgTAP no se ejecuta automáticamente

- El **CI** (`.github/workflows/ci.yml`) corre typecheck · lint · test · build, pero **no ejecuta pgTAP**.
- El **sandbox de desarrollo** no puede arrancar **Docker** (flag `no-new-privileges`, sin root), así que `pnpm db:test` no corre localmente.
- **Consecuencia**: los tests pgTAP de funciones/RLS de BD quedan **escritos en el repo** pero **sin ejecución automática**; su validación efectiva ocurre al **aplicar la migración contra el remoto**. F9 (lectura/UI mayormente) tuvo poca superficie de BD nueva, pero el riesgo es transversal y crece con cada función SECURITY DEFINER.
- **Diferido como tarea de calidad/infra**: ejecutar pgTAP de verdad en CI (o un paso contra el remoto) → ver **F15.8** en el plan-maestro y la entrada en `known-issues.md`.

---

## Diferidos registrados (detalle en plan-maestro)

El cierre dejó varios puntos **deliberadamente fuera**, ubicados en el roadmap (ver plan-maestro §6 "Diferidos de F9", §Backlog/futuro y F15.8):

1. **God user / superuser de plataforma** (acceso transversal multi-club) + **owner de club** (admin protegido no degradable + transferencia de propiedad) → **fase posterior de gestión multi-club** (Backlog/futuro). El owner-de-club es el sucesor natural de la guarda del último admin (Bug 2·2b, PR #116).
2. **Email propio como canal** (remitente verificado del dominio, envío masivo a familias con enlace de descarga del PDF, auto-envío del `invite_email` de A5, retirada del magic-link) → **comunicaciones/onboarding** (consolida F16.0 SMTP + F16.x bulk-invite + D10).
3. **Badge "debutante"** (regla por definir) → backlog de badges.
4. **Badges absolutas por categoría** (10 goles / 50–100–200 partidos no escalan entre edades) → refinamiento v2.
5. **Gráficos en el PDF** (D8) y **escudo del club** en la cabecera (cuando `clubs` tenga columna de logo) → v2 PDF.
6. **pgTAP en CI** (o paso contra el remoto) → F15.8 / known-issues.

---

## Próximo paso

Con el núcleo + 9.B cerrados, **F9 queda completa**. El siguiente hito natural es **F10 (Dashboard ejecutivo del club)**, que reutiliza los agregados/helpers de `@misterfc/core/player-profile` (stats, ratios, agregado de equipo, multi-temporada) sin rehacerlos.
