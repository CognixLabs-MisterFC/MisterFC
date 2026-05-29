# Progreso — MisterFC Ola 1

Estado de cada una de las 17 fases del Plan Maestro. La fuente de verdad detallada es [plan-maestro.md](plan-maestro.md).

**Leyenda**: ☐ pendiente · ⟳ en curso · ☑ completada

| Fase | Título | Estado | Inicio | Cierre |
|---|---|---|---|---|
| 0 | Bootstrap del repositorio y andamiaje | ☑ completada | 2026-05-26 | 2026-05-27 |
| 1 | Identidad, Auth y modelo de roles base | ☑ completada | 2026-05-27 | 2026-05-28 |
| 2 | Estructura del club, plantilla y cuerpo técnico | ⟳ extendida 2026-05-29 | 2026-05-28 | lote inicial 2026-05-29 |
| 3 | Calendario unificado y comunicación básica | ☑ completada | 2026-05-29 | 2026-05-29 |
| 4 | Asistencia y convocatorias | ☐ pendiente | — | — |
| 5 | Mensajería interna y push notifications | ☐ pendiente | — | — |
| 6 | Editor de alineaciones F7/F8/F11 | ☐ pendiente | — | — |
| 7 | Pantalla de toma de datos del partido (live) | ☐ pendiente | — | — |
| 8 | Valoraciones de partido y entrenamiento | ☐ pendiente | — | — |
| 9 | Perfil del jugador y evolución multi-temporada | ☐ pendiente | — | — |
| 10 | Dashboard ejecutivo del club | ☐ pendiente | — | — |
| 11 | Biblioteca de ejercicios | ☐ pendiente | — | — |
| 12 | Planificador de sesiones con plantillas microciclo | ☐ pendiente | — | — |
| 13 | Pizarra táctica 2D con animación | ☐ pendiente | — | — |
| 14 | RGPD para menores | ☐ pendiente | — | — |
| 15 | Testing E2E, observabilidad y runbook | ☐ pendiente | — | — |
| 16 | Beta cerrada con primer club | ☐ pendiente | — | — |

---

## Fase 2 — Subfases entregadas

> **F2 extendida 2026-05-29** con nuevas subfases (2.10, 2.11) tras feedback de uso real. Lote inicial (2.0–2.9) **sigue cerrado y sin cambios**; lo que se reabre es el alcance, no el código entregado. Ver [plan-maestro.md](plan-maestro.md) §Fase 2.

| Subfase | Cierre | Resumen |
|---|---|---|
| 2.0 | 2026-05-28 | App shell + nav role-aware + `/perfil` + avatares privados |
| 2.1 | 2026-05-28 | CRUD categorías + equipos |
| 2.2 | 2026-05-28 | Ficha del jugador + bucket privado `player-photos` + medical_notes con visibilidad |
| 2.3 | 2026-05-28 | Alta de jugador con dialog (sin cuenta vinculada) |
| 2.4 | 2026-05-28 | Vincular cuentas familia al jugador menor (`player_accounts` + invitations player_id) |
| 2.5 | 2026-05-28 | Histórico del jugador en el club (`team_members` con `joined_at`/`left_at`) |
| 2.6 | 2026-05-28 | Cuerpo técnico: tabla `team_staff` + UI `/equipos/[teamId]` |
| 2.7 | 2026-05-28 | UI capabilities del ayudante (shadcn Switch + optimistic UPSERT) |
| 2.8 | 2026-05-28 | Vista `/mi-plantilla` read-only del entrenador |
| 2.9 | 2026-05-29 | Import masivo CSV/Excel (wizard 4 pasos, primer Vitest del repo) |

### Fase 2 — Subfases pendientes (extensión)

| Subfase | Estado | Resumen | Spec |
|---|---|---|---|
| 2.10 | ☐ pendiente | Listado global de jugadores del club con filtros + asignación individual a equipo | [docs/specs/2.10-listado-global-jugadores.md](../specs/2.10-listado-global-jugadores.md) |
| 2.11 | ☐ pendiente | Gestión global de cuerpo técnico (equipos asignados, horarios, agenda F3) | [docs/specs/2.11-gestion-global-cuerpo-tecnico.md](../specs/2.11-gestion-global-cuerpo-tecnico.md) |

## Fase 3 — Subfases entregadas

| Subfase | Cierre | Resumen |
|---|---|---|
| 3.1 | 2026-05-29 | Modelo `events` + capability `can_manage_calendar` + RLS + 19 pgTAP |
| 3.2 | 2026-05-29 | UI calendario (mes/semana/agenda) componente propio sobre Intl+Date |
| 3.3 | 2026-05-29 | CRUD eventos (createEvent / updateEvent / deleteEvent) con permisos |
| 3.4 | 2026-05-29 | Filtros equipo/categoría/tipo con estado URL serializado |
| 3.5 | 2026-05-29 | Recurrencia weekly opción A (parent + children, ADR-0005), 23 Vitest del generador |

## Fase 3 — Cierre

- **Inicio / Fin**: 2026-05-29 (un solo lote, dentro de presupuesto 6–9h).
- **PR**: uno único con spec + ADR-0005 + ADR-0006 + migraciones + UI + i18n es/en/va.
- **Tests añadidos**: 38 Vitest nuevos (15 TZ + 15 recurrencia + 8 schemas events) + 19 casos pgTAP RLS/CHECK/helpers de `events`. Sigue verde en CI.
- **Decisión de impl que difiere de spec original**: se eliminó `date-fns` durante la implementación (Intl + Date nativos cubren el caso con cero KB extra). ADR-0006 actualizado antes del merge.
- **Known-issue nueva**: `F3-rls-events-visibilidad` (jugador puede consultar API vía REST eventos de equipos a los que no pertenece; intencional Ola 1, endurecer en F14).

## Fase 2 — Cierre

- **Inicio**: 2026-05-28 — **Fin**: 2026-05-29
- **PRs**: #10 (lote A: 2.0 + 2.1), #11 + #12 (hotfixes F2.0), #13 (lote B: 2.2-2.5), #14 (lote C: 2.6-2.8), #15 (fix invitation accept flow), #16 (lote D: 2.9) — **7 PRs** (≈30 commits).
- **Lotes**: A (shell + CRUD), B (jugador + familia + foto + histórico), C (staff + capabilities + mi-plantilla), D (import).
- **Tiempo estimado**: 14–23h. **Real**: ≈18–20h efectivos (entró cómodamente en el rango).
- Más detalle en [fase-2-summary.md](fase-2-summary.md).

---

## Fase 16 — Subfases pendientes (anticipadas)

| Subfase | Estado | Resumen | Spec |
|---|---|---|---|
| 16.x | ☐ pendiente (ESPERA F16.0) | Bulk-invite de jugadores con email + team vía Excel/CSV | [docs/specs/16.x-bulk-invite-excel.md](../specs/16.x-bulk-invite-excel.md) |

---

## Notas

- Al cerrar cada fase, mover su fila a `☑` y rellenar la fecha de cierre.
- Si una subfase concreta dentro de una fase cierra, registrar `[hecho YYYY-MM-DD]` en [plan-maestro.md](plan-maestro.md) (esta tabla solo refleja el cierre de fase).
- Cierres de fase con cierta complejidad (>5 subfases o >1 lote) van acompañados de un `fase-N-summary.md` con bugs cazados, decisiones técnicas y lecciones.
- Las **extensiones** sobre fases ya cerradas se marcan `⟳ extendida YYYY-MM-DD` en la tabla principal y se documentan en su sección con la nota de qué se reabre y qué no.
