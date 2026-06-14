# Plan Maestro — MisterFC

> Plataforma de gestión, metodología y desarrollo deportivo para entrenadores de fútbol base y amateur.
>
> **Cognix Labs** · Versión 1.0 · 2026-05-26 · Deadline Ola 1: septiembre 2026 (beta cerrada con primer club)

---

## Índice

1. Resumen ejecutivo
2. Contexto y alcance del producto
3. Principios rectores
4. Cronograma alto nivel
5. Resumen de estimaciones
6. Fases F0–F16 (Ola 1)
7. Ola 2 — App nativa Android + iOS
8. Ola 3 — A definir tras feedback de beta
9. Fuera del plan (explícito)
10. Riesgos transversales y mitigaciones
11. Gestión de incidencias durante el plan
12. Próximo paso concreto

---

## 1. Resumen ejecutivo

MisterFC es un producto greenfield: no existe código previo. Este Plan Maestro articula su construcción en tres olas:

- **Ola 1 — MVP** (diecisiete fases, 0 a 16). Producto mínimo viable lanzable a beta cerrada con primer club como PWA instalable en iPad, Android y desktop. 159–243 h.
- **Ola 2 — App nativa Android + iOS**. Una vez validada Ola 1, se construye la app nativa para App Store y Google Play reutilizando `packages/core`. 50–70 h.
- **Ola 3 — A definir tras feedback de beta**. Espacio reservado para propuestas que surjan del uso real. Sin estimación todavía.

Toma como referencia metodológica el estándar técnico aplicado en los proyectos hermanos NIDO y VERTEX, ambos de Cognix Labs. La estructura de olas también está copiada de NIDO: primero la Ola 1 entera, luego la Ola 2 (app nativa) una vez validada, y solo entonces se evalúa el roadmap de Ola 3 con datos reales de uso.

---

## 2. Contexto y alcance del producto

MisterFC sustituye el caos habitual del entrenador de base (WhatsApp + libreta + Excel de stats + PDFs sueltos + carpeta de jugadas dispersa) por una herramienta única, instalable en cualquier dispositivo. El producto está pensado desde la realidad del fútbol amateur, no desde paradigmas profesionales que no aplican.

**Alcance de Ola 1**:

- Gestión del club: categorías, equipos, plantilla, cuerpo técnico con permisos configurables
- Calendario unificado y comunicación (mensajería interna, push)
- Asistencia a entrenamientos con códigos estructurados y convocatorias de partido con confirmación de padres
- Día de partido: alineaciones drag & drop + toma de datos en directo (iPad/desktop)
- Valoraciones de partido y entrenamiento
- Perfil deportivo del jugador con evolución multi-temporada y reportes mensuales PDF
- Dashboard ejecutivo del club
- Biblioteca de ejercicios + planificador de sesiones con plantillas microciclo
- Pizarra táctica 2D con animación + modo presentación iPad
- RGPD para menores

**Fuera de Ola 1** (decisión explícita, no por falta de viabilidad técnica):

- App nativa Android / iOS → Ola 2
- Monetización SaaS, comparativas entre jugadores, IA, integración FFCV → Ola 3
- Gestión financiera, web pública, scouting, análisis de vídeo, vista 3D, wearables/GPS → fuera de plan

---

## 3. Principios rectores

1. **Disciplina monorepo desde el día uno**. Toda lógica de negocio en `packages/core`, agnóstica de framework. `apps/web` solo UI Next.js. Esto permite que Ola 2 (RN) reuse `packages/core` sin tocarlo.
2. **PWA primero**. En Ola 1 todo funciona como PWA instalable. La calidad nativa real llega en Ola 2 con RN, no con un wrapper.
3. **RLS estricta desde Fase 1**. Cualquier tabla con datos sensibles tiene RLS activa y tests de aislamiento. No se construye nada en producción sin esto.
4. **CI verde en main siempre**. Sin excepciones. Si rompe, parar todo y arreglar.
5. **PR + squash merge**. Una rama por feature, conventional commits, sin merge commits.
6. **Spec antes de código** para features no triviales. ADR para decisiones técnicas.
7. **Plan vivo**: cada subfase cerrada se marca `[hecho YYYY-MM-DD]` en este documento.

---

## 4. Cronograma alto nivel

Asumiendo ritmo sostenido de 2–3 h/día efectivas y 5 días/semana:

| Semanas | Fases | Hito al final del bloque |
|---|---|---|
| 1–2 | 0–1 | Monorepo Turborepo + CI + schema base con roles y capabilities |
| 3–4 | 2–4 | Gestión de club (con import CSV) + calendario + asistencia y convocatorias |
| 5 | 5 | Mensajería interna y push notifications |
| 6 | 6 | Editor de alineaciones F7/F8/F11 operativo |
| 7–8 | 7 | Pantalla de toma de datos en directo del partido (iPad/desktop) |
| 9 | 8 | Valoraciones de partido y de entrenamiento |
| 10–12 | 9 | Perfil del jugador + evolución multi-temporada + reportes mensuales PDF |
| 13 | 10 | Dashboard ejecutivo del club |
| 14–15 | 11–12 | Biblioteca de ejercicios + planificador con plantillas microciclo |
| (intercalada 11→12) | 11B | Pizarra táctica en vivo sobre la alineación real — se ejecuta **tras F11 y antes de F12** |
| 16–18 | 13 | Pizarra táctica con animación + modo presentación iPad |
| 19 | 14 | RGPD: consentimiento parental, audit log, derechos |
| 20 | 15 | Testing E2E + observabilidad + runbook |
| 21 | 16 | Beta cerrada con primer club |

Reservar un colchón adicional del 15–20 % para imprevistos. Con 2–3 h/día efectivas, el plan se completa en 13–20 semanas reales.

---

## 5. Resumen de estimaciones

| Fase | Título | Horas | Sesiones | Estado |
|---|---|---|---|---|
| F0 | Bootstrap y fundamentos | 4–5 h | 2 | ☑ |
| F1 | Modelo de datos y auth multi-rol con permisos configurables | 12–17 h | 5–6 | ☑ |
| F2 | Plantilla y cuerpo técnico | 19–32 h (lote inicial 14–23 h ≈18–20 h real ☑ + ext. F2.10/F2.11 +5–9 h ☐) | 6–9 | ⟳ ext. |
| F3 | Calendario y eventos | 6–9 h | 2–3 | ☑ |
| F4 | Asistencia a entrenamientos y convocatorias de partido | 9–13 h (Lote A ≈4–5 h ☑ + Lote B ≈5–8 h ☑) | 3 | ☑ |
| F5 | Mensajería interna y notificaciones push | 8–12 h | 3–4 | ☑ |
| F6 | Alineaciones y planificación del partido | 12–19 h | 4–5 | ☑ |
| F7 | Toma de datos en directo del partido | 10–14 h | 4–5 | ☑ |
| F8 | Valoraciones del partido | 8–13 h | 3–4 | ☑ |
| F9 | Perfil del jugador, evolución y reportes | 16–32 h | 6–8 | ☑ |
| F10 | Dashboard ejecutivo del club | 6–8 h | 2–3 | ☑ |
| F11 | Biblioteca de ejercicios | 13–18 h | 5–6 | ☐ |
| F11B | Pizarra táctica en vivo (sobre la alineación) | 6–9 h (preliminar) | 2–3 | ☐ |
| F12 | Planificador de sesiones | 12–20 h | 4–6 | ☐ |
| F13 | Pizarra táctica y jugadas (modo iPad) | 12–16 h | 5–6 | ☐ |
| F14 | RGPD para menores y seguridad | 12–18 h | 4–5 | ☐ |
| F15 | Testing, observabilidad y operaciones | 8–12 h | 3–4 | ☐ |
| F16 | Beta cerrada con primer club | 9–15 h (subfases 16.0–16.4 6–10 h + F16.x bulk-invite +3–5 h) | 3–4 | ☐ |
| **TOTAL Ola 1** | | **182–282 h** | **66–86** | |

> **Cambio 2026-05-29**: F2 reabierta como "extendida" con F2.10 (listado global de jugadores) y F2.11 (gestión global de cuerpo técnico). F16 incorpora F16.x (bulk-invite por email, depende de F16.0 SMTP propio). El lote inicial de F2 (subfases 2.0–2.9) sigue cerrado operacionalmente; lo que se reabre es el alcance. Delta acumulado sobre el plan original: +11–19 h (159–243 → 170–262).

> **Cambio 2026-05-29 (planificación)**: F6 ampliada de "Alineaciones del partido" → "Alineaciones y planificación del partido" con 4 nuevas subfases (F6.6 importar convocatoria, F6.7 banquillo, F6.8 cambios programados, F6.9 notas tácticas) y nota arquitectural sobre `<MatchFieldEditor>` reutilizable en F7. Delta F6: 6–9 h / 2–3 sesiones → 9–14 h / 3–4 sesiones (+3–5 h, +1 sesión). Ver [ADR-0009](../decisions/ADR-0009-f6-f7-match-field-editor-compartido.md).

> **Cambio 2026-05-30 (deuda diferida → plan)**: 3 puntos de deuda registrados en `known-issues.md` movidos a subfases concretas + 1 ejecutado en el mismo PR. F11 +1 subfase (11.9 capabilities agrupadas por dominio) → 12–16 h ⇒ 13–18 h. F14 +2 subfases (14.9 RLS capabilities por team_staff, 14.10 RLS events team-isolation) → 10–14 h ⇒ 12–18 h. La 4ª deuda (housekeeping redirect 308 `/mi-plantilla` → `/mis-equipos`) se ejecutó en este mismo PR — app en beta cerrada con piloto único, sin bookmarks externos a la URL antigua, riesgo de breakage = 0. Delta total Ola 1: +3–6 h (170–262 → 173–268).

> **Cambio 2026-05-31 (extensión F6.10)**: F6 +1 subfase (6.10 plantillas personalizadas de formación, tabla `coach_formations`) → 9–14 h / 3–4 sesiones ⇒ 12–19 h / 4–5 sesiones. Delta total Ola 1: +3–5 h (173–268 → 176–273), +1 sesión (63–82 → 64–83). Se planifica junto al Lote B de F6 (mismo PR de plan).

> **Rework A 2026-06-10 (mejora estructural, no fase numerada)**: ✅ **cerrado**. La **temporada** baja de la categoría al **equipo** y la **categoría** pasa a ser plantilla permanente del club. No es una fase del Plan: es un rework entre el **núcleo de F9** y su **segundo tramo** (la ficha multi-temporada de 9.4 se apoya en `teams.season`). Detalle en §6 (sección **Rework A**, tras la Fase 9) y en la [spec A.0](../specs/A.0-categorias-equipos.md). [ADR-0017](../decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md).

> **Cambio 2026-06-14 (fase intercalada F11B)**: nueva fase **F11B — Pizarra táctica en vivo (sobre la alineación)**, insertada **después de F11 y antes de F12** con etiqueta `F11B` para **no renumerar F12–F16**. Reutiliza `<MatchFieldEditor>` (F6) + la capa de dibujo/PitchEditor (F11) — no duplica componentes de campo. Depende solo de F11; F12/F13 no se ven afectadas. Estimación preliminar +6–9 h / 2–3 sesiones. Delta total Ola 1: +6–9 h (176–273 → 182–282), +2–3 sesiones (64–83 → 66–86). Detalle en §6 (Fase 11B, tras la Fase 11).

---

## 6. Fases (Ola 1)

### Fase 0 — Bootstrap y fundamentos

**Objetivo**: crear el esqueleto del proyecto sin lógica de negocio: monorepo Turborepo, stack base, observabilidad, documentación, plantillas. Cero código de producto.

**Horas**: 4–5 h · **Sesiones**: 2

**Criterio de cierre**: repo `CognixLabs-MisterFC/MisterFC` creado con estructura Turborepo (`packages/core` + `apps/web`), CI verde, primer deploy en Vercel funcionando, estructura `docs/` con plantillas, CLAUDE.md y `_bootstrap/` en el repo, ADR-0003 documentando la estrategia monorepo.

**Riesgo**: bajo. **Dependencias**: ninguna.

**Subfases**:

- **0.1** Inicializar el repositorio local + identidad git (15 min) — [hecho 2026-05-27]
- **0.2** Estructura `docs/` + plantillas spec/ADR/retro (45 min) — [hecho 2026-05-27]
- **0.3** Scaffold Turborepo monorepo: packages/core + apps/web (1–1.5 h) — [hecho 2026-05-27]
- **0.4** apps/web Next.js + TS strict + Tailwind v4 + shadcn/ui + vínculo packages/core (45 min) — [hecho 2026-05-27]
- **0.5** i18n con next-intl (es / en / va) (30 min) — [hecho 2026-05-27]
- **0.6** Cliente Supabase en packages/core (sin schema todavía) (30 min) — [hecho 2026-05-27]
- **0.7** Sentry SDK para Next.js (DSN en `.env.local`) (30 min) — [hecho 2026-05-27]
- **0.8** PWA manifest + service worker básico (30 min) — [hecho 2026-05-27]
- **0.9** GitHub Actions CI + PR template (30 min) — [hecho 2026-05-27]
- **0.10** direnv `.envrc` + `.env.example` (15 min) — [hecho 2026-05-27]
- **0.11** Plan Maestro como Markdown (este archivo) committeado a `docs/journey/plan-maestro.md` (15 min) — [hecho 2026-05-27]
- **0.12** ADR-0003: estrategia monorepo + decisión Ola 2 RN (30 min) — [hecho 2026-05-27]

---

### Fase 1 — Modelo de datos y auth multi-rol con permisos configurables

**Objetivo**: definir e implementar el modelo de datos central (club, categorías, equipos, perfiles, roles), el sistema de autenticación, y un sistema de permisos configurables que permita al entrenador principal definir qué puede hacer cada ayudante.

**Horas**: 12–17 h · **Sesiones**: 5–6

**Criterio de cierre**: schema base desplegado en Supabase, RLS estricta por rol + capabilities, magic link funcionando, jugador y familia comparten el mismo rol con cuentas múltiples vinculadas, primer club + admin de prueba creados, tests RLS verdes.

**Riesgo**: alto. El modelo de datos es la base de todo. Errores aquí se propagan.

**Dependencias**: Fase 0 cerrada.

**Subfases**:

- **1.1** [hecho 2026-05-27] Modelo de datos: club, categoría, equipo (tablas `clubs`, `categories`, `teams`) — 1–2 h
- **1.2** [hecho 2026-05-27] Modelo de datos: perfiles y roles con 5 roles enumerados (`admin_club`, `coordinador`, `entrenador_principal`, `entrenador_ayudante`, `jugador`). Rol `familia` fusionado con `jugador` — 1–2 h
- **1.3** [hecho 2026-05-27] Modelo de cuentas vinculadas al jugador: tablas `team_members` + `player_accounts` (jugador_id, profile_id, relation: self/parent/guardian). Permite 0, 1 o varias cuentas asociadas — 1–2 h
- **1.4** [hecho 2026-05-27] Sistema de capabilities para entrenador ayudante: tabla `capabilities` (membership_id, capability_name, granted). Capabilities estándar: can_evaluate, can_create_lineups, can_register_match_events, can_create_sessions, can_create_plays, can_see_medical, can_message_families, can_manage_squad — 1–2 h
- **1.5** [hecho 2026-05-27] Auth con magic link nativo de Supabase Auth + onboarding club — 1–2 h
- **1.6** [hecho 2026-05-27] Sistema de invitaciones (tabla `invitations` + email transaccional) — 1–2 h
- **1.7** [hecho 2026-05-27] RLS por rol + capabilities — políticas base + tests SQL — 3–4 h
- **1.8** [hecho 2026-05-27] ADR-0002: modelo de roles, capabilities y cuentas vinculadas — 30 min

---

### Fase 2 — Plantilla y cuerpo técnico ⟳ extendida 2026-05-29

> **Estado**: lote inicial (2.0–2.9) ☑ cerrado 2026-05-29 y sin cambios. **Extensión** (2.10–2.11) ☐ pendiente, añadida tras feedback de uso real. La extensión no reabre código de las subfases cerradas; añade nuevas vistas globales sobre los modelos ya existentes.

**Objetivo**: implementar la gestión completa del club: CRUD de categorías, equipos, jugadores y staff. Configuración de permisos para entrenadores ayudantes. Importación masiva desde CSV/Excel. **Vistas globales** (listado y gestión cross-equipo) en la extensión.

**Horas**: 19–32 h total · **Lote inicial 2.0–2.9**: estimado 14–23 h · real ≈18–20 h ☑ · **Extensión 2.10–2.11**: estimado +5–9 h ☐ · **Sesiones**: 6–9 · **PRs lote inicial**: #10–#16.

**Cierre del lote inicial** (sigue válido): admin/coord pueden montar la jerarquía completa del club (categorías → equipos → jugadores → staff). Familias se vinculan a menores vía invitación. Capabilities del ayudante editables desde UI. Importación masiva CSV/Excel con dedup + RLS validada por pgTAP. Resumen ejecutivo en [fase-2-summary.md](fase-2-summary.md).

**Criterio de cierre de la extensión**: admin/coord tienen una vista global de toda la plantilla del club (no por equipo) con filtros operativos, y una vista global del cuerpo técnico con su agenda de eventos F3. Ninguna funcionalidad nueva de modelo de datos — solo composición de lectura sobre tablas existentes.

**Riesgo**: bajo-medio.

**Dependencias**: Fase 1 cerrada.

**Subfases**:

- **2.0** [hecho 2026-05-28] App shell + navegación role-aware + fix logout + perfil propio — incluye route group `(authenticated)`, sidebar/drawer, ActiveClubSwitcher, /perfil con avatar privado (signed URLs), shadcn/ui adoptado. Spec en `docs/specs/2.0-app-shell.md`. ADR-0000 confirmado en práctica.
- **2.1** [hecho 2026-05-28] CRUD club, categorías, equipos — `/categorias` agrupada por temporada, anidación equipos por categoría con formato F7/F8/F11 + color. Sin spec (CRUD directo).
- **2.2** [hecho 2026-05-28] Ficha completa del jugador + bucket privado `player-photos` con helpers RLS (`user_can_see_player`, `user_can_manage_player`, `user_can_see_player_medical`). Signed URLs TTL 10min. Notas médicas con visibilidad por rol + capability + tutor. Spec en `docs/specs/2.2-...` (cubierta por nota crítica en spec 2.0).
- **2.3** [hecho 2026-05-28] Alta de jugador con dialog. Asignación opcional a equipo al alta. La ficha existe sin cuenta vinculada (modelo `players` + `player_accounts`).
- **2.4** [hecho 2026-05-28] Vincular cuentas de familia al jugador menor. Migración extiende `invitations` con `player_id` + `player_relation` (parent/guardian) + trigger same_club. `attachToClub` adapta el accept para crear `player_accounts`.
- **2.5** [hecho 2026-05-28] Histórico del jugador en el club. Action `assignPlayerToTeam` cierra el `team_members` activo con `left_at=today` y crea el nuevo. UI dialog "Asignar/Mover de equipo" en la ficha.
- **2.6** [hecho 2026-05-28] Cuerpo técnico con roles diferenciados. Nueva tabla `team_staff(team_id, membership_id, staff_role)` + helpers `user_is_staff_of_team` / `user_active_team_for_staff`. Extensión `invitations.team_staff_role` con CHECK y trigger same_club. UI `/equipos/[teamId]` con bloques Staff + Roster e InviteStaffDialog. Mapeo staff_role → membership.role aplicado en server.
- **2.7** [hecho 2026-05-28] UI de capabilities del ayudante implementada (spec `docs/specs/2.7-capabilities-ui.md`). Página `/equipos/[teamId]/staff/[membershipId]/capabilities` con shadcn Switch + optimistic UI + UPSERT robusto. Limitación cross-team registrada en `known-issues.md` (endurecer cuando haya multi-equipo activo).
- **2.8** [hecho 2026-05-28] Vista `/mi-plantilla` para entrenadores (read-only). Resuelve equipo activo vía `team_staff` activos del user; soporta multi-equipo con TeamSelector; filtros por posición sin estado server.
- **2.9** [hecho 2026-05-29] Importación masiva CSV/Excel (spec `docs/specs/2.9-import-csv.md`). Wizard 4 pasos (`/plantilla/importar`), plantilla XLSX+CSV pre-generadas en `public/import-templates/`, parsing cliente (papaparse + read-excel-file), dedup `(lower(first_name), lower(last_name), date_of_birth, club_id)`, server action loop fila-a-fila. Primer Vitest del repo en `packages/core/src/import/__tests__/` (25 tests).

**Extensión post-feedback (☐ pendiente, añadidas 2026-05-29)**:

- **2.10** Listado global de jugadores del club con filtros (búsqueda por nombre, año de nacimiento, posición, equipo) y acción de asignación individual a equipo. Spec `docs/specs/2.10-listado-global-jugadores.md`. **Reusa** tablas `players` + `team_members` + `teams` + `categories` (cero modelo nuevo). UI Server Component sobre DataTable shadcn. **Estimación**: 2–4 h. **Depende**: F2 (lote inicial) cerrada — cumplido.
- **2.11** [hecho 2026-05-29] Gestión global del cuerpo técnico (`/cuerpo-tecnico`): listado del club con filtros (búsqueda, función staff, equipo, categoría) y ficha individual con equipos activos + agenda F3 (28 días, reuso `loadCalendarData` + `CalendarAgenda`) + histórico. Server action `moveStaffToTeam` (cierra fila origen, abre destino, valida principal único). pgTAP `rls_move_staff.sql` (4 casos). Sin modelo nuevo: reusa `team_staff` + `memberships` + `capabilities` + `events`.

---

### Fase 3 — Calendario y eventos ☑ [cerrada 2026-05-29]

**Objetivo**: calendario unificado del club con entrenamientos, partidos, torneos y otros eventos. Vista mensual / semanal / agenda. Filtros por equipo y categoría.

**Horas**: 6–9 h. **Real**: ≈ dentro del rango. **Sesiones**: 1 lote.

**Cierre**: spec `docs/specs/3.0-calendario-eventos.md`. Modelo `events` con RLS abierta a miembros del club (decisión Ola 1, knownissue `F3-rls-events-visibilidad`). Capability 9ª `can_manage_calendar` añadida. Componente de calendario propio sobre `Intl` + `Date` (ADR-0006), 3 vistas (mes/semana/agenda) + filtros + recurrencia semanal opción A (ADR-0005). 63 tests Vitest + 19 casos pgTAP. PR único con 5 subfases.

**Riesgo**: bajo (cumplido).

**Dependencias**: Fase 2 cerrada.

**Subfases**:

- **3.1** [hecho 2026-05-29] Modelo `events` + capability `can_manage_calendar` + pgTAP — 1 h
- **3.2** [hecho 2026-05-29] UI calendario mensual + semanal + agenda (componente propio sobre Intl+Date) — 2–3 h
- **3.3** [hecho 2026-05-29] CRUD de eventos con permisos (server actions + dialog) — 1 h
- **3.4** [hecho 2026-05-29] Filtros por equipo, categoría y tipo de evento (estado URL) — 1 h
- **3.5** [hecho 2026-05-29] Eventos recurrentes weekly (opción A, parent + children explícitos) — 1–2 h

ADRs cerrados con la fase: ADR-0005 (recurrencia A), ADR-0006 (componente propio).

---

### Fase 4 — Asistencia a entrenamientos y convocatorias de partido

**Objetivo**: dos flujos diferenciados: (a) registro post-entrenamiento por el entrenador con códigos estructurados de presencia, (b) convocatoria de partidos con confirmación, hora de citación y descartes. Estadísticas con filtros temporales.

**Horas**: 9–13 h · **Sesiones**: 3

**Criterio de cierre**: entrenador marca asistencia con códigos estructurados al cierre de cada entrenamiento. Para partidos, entrenador convoca con hora y lugar de citación separados, padres/jugadores confirman, entrenador puede marcar descartes con motivo.

**Riesgo**: bajo. **Dependencias**: Fase 3 cerrada.

**Subfases**:

**Lote A** ☑ (entregado 2026-05-29, ver spec 4.0 §D8):

- **4.1** [hecho 2026-05-29] Modelo `training_attendance` con enum `attendance_code` (10 valores, ADR-0007) + capability `can_mark_attendance` + helper RLS `user_can_record_attendance` + triggers (solo training, no futuro, roster histórico, recorded_by forzado a auth.uid, FKs inmutables, updated_at) + 12 casos pgTAP en `rls_training_attendance.sql`.
- **4.2** [hecho 2026-05-29] UI registro post-entrenamiento: `/asistencia/[eventId]` con AttendanceMarker (ciclo rápido 3 códigos + dropdown completo) + acciones `markAttendance` / `markAttendanceBulk` / `clearAttendance`. Entry point desde event-dialog del calendario F3 cuando el evento es training pasado.
- **4.8** [hecho 2026-05-29] Vista `/asistencia` con stats agregadas (por código + por jugador) y filtros temporales (`7d` / `30d` / `temporada` + filtro por equipo) + lista de entrenamientos pendientes (`marked_count < roster_count`) + entrada de sidebar.

**Lote B** ☑ (entregado 2026-05-29):

- **4.3** [hecho 2026-05-29] 3 modelos: `match_callup_meta` (1:1 evento) + `callup_responses` (UNIQUE event+player) + `callup_decisions` (PK compuesto). Helpers RLS `user_can_manage_callup` y `user_owns_player_account`. Triggers: solo type='match', roster histórico, FKs inmutables, `responded_by`/`decided_by`/`published_by` forzados a `auth.uid()`. Capability `can_manage_callups`. 13 pgTAP en `rls_callup.sql`.
- **4.4** [hecho 2026-05-29] Server action `publishCallup` (manual existing→UPDATE / falta→INSERT, evita upsert ON CONFLICT WITH CHECK del PR #19) + UI `PublishCallupDialog` con guardar borrador / publicar ahora. Trigger BD enforce que publicar es one-way (cannot_unpublish).
- **4.5** [hecho 2026-05-29] UI `/convocatorias` con badges yes/maybe/no + `/convocatorias/[eventId]` para jugador/familia con `ResponseButtons` (chips activos + textarea reason opcional, optimistic UI).
- **4.6** [hecho 2026-05-29] Panel del entrenador en mismo `/convocatorias/[eventId]`: lista de jugadores con respuesta + `DecisionButtons` (called_up / discarded + reason + clear) + resumen de descartes técnicos. RLS verifica `can_manage_callups` para el ayudante.
- **4.7** [hecho 2026-05-29] Tabla `notifications` futuro-proof (channel `in_app`/`push`/`email`, status `pending`/`sent`/`failed`/`skipped`, dedupe_key UNIQUE, sent_at nullable) + endpoint `POST/GET /api/cron/reminders` protegido por `Authorization: Bearer ${CRON_SECRET}` + cron `0 8 * * *` UTC en `apps/web/vercel.json`. Helpers puros `buildDedupeKey`/`dayBucketMadrid` (13 Vitest). ADR-0008 (Vercel Cron como patrón). 6 pgTAP en `rls_notifications.sql`.

**Lote C** — extensión 2026-05-31 (parte del hotfix de PR #31):

- **4.9** [hecho 2026-05-31] Estándares de duración de partido por categoría. Columna `categories.half_duration_minutes INT NOT NULL DEFAULT 45` con backfill por nombre normalizado (lower + unaccent + prefijo) según estándares españoles: querubín 15, prebenjamín 20, benjamín 25, alevín 30, infantil 35, cadete 40, juvenil/amateur/senior/veterano 45. Helpers puros `computeEndsAt(starts_at, half_duration_minutes)` y `computeCitacionAt(starts_at, lead=60)` en `packages/core`. Total partido = `2 × half + 15` min (descanso constante en código vía `HALFTIME_BREAK_MINUTES`, no en BD). UI: event-dialog del calendario auto-rellena `ends_at` para type=match con target team/category (editable después); publish-callup-dialog auto-rellena `meeting_at = starts_at − 60 min`. Migración `20260605000003_categories_half_duration.sql` + pgTAP `categories_half_duration_backfill.sql`. Estimación 2–3 h.

---

### Fase 5 — Mensajería interna y notificaciones push

**Objetivo**: comunicación dentro del club: mensajes directos entrenador ↔ jugador/familia, anuncios al equipo, notificaciones push.

**Horas**: 8–12 h · **Sesiones**: 3–4

**Criterio de cierre**: entrenador puede mandar mensajes directos y anuncios. Notificaciones push llegan a iPad/Android instalado como PWA. Preferencias de notificación configurables por usuario.

**Riesgo**: medio (push en iOS PWA es frágil, decidido aceptarlo en Ola 1 y resolver bien en Ola 2 con app nativa).

**Dependencias**: Fase 2 cerrada.

**Subfases**:

**Lote A** ☑ (entregado 2026-05-30, PR #31):

- **5.1** [hecho 2026-05-30] Modelo `conversations`, `messages`, `announcements`, `audit_log` + RLS + triggers + helpers. Capability `can_message_families` ya existente (F2.7). 18 pgTAP.
- **5.2** [hecho 2026-05-30] UI `/mensajes` + `/mensajes/[conversationId]` (lista + hilo con composer optimistic + read receipts) + botón "Enviar mensaje" en `/jugadores/[playerId]`.
- **5.3** [hecho 2026-05-30] UI `/equipos/[teamId]/anuncios` con form de publicación gateada por capability + lista pinned-first. Plus `/es/anuncios` global para admin/coord con audience club-wide o multi-team. Plus `/anuncios/[id]` detail page. Helper `userCanPublishAnnouncementsToTeam`.

**Lote B** ☑ (entregado 2026-05-31, este PR feat/fase-5-lote-b-y-mi-equipo):

- **5.4** [hecho 2026-05-31] Service Worker (`public/sw.js`) ampliado con handlers `push` y `notificationclick` (deep link al deep_link del payload, fallback `/`, `tag` para colapsar). VAPID keys generadas (ECDSA P-256), helper `web-push.ts` server-side con `sendPushToUser(...)` que respeta `notification_preferences` y borra endpoints 404/410.
- **5.5** [hecho 2026-05-31] Tabla `push_subscriptions` (id, user_id, endpoint UNIQUE, p256dh, auth, user_agent, last_seen_at). RLS estricta: cada user solo gestiona sus filas. UI `/perfil/notificaciones` panel cliente con flow `Notification.requestPermission` + `pushManager.subscribe` + acción server `subscribePush`/`unsubscribePush`. Banner explicativo en navegadores sin soporte (iOS Safari sin PWA / iOS <16.4).
- **5.6** [hecho 2026-05-31] Tabla `notification_preferences (user_id, type, channel, enabled)` PK compuesta. RLS estricta own-only. Helper SQL `user_wants_notification(user_id, type, channel)` SECURITY DEFINER con LEFT JOIN default true (opt-in implícito). UI matrix tipo × canal con switches; canal `in_app` no opt-out (siempre on); canal `email` bloqueado con tooltip hasta F16. Tipos: new_message, new_announcement, callup_published, match_callup_reminder, training_reminder, attendance_pending_reminder.
- **5.7** [hecho 2026-05-31] Cron `/api/cron/reminders` extendido: además de las filas `in_app` ya escritas, escribe filas espejo `channel='push'` para los mismos eventos (match_callup_reminder + attendance_pending_reminder). Tras escribir, drena hasta 100 filas push pending por ejecución llamando a `sendPushToUser` con la lógica de `decideNotificationOutcome` para marcar sent/skipped/failed/pending. **Eager send**: server actions `sendMessage` (new_message), `createAnnouncement`/`createGlobalAnnouncement` (new_announcement), `publishCallup` (callup_published) emiten notificaciones via helper `notify-bus.ts` (lib/`emitNotification`/`emitNotificationFanOut`) que insertan in_app + push y disparan push inmediato. Si fallan, queda pending para el cron. ADR-0010 y ADR-0011 efectivos.

**Lote C** — extensión 2026-05-31 (entregado con Lote B en este PR):

- **5.8** [hecho 2026-05-31] Vista `/es/mi-equipo` solo para `role=jugador` (redirect otros roles). Muestra header del team (nombre + categoría + half_duration informativo), compañeros del equipo (dorsal + nombre, dedupe y orden por dorsal asc), próximos eventos (30d, limit 10), anuncios visibles (mix team-bound + club-wide, RLS filtra), acceso 1-click a `/convocatorias`. Selector dropdown si el jugador está en >1 team. Sidebar item `mi_equipo` solo para jugador. Helpers puros en `@misterfc/core/team-view` (`listTeammates`, `listUpcomingTeamEvents`, `listVisibleAnnouncements`) con 15 Vitest. Sin migración: reusa `team_members` + `players` + `events` + `announcements`. Estimación 2–3 h.

---

### Fase 6 — Alineaciones y planificación del partido

**Objetivo**: editor visual de alineación y planificación pre-partido. Cubre alineación titular (campo) + banquillo + cambios programados + notas tácticas, no solo el lineup básico. Toma como input la convocatoria publicada de F4 y entrega al staff una preparación completa antes del pitido inicial. La pieza visual central (`<MatchFieldEditor>`) sienta la fundación reutilizable para F7.

**Horas**: 12–19 h · **Sesiones**: 4–5

**Criterio de cierre**: entrenador parte de la convocatoria F4, monta titular vía drag&drop, organiza banquillo y "fuera de convocatoria", programa cambios con minuto + razón, deja notas tácticas. Decide qué alineación es oficial y si se publica al equipo o se mantiene privada del cuerpo técnico. Puede guardar formaciones propias y reutilizarlas.

**Riesgo**: bajo–medio. El componente `<MatchFieldEditor>` requiere cuidar el drag&drop bidireccional campo↔banquillo y será reutilizado por F7.

**Dependencias**: Fase 4 cerrada.

**Nota arquitectural — `<MatchFieldEditor>` como fundación compartida con F7**:

F6 construye el componente `<MatchFieldEditor>` (campo SVG, drag&drop, chips de jugadores, snap a posiciones del preset) como **fundación visual reutilizable**. F7 (Toma de datos en directo) reusa ese mismo componente y añade encima su capa de cronómetro/timeline/eventos. F6 NO es de un solo uso — sienta la base del módulo de partido completo. El refactor que necesite F7 sobre el componente se prevé pequeño porque la API ya queda diseñada con eso en mente (props para overlays externos, eventos hover/click expuestos, sin lógica de eventos de partido dentro). Ver [ADR-0009](../decisions/ADR-0009-f6-f7-match-field-editor-compartido.md).

**Subfases**:

- **6.1** Modelo `lineups` y `lineup_positions` (varias alineaciones por partido) — 1 h `[hecho 2026-05-31]`
- **6.2** Presets de formación F7/F8/F11 — 1–2 h `[hecho 2026-05-31]`
- **6.3** Editor visual con drag & drop (campo SVG, snap a posiciones del preset) — 2–3 h. **Aquí nace `<MatchFieldEditor>`.** `[hecho 2026-05-31]`
- **6.4** Múltiples alineaciones por partido (titular, plan B, segunda parte) — 1 h `[hecho 2026-05-31]`
- **6.5** Lista de "fuera de convocatoria" con motivo (técnico, físico, disciplinario) — 1 h `[hecho 2026-05-31]`
- **6.6** Importar plantilla desde convocatoria F4 (Sí/Duda → disponibles, No/descarte → no disponibles) — 30 min. **Dependencias**: F4 cerrada. `[hecho 2026-05-31]` (Lote B: sync bidireccional alineación↔convocatoria — auto-marca descarte/convocado + reimport explícito)
- **6.7** Banquillo del partido: titulares + reservas + fuera convocatoria, con drag&drop bidireccional campo↔banquillo — 1–2 h `[hecho 2026-05-31]`
- **6.8** Cambios programados: minuto + jugador que sale + jugador que entra + razón, lista ordenada visible en el editor — 1–2 h `[hecho 2026-05-31]`
- **6.9** Notas tácticas del partido: bloque libre + objetivos + indicaciones por jugador o por fase — 1 h `[hecho 2026-05-31]` (tabla solo-staff `lineup_tactical_notes`)
- **6.10** Plantillas personalizadas de formación — 3–5 h `[hecho 2026-06-01]`. El entrenador crea formaciones propias arrastrando círculos sobre el campo SVG, las guarda con nombre y las reutiliza en alineaciones de cualquier partido. **Modelo**: tabla `coach_formations` (`id`, `owner_profile_id`, `club_id`, `name`, `format` F7/F8/F11, `positions` JSONB de `{position_code, x_pct, y_pct}` validado por trigger, `created_at`, `updated_at`; unique `(owner, format, name)`). **UI**: ruta `/perfil/formaciones` con CRUD; el selector de formación del editor de alineaciones añade un grupo "Mis formaciones" junto al catálogo predefinido (adopta el layout como coordenadas de los `lineup_positions`). **RLS**: cada coach gestiona solo las suyas (INSERT exige `can_create_lineups`); admin/coord lista las del club; DELETE owner+admin. **Out of scope**: compartir formaciones entre coaches → futuro.

> **Lote A entregado 2026-05-31** (PR #33): 6.1–6.5 + 6.7. Spec `docs/specs/6.0-alineaciones.md`, ADR-0012 (modelo normalizado) y ADR-0013 (catálogo en código). Lote B pendiente: 6.6 (import convocatoria), 6.8 (cambios programados), 6.9 (notas tácticas) + visibilidad/compartir con familia + mejoras (posición primaria, reglas por modalidad, fix "+Nueva").

> **Extensión 2026-05-31 — F6.10 (plantillas personalizadas de formación)**: nueva subfase 3–5 h. F6 pasa de 9–14 h / 3–4 sesiones → **12–19 h / 4–5 sesiones**. Delta Ola 1: +3–5 h (173–268 → 176–273). Ver §5 y [ADR-0013](../decisions/ADR-0013-catalogo-formaciones-en-codigo.md) (el catálogo base sigue en código; las plantillas del coach sí van a BD por ser datos de usuario, justo el caso que ADR-0013 reservaba para tabla).

---

### Fase 7 — Toma de datos en directo del partido

**Objetivo**: pantalla dedicada para tablet/desktop con drag & drop de símbolos sobre jugadores y campo. Registro completo de eventos del propio equipo y del rival, línea de tiempo editable, cronómetro avanzado.

**Estado**: ☑ **Cerrada (2026-06-07)** — todas las subfases entregadas (7.1–7.12 + refinamientos 7.4b/7.6b/7.6c/7.7b/7.7c) + mejoras pre-cierre (7.13/7.14/7.15) + fix RLS/pgTAP (#54). Detalle de cierre en [docs/specs/7.0-toma-datos-en-directo.md](../specs/7.0-toma-datos-en-directo.md) §16.

**Horas**: 10–14 h · **Sesiones**: 4–5

**Criterio de cierre**: operador puede registrar todos los eventos del partido (gol, asistencia, tarjeta, sustitución, corner, falta, fuera de juego, tiro a puerta) con un gesto de arrastrar y soltar. Funciona en iPad apaisado y portátil. Línea de tiempo editable. Cierre del partido consolida stats al perfil del jugador.

**Riesgo**: medio-alto. Drag & drop táctil en tablet, performance, edición de eventos.

**Dependencias**: Fase 6 cerrada.

**Subfases**:

> **Numeración autoritativa (renumber §8 del spec, aplicada en cierre 2026-06-07)**: la subfase nueva *Tiempo de juego por jugador* entró como **7.8**, desplazando *Línea de tiempo* → **7.9**, *Cierre/consolidación* → **7.10** y *Rivales destacados + notas* → **7.11**. Las sub-letras (7.4b/7.6b/7.6c/7.7b/7.7c) son refinamientos cerrados sobre la marcha.

- **7.1** [hecho 2026-06-01] Modelo `match_events` extendido (type, side, player_id?, rival_dorsal?, clock_seconds, period, x_pct?, y_pct?, metadata) + tablas de sesión/reloj (#36)
- **7.2** [hecho 2026-06-01] Armazón de la pantalla `/directo` (cronómetro + campo + paleta) (#37)
- **7.3** [hecho 2026-06-02] Eventos sobre el jugador (gol, asistencia, tarjetas) + regla de expulsión derivada (#40)
- **7.4** [hecho 2026-06-02] Eventos sobre el campo (córner, falta, fuera de juego, tiro) con ubicación (#41) · **7.4b** [hecho 2026-06-06] faltas detalladas + córner a favor/en contra (#50)
- **7.5** [hecho 2026-06-02] Sustituciones (2-step: sale → entra) + banquillo + "quitar al que no viene" (#42)
- **7.6** [hecho 2026-06-02] Rival en la misma pantalla + eventos del rival + cambios corridos (#43) · **7.6b** [hecho 2026-06-03] mover jugadores + cambiar formación en vivo (#44) · **7.6c** [hecho 2026-06-03] régimen de cambios por categoría + división (#45)
- **7.7** [hecho 2026-06-02] Iniciar partido + cronómetro completo (motor de reloj puro, descanso, prórroga, ajuste, recuperable) — **ADELANTADA antes de 7.3** (#39) · **7.7b** [hecho 2026-06-04] flujo de periodos + finalizar partido (#47) · **7.7c** [hecho 2026-06-06] penaltis (evento + tanda) y marcador (#49)
- **7.8** [hecho 2026-06-03] *(NUEVA)* Tiempo de juego y stats por jugador en vivo (#46)
- **7.9** [hecho 2026-06-06] Línea de tiempo del partido editable (#51)
- **7.10** [hecho 2026-06-07] Cierre del partido y consolidación de stats (`match_player_stats`) + reabrir (#52)
- **7.11** [hecho 2026-06-07] Jugadores rivales destacados + notas del partido (#53)
- **7.12** [hecho 2026-06-02] Panel de próximo partido en Inicio (estado + CTA al paso que toca; aviso de convocatoria pendiente para jugador/familia; admin no lo ve) (#38)
- **Fix RLS / pgTAP** [hecho 2026-06-07] recursión `team_staff`↔`invitations` (helper `user_is_principal_of_team`), policy INSERT de `capabilities` recreada y test B8 de `training_attendance` corregido; runner pgTAP en verde (#54)

**Mejoras pre-cierre F7 (2026-06-07):**

- **7.13** [hecho 2026-06-07] Notas por jugador (persistentes, equipo propio). Tabla nueva `player_notes` (helper `user_can_access_player_notes` SECURITY DEFINER, sin recursión RLS). Añadir/editar/borrar tocando al jugador en `/directo` (origen = partido) y desde la ficha del jugador (lista con fecha + autor). Solo cuerpo técnico/admin/coord; NO jugador/familia. Migración `20260621000000_player_notes.sql`.
- **7.14** [hecho 2026-06-07] Asistencia a entrenos (lun–vie) en la convocatoria: junto al jugador, `(asistidos/total)` de los entrenos de la semana del partido. Motor puro `computeWeeklyTrainingAttendance` (Vitest) sobre `training_attendance` + eventos de entreno; oculto si no hubo entrenos esa semana. Sin migración.
- **7.15** [hecho 2026-06-07] Contraste de la agenda: el texto de los eventos pasa a color de texto principal (negro en claro) — los tonos claros previos no se leían sobre los fondos suaves. Solo estilo.

> El desglose autoritativo y la renumeración de subfases de F7 (incl. *Tiempo de juego por jugador* como 7.8) viven en [docs/specs/7.0-toma-datos-en-directo.md](../specs/7.0-toma-datos-en-directo.md) §8. La **7.12** (panel en Inicio) lee datos existentes (F4/F6/F7.1), sin migración.

> **Reordenación (2026-06-02): 7.7 va ANTES de 7.3.** Todo evento (`match_events`) exige `clock_seconds` absoluto NOT NULL (§6), y registrar eventos requiere antes un partido en juego (`match_state='live'`) con el once congelado (`match_starters`) y un cronómetro corriendo (`match_periods`). Como ese arranque + reloj no lo construía ninguna subfase entre 7.2 y 7.7, se adelanta **7.7 (Iniciar partido + cronómetro completo)** y 7.3 se apoya sobre él. El modelo ya existe (7.1) → sin migración nueva. El motor de reloj puro vive en `packages/core/src/match/clock.ts` (testeado con Vitest, §15).

---

### Fase 8 — Valoraciones del partido

> **Título cambiado en el cierre (2026-06-08): "Valoraciones del partido y del entrenamiento" → "Valoraciones del partido".** Los **entrenamientos quedan FUERA de F8** — decisión de producto tomada durante la implementación (ver [spec 8.0 §14](../specs/8.0-valoraciones.md) y [ADR-0015](../decisions/ADR-0015-f8-descope-entrenamientos-valoracion-colectiva.md)). **No re-añadir la valoración de entrenamientos desde el plan antiguo**: si se retoma, es una fase/extensión nueva con su propio alcance. F8 solo cubre el **partido** (individual + colectiva).

**Objetivo**: sistema de valoraciones del **partido**: nota individual 1-10 + comentario + MVP por jugador, valoración colectiva del equipo, nota privada del cuerpo técnico, y visibilidad configurable por club hacia jugadores/familias.

**Estado**: ☑ **Cerrada (2026-06-08)** — todas las subfases entregadas (8.1–8.6) y verificadas (typecheck · lint · test · build + barrido pgTAP en verde). Detalle de cierre en [docs/specs/8.0-valoraciones.md](../specs/8.0-valoraciones.md) §14.

**Horas**: 8–13 h · **Sesiones**: 3–4 · **PRs**: #58 (8.1), #59 (8.2), #60 (8.3 obsoleta, ver nota), #61 (8.3 colectiva), #62 (8.4), #63 (8.5), #64 (8.6).

**Criterio de cierre**: entrenador puede valorar a cada jugador tras un partido (1-10 + comentario + MVP), valorar al equipo en conjunto, y dejar una nota privada interna por jugador. El admin del club configura si jugadores y familias ven sus valoraciones (OFF por defecto). RLS cubierta por pgTAP. *(La pantalla donde el jugador/familia VE su valoración se entrega en **F9** — F8 abrió el permiso a nivel de datos.)*

**Riesgo**: medio-bajo. Decisión sensible: qué ven jugadores y familias.

**Dependencias**: Fase 7 cerrada.

**Subfases** (reescritas a la realidad implementada):

- **8.1** Modelo de datos — `evaluations` (por jugador: rating 1-10 + comentario + MVP, obligatorio en partido a nivel de fila) + `evaluation_private_notes` (nota privada, tabla aparte por column-leak) + `team_evaluations` (colectiva) + `club_settings` (flag de visibilidad) + `match_state.post_match_done` (cierre del ciclo) + 2 helpers + triggers + RLS — #58
- **8.2** UI post-partido — valoración **individual** por jugador (1-10 + comentario + MVP), `match_player_stats` como contexto de solo lectura, "Completar valoraciones" (`post_match_done`) — #59
- **8.3** Valoración **colectiva** del partido (`team_evaluations`, una por partido, 1-10 + comentario; **coexiste** con la individual, lectura team-scoped) — #61. *(Antes esta subfase era "UI post-entrenamiento"; **cambiada** al descopar los entrenos. El PR #60 con la valoración de entreno quedó **obsoleto** y no se mergea.)*
- **8.4** Nota privada del entrenador por jugador y partido (tabla `evaluation_private_notes`, **desacoplada** de la valoración individual — migración `20260624000000` quitó la FK a `evaluations`; nunca visible a jugador/familia) — #62
- **8.5** Configuración de visibilidad por club — pantalla `/ajustes`, toggle `club_settings.evaluations_player_visibility` (opt-in, **default OFF**, lo escribe **solo el admin**, D10) — #63
- **8.6** Barrido pgTAP completo de RLS de valoraciones (matriz tabla × rol × operación + cruce del flag sobre individual y colectiva) — #64

---

### Fase 9 — Perfil del jugador, evolución y reportes

**Objetivo**: vista de perfil deportivo del jugador con stats agregadas, ratios, evolución intra-temporada y multi-temporada, badges y reportes mensuales en PDF exportables.

> **Requisito heredado de F8 (anotado en el cierre de F8, 2026-06-08)**: el perfil del jugador debe **agregar TODO** lo que producen las fases de partido:
> - **Estadísticas** del partido (F7 — `match_player_stats`).
> - **Valoraciones** del partido: **individual** (`evaluations`: rating + comentario + MVP) y **colectiva** del equipo (`team_evaluations`).
> - **Comentarios visibles** (campo `comment` de `evaluations`) y **comentarios privados** (`evaluation_private_notes`).
> - **Notas de jugador** transversales (7.13 — `player_notes`).
>
> Con **dos vistas diferenciadas**: la del **entrenador/cuerpo técnico** lo ve **todo** (incluido lo privado: notas privadas + `player_notes`); la del **jugador/familia** solo lo permitido (su valoración individual + la colectiva + el comentario visible + el MVP, **y solo si el club activó la visibilidad** — flag `club_settings.evaluations_player_visibility`). Nunca lo privado.
>
> **F8 solo abrió el permiso a nivel de datos** (RLS: la lectura de jugador/familia ya cumple la policy con el flag ON). **La pantalla donde el jugador/familia VE su valoración se entrega en F9** — F8 no construyó ninguna vista de lectura para ellos.

**Estado**: ☑ **CERRADA (2026-06-12)** — núcleo (9.1/9.2/9.3/9.5) + segundo tramo 9.B (9.4/9.6/9.7/9.8 + entrada de menú) **entregados y verificados** (typecheck · lint · test · build en verde; ver limitación pgTAP abajo). Resumen ejecutivo en [fase-9-summary.md](fase-9-summary.md). Detalle del núcleo en [spec 9.0 §15](../specs/9.0-perfil-jugador.md); del segundo tramo en [spec 9.B](../specs/9.B-segundo-tramo.md).

**Horas**: 16–32 h plan · **Sesiones**: 6–8 · **PRs del núcleo**: #67 (9.1), #68 (9.2), #69 (9.3), #70 (9.5). **PRs del segundo tramo**: #108 (spec) + #109 (9.B-0) + #110 (9.B-1) + #111 (9.B-2) + #112 (9.B-3) + #113 (9.B-4) + #114 (9.B-5) + #115 (9.B-6+7). **Migración del núcleo**: `20260625000000_match_player_stats_player_select.sql` (policy SELECT player-scoped, D9-1).

**Criterio de cierre** (cumplido): cada jugador tiene su perfil deportivo completo. Gráfico de evolución intra-temporada **(✅)** y comparativa multi-temporada **(✅ 9.B-1/2)**. Reportes mensuales en PDF que el entrenador puede descargar e imprimir para entregar a familias **(✅ 9.B-6/7)**. Vista restringida para familias **(✅)**.

**Riesgo**: medio. PDF y multi-temporada son las partes exigentes — **ambas quedan en el segundo tramo**.

**Dependencias**: Fase 8 cerrada.

**Subfases**:

**Núcleo — entregado (especificado en [spec 9.0](../specs/9.0-perfil-jugador.md)):**

- **9.1** ✅ Perfil deportivo del jugador con stats agregadas (vista staff, extiende `/jugadores/[playerId]`; agregación por query directa, sin vistas materializadas — D9-C; selector de temporada; helpers en `@misterfc/core/player-profile`) — #67
- **9.2** ✅ Stats derivadas (ratios) + desglose de asistencia por código (cálculo puro, reusa los buckets de ADR-0007) — #68
- **9.3** ✅ Gráfico de evolución intra-temporada de la valoración (recharts, **ADR-0016**; nota individual + colectiva como contexto; huecos para partidos sin valorar; tabla `sr-only` equivalente) — #69
- **9.5** ✅ Vista jugador/familia — ruta nueva `/mi-ficha` (resolución vía `player_accounts` + selector si hay varios) reutilizando los bloques del staff; **policy SELECT nueva en `match_player_stats`** (`user_is_account_of_player`, sin flag — 🔒 D9-1) + pgTAP. Stats/ratios/asistencia SIEMPRE; valoraciones solo con el flag del club ON; nunca lo privado — #70

**Segundo tramo 9.B — entregado (especificado en [spec 9.B](../specs/9.B-segundo-tramo.md)):**

> Habilitador previo: **9.B-0** [hecho 2026-06-12] **agregado de stats de equipo por temporada** (`aggregateTeamStats` en core + query) — #109. Lo consumen 9.B-3, 9.B-7 y los badges de equipo.

- **9.4** ✅ Evolución multi-temporada del jugador (comparativa por temporadas). Core (`careerBySeason`/`careerTotals`/`seasonComparison`) en **9.B-1** [hecho 2026-06-12] #110; UI (toggle Temporada/Carrera + tabla por temporada + gráfico de comparación) en **9.B-2** [hecho 2026-06-12] #111.
- **9.6** ✅ Tracking de logros (badges automáticos, **sin persistencia** — D6). Core (`evaluateSeasonBadges`/`evaluateCareerBadges` + thresholds fijos) en **9.B-4** [hecho 2026-06-12] #113; UI (sección "Logros", badges rating-sensibles gateadas por el flag — D5) en **9.B-5** [hecho 2026-06-12] #114. **12 badges** implementadas (MVP desdoblada en `mvp_match`/`mvp_season` + `high_rating`; "debutante" diferida — ver diferidos abajo). Catálogo completo en [fase-9-summary.md](fase-9-summary.md).
- **9.7** ✅ Reportes mensuales del jugador en PDF (descargables/imprimibles, no email — D10) — **9.B-6** [hecho 2026-06-12] #115.
- **9.8** ✅ Reportes de equipo en PDF (resumen mensual, consume 9.B-0) — **9.B-7** [hecho 2026-06-12] #115 (mismo PR que 9.B-6: comparten infra `@react-pdf/renderer` y branding).
- **9.B-3** ✅ **Entrada de menú "Estadísticas agregadas por equipo"** para el cuerpo técnico + vista de equipo (consume 9.B-0) — [hecho 2026-06-12] #112.

**Diferidos de F9 (v2 / backlog — ubicados en el roadmap):**

- **Badge "debutante"** ☐ → **backlog de badges**. La regla quedó sin cerrar (primer partido registrado, ± ventana de fechas). Requiere decisión de producto antes de implementar. Sin modelo nuevo (derivado al vuelo como el resto).
- **Badges absolutas por categoría** ☐ → **refinamiento v2**. Los umbrales absolutos (10 goles; 50/100/200 partidos de `veteran`) no escalan entre benjamines y seniors. v1 usó umbrales únicos + badges relativos (`top_scorer_team`, `mvp_season`) que se autoajustan; v2 puede introducir umbrales por categoría (`categories.kind`). Decisión D4 lo dejó explícitamente abierto.
- **PDF v2** ☐ → **v2 PDF**. (a) **Gráficos dentro del PDF** (hoy fuera — D8 usa la tabla `sr-only` equivalente). (b) **Escudo del club** en la cabecera: `clubs` **no tiene** columna de logo hoy; cuando se añada (`clubs.logo_url`), la cabecera lo incluye junto al nombre + verde de marca (D9). Ambos son presentación pura sobre el dato ya calculado.

> **Reaprovechamiento confirmado**: el núcleo se diseñó para no rehacerse y así fue — **recharts** + `rating-evolution-chart.tsx` alimentaron la línea multi-temporada (9.B-2); la **tabla `sr-only`** y la disciplina "la pantalla ES el reporte" (datos en `@misterfc/core/player-profile`) fueron base directa de los PDF (9.B-6/7); los **helpers de agregación** aceptaron `season` como parámetro sin lógica nueva. El **agregado de equipo** (9.B-0) se implementó **una vez** y lo reutilizan 9.B-3, 9.B-7 y los badges de equipo.

---

### Rework A — categorías ↔ equipos (la temporada vive en el equipo) ✅ [cerrado 2026-06-10]

> **No es una fase numerada**: es un **rework estructural** del modelo de F2/F3, intercalado entre el **núcleo de F9** (#71) y su **segundo tramo** (9.4 multi-temporada se apoya en `teams.season`). Spec: [docs/specs/A.0-categorias-equipos.md](../specs/A.0-categorias-equipos.md) · ADR: [ADR-0017](../decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md).

**Qué cambió**: la **temporada** deja de vivir en la categoría (`categories.season`) y baja al **equipo** (`teams.season`, `NOT NULL`). La **categoría** pasa a ser una **plantilla permanente** del club (`name + kind + half_duration_minutes`, **sin `season` ni `order_idx`**; el orden de listado se deriva del `kind` — constante `CATEGORY_KIND_ORDER`, 🔒O1). "Infantil A 2025-26" e "Infantil A 2026-27" son **equipos distintos** con su propio roster (`team_members`). Unicidad nueva: `unique(club_id, name, season)` en `teams` (con `club_id` denormalizado, D3) y `unique(club_id, lower(name))` en `categories`. La navegación gira en torno al equipo: nuevo `/equipos` (listado por temporada) + `/equipos/plantillas` (categorías-plantilla); `/categorias` → 308.

**Estado**: ✅ **cerrado (2026-06-10)** — patrón **EXPAND → MIGRATE → CONTRACT**, un PR por subfase, cada uno dejando `main` verde (typecheck · lint · test · build) y F9 vivo.

**Subfases / PRs**:

- **A1 EXPAND** — `teams.season` + `teams.club_id` (aditivo, **solo `teams`**) + backfill + endurecer (`NOT NULL`, regex, FK, `unique(club_id,name,season)`) + trigger `teams_derive_from_category` (deriva `club_id` siempre; `season` por fallback si NULL). ADR-0017. — **#80**
- **A2 MIGRATE** — F9 (crítico): los 6 filtros y selectores de temporada de `jugadores/[playerId]` y `mi-ficha` pasan a `teams.season`. — **#81**
- **A3 MIGRATE** — ripple display/DTO (~14 puntos): listados/cabeceras leen la temporada por `teams.season`. — **#82**
- **A4 MIGRATE** — `categories.season`/`order_idx` → **NULLABLE** + `/equipos` (listado por temporada + alta = temporada+categoría+división+nombre) + `/equipos/plantillas` (crear/renombrar, sin season/orden) + nav "categorías"→"equipos" + redirects 308 + retirada del CRUD viejo de `/categorias`. — **#83**
- **A5 MIGRATE** — import: **equipo por fila** (resolución nombre→`team_id` en club+temporada activa; no crea equipos) + columna **`players.invite_email`** (🔒O2, solo se guarda) + selector de lote como fallback. — **#84**
- **A6 CONTRACT** — dedup de categorías por `(club_id, lower(name))` (re-apunta `teams`/`events`) → **DROP `categories.season` + `order_idx`** + `unique(club_id, lower(name))` + retirada del **fallback de `season`** del trigger (la derivación de `club_id` se queda). pgTAP. — **#86**

**Fuera de alcance (futuro)**:

- **Season rollover / clonado de equipos-rosters** de una temporada a la siguiente (crear los equipos del año nuevo copiando los del anterior con su plantilla): su propia mini-spec.
- **Auto-envío real del `invite_email`** desde el import (este rework solo **persiste** el email; el envío, el destinatario y el RGPD son fase posterior — 🔒O2).

---

### Fase 10 — Dashboard ejecutivo del club

**Objetivo**: pantalla agregada del club para admin_club y coordinadores. Visión global del estado del club: plantilla, resultados, asistencia, alertas y rankings.

**Estado**: ☑ **Cerrada (2026-06-14)** — todas las subfases entregadas (10.1–10.6) y verificadas (typecheck · lint · test · build en verde). **Sin BD nueva** → sin migraciones ni pgTAP (`DT1`/`DT3`). Spec íntegra de la fase en [docs/specs/10.0-dashboard-ejecutivo.md](../specs/10.0-dashboard-ejecutivo.md); cierre detallado en [fase-10-summary.md](fase-10-summary.md).

**Horas**: 6–8 h · **Sesiones**: 2–3 · **PRs**: #118 (spec) + #119 (10.0), #120 (10.1), #121 (10.2), #123 (10.3), #125 (10.4), #126 (10.6), #127 (10.5). NO mergeados por el agente (los mergea el responsable).

**Criterio de cierre**: admin del club puede entrar al dashboard y ver de un vistazo: total de jugadores, distribución por categoría/equipo, resultados acumulados, % asistencia a entrenamientos, alertas de jugadores con baja asistencia, ranking de goleadores y MVPs. ✅

**Riesgo**: bajo *(en la práctica la agregación club-wide fue net-new; ver nota de fidelidad en [fase-10-summary.md](fase-10-summary.md))*. Reusa el **patrón** D9-C (helpers puros + loaders) y piezas de F9 (recharts + tabla `sr-only`, buckets de asistencia), no la lógica de agregación.

**Dependencias**: Fase 9 cerrada. *(Nota 2026-06-09: el **núcleo de F9 está hecho** — stats agregadas, ratios, evolución y vista jugador/familia ya disponibles y reutilizables — pero **F9 no está cerrada del todo**: faltan el multi-temporada y los PDF del segundo tramo. F10 puede apoyarse en los agregados/helpers del núcleo; lo que dependa específicamente del multi-temporada o de los reportes PDF espera al cierre completo de F9.)*

**Decisiones cerradas** (spec §6): `DT1` no materializar (helpers puros, MV diferida) · `DT2` cálculo en `@misterfc/core`, loaders delegan · `DT3` RLS heredada (sin políticas nuevas) · `D1` temporada activa + comparativa (selector libre → v2) · `D2` solo partidos `closed`, GF/GA null ≠ 0 · `D3` baja asistencia <60% y ≥5 sesiones · `D4` inactivo sin stats ni asistencia · `D5` rankings por categoría · `D6` rankings de rating **no** gateados por el flag (público admin/coord) · `D7` export PDF diferido.

**Subfases** (con el troceo Variante A realmente implementado — la 10.0 helpers core se añadió como habilitador; la 10.1 del roadmap "vistas materializadas" se reinterpretó como agregación en helpers, `DT1`):

- **10.0** Helpers de agregación club-wide en core (puros + Vitest): `aggregateClubStats`, `aggregateTeamResults`, `clubAttendanceAgg`, `clubRankings` — #119 `[hecho 2026-06-13]`
- **10.1** Ruta `/dashboard` + nav role-aware + gating server-side + loader base + censo (loaders sin N+1, `IN(teamIds)`, RLS heredada) — #120 `[hecho 2026-06-13]`
- **10.2** Sección de plantilla del club: **solo stats agregadas** — totales, distribución por categoría/equipo, comparativa con la temporada anterior. El listado completo de jugadores con filtros vive en **F2.10**, y el listado de cuerpo técnico en **F2.11**. F10.2 enlaza a ambas; no las duplica. — #121 `[hecho 2026-06-13]`
- **10.3** Sección de resultados acumulados por equipo (W-D-L / GF-GA, `D2`) — #123 `[hecho 2026-06-14]`
- **10.4** Sección de asistencia a entrenamientos (media, ranking, tendencia — recharts + tabla `sr-only`) — #125 `[hecho 2026-06-14]`
- **10.6** Sección de rankings por categoría (goleadores, MVPs, mejor valoración media; `D5`/`D6`) — #126 `[hecho 2026-06-14]`
- **10.5** Alertas: baja asistencia (`D3`) + jugadores inactivos (`D4`). **Cierra F10.** — #127 `[hecho 2026-06-14]`

---

### Fase 11 — Biblioteca de ejercicios

**Objetivo**: sistema completo de gestión de ejercicios: categorización rica, filtros, ficha detallada, editor visual para crear ejercicios propios.

**Horas**: 13–18 h · **Sesiones**: 5–6

**Criterio de cierre**: entrenador puede explorar biblioteca de ejercicios con filtros (objetivo táctico, categoría de edad, intensidad, duración). Puede ver ficha completa con diagrama del campo. Puede crear sus propios ejercicios con editor visual.

**Riesgo**: medio. Editor visual (PitchEditor) tiene complejidad técnica.

**Dependencias**: Fase 2 cerrada.

**Subfases**:

- **11.1** Modelo `exercises` con categorización rica (objetivo, edad, intensidad, duración, espacio) — 1 h
- **11.2** Catálogo inicial de ejercicios genéricos (~30) precargados — 1–2 h
- **11.3** Vista listado con filtros — 2 h
- **11.4** Ficha detallada del ejercicio (diagrama + descripción + objetivos + variantes) — 2 h
- **11.5** PitchEditor: editor visual del campo (conos, jugadores, balón, flechas) — 4–5 h
- **11.6** Crear/editar ejercicio propio — 2 h
- **11.7** Ejercicios privados del entrenador vs compartidos del club — 1 h
- **11.8** Importar/exportar ejercicios (JSON) — 1 h
- **11.9** Agrupar capabilities por dominio en panel del ayudante — 1–2 h. Refactor de la UI de capabilities (hoy `/equipos/[teamId]/staff/[membershipId]/capabilities`, plana) a subgrupos colapsables por dominio: **squad** (can_manage_squad), **match** (can_create_lineups, can_register_match_events, can_evaluate), **calendar** (can_manage_calendar, can_create_sessions, can_create_plays), **attendance** (asistencia, convocatorias), **comms** (can_message_families). **Motivación**: con 11+ capabilities planas la UI se vuelve mar de switches sin estructura, y la lista seguirá creciendo con F11-F13 (sesiones, jugadas, pizarra). Hacerlo antes que F12/F13 introduzcan más capabilities evita un refactor más caro después. Recoge la deuda registrada en `known-issues.md` como "capabilities UI plana". Sin cambio de modelo de datos — solo presentación.

---

### Fase 11B — Pizarra táctica en vivo (sobre la alineación)

> **Fase intercalada (no renumera F12–F16)**: se inserta **después de F11 y antes de F12**. Lleva etiqueta `F11B` (no número correlativo) precisamente para **no renumerar** las fases existentes. Añadida 2026-06-14.

**Objetivo**: tablero táctico para usar **en directo** durante el partido o el entrenamiento. Carga la **alineación real** con sus jugadores ya colocados en el campo y permite **dibujar encima** (flechas, balón, líneas de movimiento, trazo libre) para mostrar las jugadas a los jugadores **en el momento**. Pensado para tablet. Es **distinto de F12/F13**: aquellas sirven para **diseñar** jugadas/sesiones de entrenamiento; F11B es para **presentar en vivo** sobre la alineación real (sin animación por frames ni playbook — eso sigue en F13).

**Horas**: ~6–9 h (estimación **preliminar**, a refinar al escribir su spec) · **Sesiones**: 2–3

**Estado**: ☐ pendiente.

**Criterio de cierre**: el cuerpo técnico abre la pizarra desde la pantalla de partido en vivo (F7) o desde la alineación, ve el **once real** sobre el campo y puede trazar flechas, mover el balón, dibujar líneas de movimiento y trazo libre **sobre esa alineación** para explicar la jugada en el momento, en tablet. Sin persistencia de playbook ni animación por frames (ámbito de F13).

**Riesgo**: medio. El grueso del trabajo es **integrar la capa de dibujo de F11 sobre la alineación real** de `<MatchFieldEditor>`; el reto es la interacción táctil en directo, no construir un campo nuevo (ya existe).

**Dependencias**: **Fase 11 cerrada** (reusa la capa de dibujo / PitchEditor de F11). **No afecta a F12/F13** — todas dependen solo de F11.

**Reúso (NO duplica componentes de campo)**:

- **`<MatchFieldEditor>`** (F6.3): campo SVG + fichas de jugadores + carga de la alineación real.
- **PitchEditor / capa de dibujo de F11** (F11.5): flechas, balón, líneas de movimiento, trazo libre.

**Accesos**: desde la **pantalla de partido en vivo (F7)** y desde la **alineación** (F6).

**Subfases** (preliminar, se concretan al escribir la spec):

- **11B.1** Montar la pizarra cargando la alineación real (`<MatchFieldEditor>` con el once colocado) — 1–2 h
- **11B.2** Capa de dibujo sobre la alineación (reusa PitchEditor F11: flechas, balón, líneas de movimiento, trazo libre) — 2–3 h
- **11B.3** Accesos desde partido en vivo (F7) y desde la alineación (F6) — 1 h
- **11B.4** Modo presentación táctil para tablet (pantalla limpia, trazos sobre el once) — 1–2 h

---

### Fase 12 — Planificador de sesiones

**Objetivo**: construir sesiones de entrenamiento por bloques arrastrando ejercicios de la biblioteca. Vista microciclo, exportación PDF, publicación al equipo, plantillas reutilizables de microciclo.

**Horas**: 12–20 h · **Sesiones**: 4–6

**Criterio de cierre**: entrenador arma una sesión en menos de 5 minutos, la publica al equipo con un click. Vista del microciclo semanal y mensual. Puede guardar un microciclo como plantilla y aplicarlo a otra semana o equipo.

**Riesgo**: bajo. Reusa muchísimo de la Fase 11 (biblioteca).

**Dependencias**: Fase 11 cerrada (reusa PitchEditor).

**Subfases**:

- **12.1** Modelo `sessions` y `session_blocks` — 1 h
- **12.2** Editor de sesión por bloques (calentamiento, principal, vuelta a la calma) — 2–3 h
- **12.3** Vista microciclo semanal — 1–2 h
- **12.4** Plan de temporada (macro + mesociclos) — 1–2 h
- **12.5** Publicación de sesión al equipo (visible para jugadores) — 1 h
- **12.6** Exportación a PDF para imprimir — 1–2 h
- **12.7** Plantillas de microciclo reutilizables (guardar y aplicar) — 4–8 h

---

### Fase 13 — Pizarra táctica y jugadas (modo iPad)

**Objetivo**: pizarra táctica 2D con animación por frames para diseñar jugadas. Biblioteca de jugadas del equipo. Modo presentación iPad para vestuario.

> **Frontera con F11B**: F13 es el **autor de jugadas** — playbook **animado por frames**, biblioteca de jugadas del equipo y modo presentación iPad para vestuario (diseño, no directo). La **presentación en vivo sobre la alineación real** durante el partido/entreno es **F11B**, no F13.

**Horas**: 12–16 h · **Sesiones**: 5–6

**Criterio de cierre**: entrenador diseña jugadas animadas (movimiento de jugadores entre frames). Las guarda en la biblioteca del equipo. Las puede compartir con jugadores para que las memoricen. Modo presentación iPad para mostrar en vestuario.

**Riesgo**: medio-alto. Animación por frames + sincronización + presentación.

**Dependencias**: Fase 11 cerrada (reusa PitchEditor).

**Subfases**:

- **13.1** Modelo `plays` con frames — 1 h
- **13.2** Editor de jugada: pizarra + timeline de frames — 3–4 h
- **13.3** Animación entre frames (interpolación de posiciones) — 2–3 h
- **13.4** Reproducción de jugada (play/pause/scrub) — 1–2 h
- **13.5** Biblioteca de jugadas del equipo (playbook) — 2 h
- **13.6** Compartir jugada con el equipo (visible para jugadores) — 1 h
- **13.7** Modo presentación iPad (pantalla completa, sin distracciones) — 2 h
- **13.8** Exportar jugada como vídeo o GIF — 1–2 h

---

### Fase 14 — RGPD para menores y seguridad

**Objetivo**: cumplimiento RGPD para datos de menores: consentimiento parental explícito, audit log de accesos a datos sensibles, derechos del usuario (acceso, rectificación, supresión, portabilidad). Además: endurecimiento de RLS en políticas hoy demasiado permisivas (F2.7 capabilities, F3 events).

**Horas**: 12–18 h · **Sesiones**: 4–5

**Criterio de cierre**: alta de jugador menor requiere consentimiento explícito de tutor con timestamp y versión del documento aceptado. Audit log activo en accesos a datos médicos. Usuario puede ejercer sus derechos desde la UI.

**Riesgo**: medio. Implicaciones legales si se hace mal.

**Dependencias**: Fase 8 cerrada.

**Subfases**:

- **14.1** Documento de consentimiento parental v1 (texto + checklist) — 1–2 h
- **14.2** Flujo de aceptación al alta de jugador menor (registro + timestamp + IP) — 2 h
- **14.3** Re-consentimiento si cambia el documento — 1 h
- **14.4** Audit log de accesos a datos sensibles (médicos, fotos) — 2–3 h
- **14.5** Derecho de acceso (descarga JSON de todos los datos del jugador) — 1–2 h
- **14.6** Derecho de rectificación (UI para editar) — ya cubierto en Fase 2, validar — 30 min
- **14.7** Derecho de supresión (borrado lógico con plazo de gracia) — 2 h
- **14.8** Política de privacidad y términos versionados en la app — 1–2 h
- **14.9** Endurecer RLS de `capabilities` a `team_staff` específico — 1–2 h. Hoy las RLS permiten que un entrenador_principal del club edite las capabilities de cualquier ayudante de cualquier equipo del club. Debe filtrar al `team_staff` concreto al que pertenece ese ayudante (un principal solo puede tocar las capabilities de los ayudantes activos en sus propios equipos). Migración con drop+create de las policies de `capabilities` + helper `user_is_principal_of_assistant_team(membership_id)` (SECURITY DEFINER) + pgTAP con 4 casos. Recoge la deuda registrada en `known-issues.md` como "F2.7 capabilities cross-team". Sin cambio de UI.
- **14.10** Endurecer RLS de `events` para aislamiento equipo-a-equipo — 1–2 h. Hoy la RLS de `events` solo verifica miembro del club; el filtrado "jugador ve solo eventos de su equipo" es UX, no seguridad. Un jugador autenticado puede listar via API todos los eventos del club. Cambio: predicate SELECT añade `(team_id IS NULL OR user_is_in_team(team_id))` cuando el rol es jugador/ayudante. Migración + pgTAP con 4 casos (jugador del team A no ve evento del team B; ayudante sin team_staff no ve nada; admin/coord ven todo del club; eventos globales sin team_id siguen visibles). Recoge la deuda registrada en `known-issues.md` como "F3 events RLS visibilidad".

---

### Fase 15 — Testing, observabilidad y operaciones

**Objetivo**: cobertura de tests E2E de los flujos críticos, alertas de Sentry configuradas, runbook operativo, monitorización.

**Horas**: 8–12 h · **Sesiones**: 3–4

**Criterio de cierre**: tests E2E con Playwright para los 5 flujos críticos (registro, alta jugador, convocar partido, toma de datos en directo, valoración + perfil). Sentry con alertas activas. Runbook documentado.

**Riesgo**: bajo.

**Dependencias**: Fases 1–14 cerradas.

**Subfases**:

- **15.1** Setup Playwright + primer test E2E (login) — 1–2 h
- **15.2** Tests E2E flujo de alta de jugador — 1–2 h
- **15.3** Tests E2E flujo de convocatoria + confirmación — 1 h
- **15.4** Tests E2E flujo de toma de datos en directo (el más crítico) — 2 h
- **15.5** Tests E2E flujo de valoración + ver perfil — 1 h
- **15.6** Alertas de Sentry configuradas (threshold + canal) — 1 h
- **15.7** Runbook operativo (qué hacer si X falla) en `docs/architecture/runbook.md` — 1–2 h
- **15.8** **pgTAP ejecutado de verdad en CI** (o paso contra el remoto) — 1–2 h. Hoy `.github/workflows/ci.yml` corre typecheck · lint · test · build pero **no ejecuta pgTAP**, y el sandbox de desarrollo no puede arrancar Docker (`no-new-privileges`, sin root) → los tests pgTAP de funciones/RLS de BD quedan **escritos pero sin ejecución automática**, validándose solo al aplicar la migración al remoto. La superficie de riesgo crece con cada función SECURITY DEFINER (Bug 2·2a/2c/2b, helpers de RLS, etc.). Opciones: (a) job CI con `supabase` CLI + Postgres+pgTAP en contenedor que corra `supabase/tests/*.sql`; (b) paso programado contra una BD de staging. Recoge la deuda registrada en `known-issues.md` como "pgTAP no se ejecuta en CI". Sin cambio de modelo — infra/calidad.

---

### Fase 16 — Beta cerrada con primer club

**Objetivo**: lanzar con un club real, recoger feedback estructurado, iterar.

**Horas**: 9–15 h (subfases 16.0–16.4: 6–10 h + F16.x bulk-invite +3–5 h) · **Sesiones**: 3–4

**Criterio de cierre**: club piloto operando MisterFC en producción durante al menos un mes con uso real (partidos, entrenamientos, asistencia, valoraciones). Feedback documentado en `docs/journey/retros/`.

**Riesgo**: medio (depende del club).

**Dependencias**: Fases 1–15 cerradas.

**Subfases**:

- **16.0** Configurar SMTP propio para emails de autenticación. El email integrado de Supabase tiene rate limit ~2-4/hora (solo testing). Sin SMTP propio, signup/invitaciones/reset fallan con 429. Configurar proveedor (Brevo recomendado: 300/día gratis, permite empezar sin dominio verificado; alternativa Resend con dominio). Setup en Supabase Dashboard → Auth → SMTP Settings. — 1–2 h
- **16.1** Onboarding del club (sesión con coordinador, importar plantilla, configurar permisos) — 2–3 h
- **16.2** Soporte directo durante 4 semanas — incluido en bolsa de horas
- **16.3** Recogida estructurada de feedback (cuestionarios + observación) — 1–2 h
- **16.4** Retro final + backlog priorizado para iteraciones — 1–2 h
- **16.x** Importación masiva de jugadores con invitación por email. Wizard tipo F2.9 con columnas `email` + `team` (Excel/CSV). Genera filas en `invitations` reutilizando el modelo de F1.6 y dispara los emails vía el SMTP propio configurado en F16.0. **Estrictamente depende de F16.0** — sin SMTP propio el rate limit de Supabase Auth (~2–4 emails/h) bloquearía el envío bulk tras 3–5 invitaciones, dejando el resto en estado fallido. Spec `docs/specs/16.x-bulk-invite-excel.md`. **Estimación**: 3–5 h. **Depende**: F16.0 (SMTP propio configurado y verificado).

---

## Backlog / futuro (sin fase asignada)

Bloques de funcionalidad acordados como pendientes pero **sin número de fase fijado todavía**: entran donde mejor encajen según prioridad (puede ser una fase nueva, una extensión de fase existente, o Ola 2/3).

### Gestión de entrenamientos

Bloque que agrupa todo lo relativo al ciclo de vida del entrenamiento más allá del marcado de asistencia que ya existe (F4). Candidato a fase propia o a extender F4/F12. Incluye, entre otros:

- **Confirmación de asistencia a entrenos por familias/jugadores** *(el #3 aplazado de las mejoras pre-cierre de F7, 2026-06-07)*: que el jugador/familia confirme si acudirá a cada entrenamiento (igual que la respuesta a convocatorias de partido en F4), de modo que el cuerpo técnico vea previsiones antes del entreno. Reusa el patrón `callup_responses` (respuesta del jugador) sobre eventos `training`. La asistencia **real** (post-entreno, `training_attendance`) ya existe en F4; esto añade la **previsión** previa.
- Otras piezas a definir: planificación/series de entrenos, objetivos por sesión, vínculo con el planificador de sesiones (F12) y con la biblioteca de ejercicios (F11).

> Nota: la mejora 7.14 (asistencia lun–vie en la convocatoria) ya muestra la asistencia **registrada** de la semana; la confirmación previa por familias/jugadores es lo que queda pendiente aquí.

---

### Gestión multi-club y plataforma (post-Ola 1)

Bloque de **gobernanza** que hoy no tiene fase porque Ola 1 es beta cerrada **mono-club**. Candidato a **fase posterior propia** (probable Ola 3 / cuando entre el segundo club). Incluye:

- **God user / superuser de plataforma**: rol transversal de Cognix Labs con acceso a **varios clubes** para soporte/operación, por encima del modelo `memberships` (hoy un profile pertenece a un club con un rol). Requiere repensar el alcance de la RLS (un superuser cruza la frontera de club, que es justo lo que F1.7 blinda) → diseño cuidadoso con su propia spec + auditoría de RLS. **No** se cuela en ninguna fase actual: es un cambio de modelo de acceso.
- **Owner de club** (sucesor natural de la guarda del último admin, Bug 2·2b — PR #116): un **admin protegido no degradable** (el "dueño" del club, distinto de un `admin_club` cualquiera) + **transferencia de propiedad** explícita. Hoy la guarda `would_remove_last_admin` impide quedarse sin admin, pero todos los `admin_club` son intercambiables; el owner añade una capa de propiedad estable y un flujo de traspaso. Encaja junto al god user porque ambos tocan el modelo de roles/propiedad a nivel plataforma.

> Diferido **desde el cierre de F9** (2026-06-12). Sin estimación todavía; entra con su propia spec cuando el multi-club deje de ser hipotético.

### Comunicaciones por email propio (canal email)

Bloque de **comunicaciones/onboarding** que consolida el canal email, hoy disperso entre subfases y reworks. El bootstrap técnico ya está planificado (**F16.0** SMTP propio + **F16.x** bulk-invite); este bloque agrupa lo que va **más allá** del arranque de beta:

- **Remitente verificado del dominio** (Resend/SMTP con dominio propio): no solo "que salgan emails" (F16.0), sino remitente de marca verificado (SPF/DKIM) para entregabilidad real a familias.
- **Envío masivo a familias con enlace de descarga**: distribuir el **PDF del jugador** (9.7) por email con enlace de descarga — es el destino natural de la decisión **D10** de 9.B (que dejó el PDF en "solo descarga, sin email"). Reusa el agregado/PDF ya construido.
- **Auto-envío real del `invite_email`** (Rework A5, 🔒O2): el import **persiste** el email del jugador pero **no lo envía**; aquí se cierra el envío de la invitación con su destinatario y su tratamiento RGPD.
- **Retirada del magic-link**: una vez el canal email propio es fiable, evaluar sustituir/retirar el magic-link de Supabase Auth por el flujo propio.

> Diferido **desde el cierre de F9** (2026-06-12). Cross-ref: **F16.0** (SMTP), **F16.x** (bulk-invite), Rework A "Fuera de alcance" (auto-envío `invite_email`), 9.B **D10** (PDF sin email). Candidato a fase de comunicaciones propia o a extensión de F16 según prioridad de beta.

---

## 7. Ola 2 — App nativa Android + iOS

**Objetivo**: una vez validado el producto en Ola 1 con beta cerrada, se construye la app nativa para App Store y Google Play. Reutiliza `packages/core` del monorepo (lógica de negocio, llamadas API, validación, hooks) y reconstruye la UI con primitivas nativas para garantizar máxima calidad y rendimiento en el día de partido (drag & drop, animaciones).

**Horas**: 50–70 h · **Sesiones**: 18–25

**Propuestas**:

- **O2.1** App nativa Android + iOS (React Native): aplicación nativa publicada en App Store y Google Play. Reusa al 100 % la lógica de Ola 1 desde `packages/core`. UI reconstruida con React Native + Reanimated 3 + react-native-gesture-handler para máximo rendimiento en drag & drop táctil (toma de datos en directo del partido y pizarra táctica) y animaciones fluidas. Push notifications nativas vía FCM/APNs (más fiables que en PWA). Cuenta Apple Developer Program y Google Play Developer requeridas.

---

## 8. Ola 3 — A definir tras feedback de beta

Espacio reservado para propuestas que surjan tras el uso real de Ola 1 y Ola 2 por parte de clubs. No hay compromiso ni estimación todavía. Algunas ideas parkeadas que pueden o no entrar en Ola 3 según prioridades:

- **Monetización SaaS (Stripe + planes)**: plan free vs Pro con suscripciones Stripe para sostenibilidad económica del producto.
- **Comparativas entre jugadores**: comparar dos o más jugadores de la misma posición (stats, evolución, valoraciones).
- **IA: sugerencia de ejercicios según objetivos**: dado un objetivo del microciclo, la IA sugiere ejercicios de la biblioteca que encajan.
- **Integración con FFCV (scraping web federativa)**: descarga automática del calendario de partidos, resultados oficiales, clasificación y fichas oficiales de jugadores desde la web de FFCV. Frágil por naturaleza (cada cambio de su web rompe el scraper), por eso queda fuera del MVP.
- **Más ideas a definir**: espacio abierto para nuevas propuestas que surjan en la beta.

---

## 9. Fuera del plan (explícito)

Las siguientes funcionalidades quedan explícitamente fuera del alcance de MisterFC. No es por imposibilidad técnica, sino por foco de producto:

- Gestión financiera del club (cuotas, contabilidad, facturación).
- Web pública del club o portal de aficionados.
- Scouting de jugadores externos al club.
- Análisis de vídeo de partidos.
- Vista 3D en la pizarra táctica.
- Control de cargas con wearables o GPS.

---

## 10. Riesgos transversales y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| F7 Toma de datos en vivo no rinde en iPad de gama media | Media | Alto | Tests en dispositivo real desde la subfase, definir iPad de referencia mínimo |
| RLS mal configurada filtra datos entre clubs | Baja | Crítico | Tests SQL exhaustivos en F1.7, auditoría al cerrar F1 |
| Push iOS PWA poco fiable | Alta | Medio | Asumido. Solución real en Ola 2 con app nativa |
| Migraciones Supabase irreversibles aplicadas mal | Baja | Alto | Backup manual antes de cada migración, working tree limpio obligatorio |
| Burnout del implementador (proyecto largo) | Media | Alto | 2–3 h/día sostenibles, retros mensuales, descansos planificados |
| Cliente beta abandona | Media | Alto | Sesiones de onboarding cuidadas, soporte directo en F16 |

---

## 11. Gestión de incidencias durante el plan

- **Bugs críticos** (datos perdidos, RLS rota, fuga de info): parar la fase actual, abrir hotfix, mergear, retomar.
- **Bugs no críticos**: documentar en `docs/journey/known-issues.md` y abordar en su fase natural o al cierre de la fase actual.
- **Cambios de scope**: si una subfase requiere más del doble de horas estimadas, parar y reevaluar antes de seguir.
- **Bloqueos por dependencias externas** (Supabase, Vercel, Sentry caídos): documentar, esperar restauración, retomar.

---

## 12. Próximo paso concreto

Cerrar Fase 0 ejecutando el `_bootstrap/PROMPT.md` con Claude Code. Al terminar y mergear el PR resultante, Fase 0 queda como ☑ completada y arrancamos Fase 1 (Modelo de datos y auth multi-rol con permisos configurables).

---

**Fin del Plan Maestro v1.0**
