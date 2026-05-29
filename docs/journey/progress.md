# Progreso — MisterFC Ola 1

Estado de cada una de las 17 fases del Plan Maestro. La fuente de verdad detallada es [plan-maestro.md](plan-maestro.md).

**Leyenda**: ☐ pendiente · ⟳ en curso · ☑ completada

| Fase | Título | Estado | Inicio | Cierre |
|---|---|---|---|---|
| 0 | Bootstrap del repositorio y andamiaje | ☑ completada | 2026-05-26 | 2026-05-27 |
| 1 | Identidad, Auth y modelo de roles base | ☑ completada | 2026-05-27 | 2026-05-28 |
| 2 | Estructura del club, plantilla y cuerpo técnico | ☑ completada | 2026-05-28 | 2026-05-29 |
| 3 | Calendario unificado y comunicación básica | ☐ pendiente (siguiente) | — | — |
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

## Fase 2 — Cierre

- **Inicio**: 2026-05-28 — **Fin**: 2026-05-29
- **PRs**: #10 (lote A: 2.0 + 2.1), #11 + #12 (hotfixes F2.0), #13 (lote B: 2.2-2.5), #14 (lote C: 2.6-2.8), #15 (fix invitation accept flow), #16 (lote D: 2.9) — **7 PRs** (≈30 commits).
- **Lotes**: A (shell + CRUD), B (jugador + familia + foto + histórico), C (staff + capabilities + mi-plantilla), D (import).
- **Tiempo estimado**: 14–23h. **Real**: ≈18–20h efectivos (entró cómodamente en el rango).
- Más detalle en [fase-2-summary.md](fase-2-summary.md).

---

## Notas

- Al cerrar cada fase, mover su fila a `☑` y rellenar la fecha de cierre.
- Si una subfase concreta dentro de una fase cierra, registrar `[hecho YYYY-MM-DD]` en [plan-maestro.md](plan-maestro.md) (esta tabla solo refleja el cierre de fase).
- Cierres de fase con cierta complejidad (>5 subfases o >1 lote) van acompañados de un `fase-N-summary.md` con bugs cazados, decisiones técnicas y lecciones.
