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
| F5 | Mensajería interna y notificaciones push | 8–12 h | 3–4 | ☐ |
| F6 | Alineaciones y planificación del partido | 12–19 h | 4–5 | ☑ |
| F7 | Toma de datos en directo del partido | 10–14 h | 4–5 | ☐ |
| F8 | Valoraciones del partido y del entrenamiento | 8–13 h | 3–4 | ☐ |
| F9 | Perfil del jugador, evolución y reportes | 16–32 h | 6–8 | ☐ |
| F10 | Dashboard ejecutivo del club | 6–8 h | 2–3 | ☐ |
| F11 | Biblioteca de ejercicios | 13–18 h | 5–6 | ☐ |
| F12 | Planificador de sesiones | 12–20 h | 4–6 | ☐ |
| F13 | Pizarra táctica y jugadas (modo iPad) | 12–16 h | 5–6 | ☐ |
| F14 | RGPD para menores y seguridad | 12–18 h | 4–5 | ☐ |
| F15 | Testing, observabilidad y operaciones | 8–12 h | 3–4 | ☐ |
| F16 | Beta cerrada con primer club | 9–15 h (subfases 16.0–16.4 6–10 h + F16.x bulk-invite +3–5 h) | 3–4 | ☐ |
| **TOTAL Ola 1** | | **176–273 h** | **64–83** | |

> **Cambio 2026-05-29**: F2 reabierta como "extendida" con F2.10 (listado global de jugadores) y F2.11 (gestión global de cuerpo técnico). F16 incorpora F16.x (bulk-invite por email, depende de F16.0 SMTP propio). El lote inicial de F2 (subfases 2.0–2.9) sigue cerrado operacionalmente; lo que se reabre es el alcance. Delta acumulado sobre el plan original: +11–19 h (159–243 → 170–262).

> **Cambio 2026-05-29 (planificación)**: F6 ampliada de "Alineaciones del partido" → "Alineaciones y planificación del partido" con 4 nuevas subfases (F6.6 importar convocatoria, F6.7 banquillo, F6.8 cambios programados, F6.9 notas tácticas) y nota arquitectural sobre `<MatchFieldEditor>` reutilizable en F7. Delta F6: 6–9 h / 2–3 sesiones → 9–14 h / 3–4 sesiones (+3–5 h, +1 sesión). Ver [ADR-0009](../decisions/ADR-0009-f6-f7-match-field-editor-compartido.md).

> **Cambio 2026-05-30 (deuda diferida → plan)**: 3 puntos de deuda registrados en `known-issues.md` movidos a subfases concretas + 1 ejecutado en el mismo PR. F11 +1 subfase (11.9 capabilities agrupadas por dominio) → 12–16 h ⇒ 13–18 h. F14 +2 subfases (14.9 RLS capabilities por team_staff, 14.10 RLS events team-isolation) → 10–14 h ⇒ 12–18 h. La 4ª deuda (housekeeping redirect 308 `/mi-plantilla` → `/mis-equipos`) se ejecutó en este mismo PR — app en beta cerrada con piloto único, sin bookmarks externos a la URL antigua, riesgo de breakage = 0. Delta total Ola 1: +3–6 h (170–262 → 173–268).

> **Cambio 2026-05-31 (extensión F6.10)**: F6 +1 subfase (6.10 plantillas personalizadas de formación, tabla `coach_formations`) → 9–14 h / 3–4 sesiones ⇒ 12–19 h / 4–5 sesiones. Delta total Ola 1: +3–5 h (173–268 → 176–273), +1 sesión (63–82 → 64–83). Se planifica junto al Lote B de F6 (mismo PR de plan).

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

**Horas**: 10–14 h · **Sesiones**: 4–5

**Criterio de cierre**: operador puede registrar todos los eventos del partido (gol, asistencia, tarjeta, sustitución, corner, falta, fuera de juego, tiro a puerta) con un gesto de arrastrar y soltar. Funciona en iPad apaisado y portátil. Línea de tiempo editable. Cierre del partido consolida stats al perfil del jugador.

**Riesgo**: medio-alto. Drag & drop táctil en tablet, performance, edición de eventos.

**Dependencias**: Fase 6 cerrada.

**Subfases**:

- **7.1** Modelo `match_events` extendido (type, side, player_id?, rival_dorsal?, minute, second_half, x_pct?, y_pct?, metadata) — 1 h
- **7.2** Layout iPad apaisado / desktop (cronómetro + campo + paleta + toggle rival) — 1–2 h
- **7.3** Drag & drop: eventos sobre jugador (gol, asistencia, tarjetas amarilla/roja) — 2–3 h
- **7.4** Drag & drop: eventos sobre campo (corner, falta, fuera juego, tiro) con ubicación — 1–2 h
- **7.5** Sustituciones (2-step: sale → entra) — 1 h
- **7.6** Eventos del equipo rival (toggle + panel rival) — 1 h
- **7.7** Cronómetro avanzado (descanso, prórroga, edición manual) — 1 h
- **7.8** Línea de tiempo del partido editable — 1–2 h
- **7.9** Cierre del partido y consolidación de stats al perfil del jugador — 1–2 h
- **7.10** Jugadores rivales destacados y notas post-partido — 30 min
- **7.12** Panel de próximo partido en Inicio (estado + CTA al paso que toca; aviso de convocatoria pendiente para jugador/familia; admin no lo ve) — 1–2 h

> El desglose autoritativo y la renumeración de subfases de F7 (incl. *Tiempo de juego por jugador* como 7.8) viven en [docs/specs/7.0-toma-datos-en-directo.md](../specs/7.0-toma-datos-en-directo.md) §8. La **7.12** (panel en Inicio) lee datos existentes (F4/F6/F7.1), sin migración.

---

### Fase 8 — Valoraciones del partido y del entrenamiento

**Objetivo**: sistema de valoraciones para partidos y entrenamientos: 1-10 + notas individuales, MVP, visibilidad configurable.

**Horas**: 8–13 h · **Sesiones**: 3–4

**Criterio de cierre**: entrenador puede valorar a cada jugador tras un partido (1-10 + notas + MVP) y tras un entrenamiento. Configuración por club de qué pueden ver jugadores y familias.

**Riesgo**: medio-bajo. Decisión sensible: qué ven jugadores y familias.

**Dependencias**: Fase 7 cerrada.

**Subfases**:

- **8.1** Modelo `evaluations` unificada (event_id, player_id, rating 1-10, notes, visibility, is_mvp) — 30 min
- **8.2** UI valoración post-partido (slider 1-10, notas, MVP) — 1–2 h
- **8.3** UI valoración post-entrenamiento — 2–3 h
- **8.4** Designación de MVP y notas privadas — 1 h
- **8.5** Configuración de visibilidad por club — 1 h
- **8.6** Tests de RLS de valoraciones — 1 h

---

### Fase 9 — Perfil del jugador, evolución y reportes

**Objetivo**: vista de perfil deportivo del jugador con stats agregadas, ratios, evolución intra-temporada y multi-temporada, badges y reportes mensuales en PDF exportables.

**Horas**: 16–32 h · **Sesiones**: 6–8

**Criterio de cierre**: cada jugador tiene su perfil deportivo completo. Gráfico de evolución intra-temporada y comparativa multi-temporada. Reportes mensuales en PDF que el entrenador puede descargar e imprimir para entregar a familias. Vista restringida para familias.

**Riesgo**: medio. PDF y multi-temporada son las partes exigentes.

**Dependencias**: Fase 8 cerrada.

**Subfases**:

- **9.1** Perfil deportivo del jugador con stats agregadas — 2 h
- **9.2** Stats derivadas y desglose de asistencia por código — 1–2 h
- **9.3** Gráfico de evolución intra-temporada de valoraciones — 1–2 h
- **9.4** Evolución multi-temporada del jugador (comparativa por temporadas) — 3–5 h
- **9.5** Vista para familia (acceso restringido) — 1 h
- **9.6** Tracking de logros (badges automáticos: MVP del mes, +10 goles, etc.) — 1 h
- **9.7** Reportes mensuales del jugador en PDF (descargables/imprimibles, no email) — 5–8 h
- **9.8** Reportes de equipo en PDF (resumen mensual) — 2–4 h

---

### Fase 10 — Dashboard ejecutivo del club

**Objetivo**: pantalla agregada del club para admin_club y coordinadores. Visión global del estado del club: plantilla, resultados, asistencia, alertas y rankings.

**Horas**: 6–8 h · **Sesiones**: 2–3

**Criterio de cierre**: admin del club puede entrar al dashboard y ver de un vistazo: total de jugadores, distribución por categoría/equipo, resultados acumulados, % asistencia a entrenamientos, alertas de jugadores con baja asistencia, ranking de goleadores y MVPs.

**Riesgo**: bajo. Reusa stats ya generadas en fases anteriores.

**Dependencias**: Fase 9 cerrada.

**Subfases**:

- **10.1** Modelo de stats agregadas del club + cache (vistas materializadas) — 1 h
- **10.2** Sección de plantilla del club: **solo stats agregadas** — totales, distribución por categoría/equipo, comparativa temporadas. El listado completo de jugadores con filtros vive en **F2.10**, y el listado de cuerpo técnico en **F2.11**. F10.2 enlaza a ambas; no las duplica. — 1 h
- **10.3** Sección de resultados acumulados por equipo — 1 h
- **10.4** Sección de asistencia a entrenamientos (media, ranking, tendencia) — 1–2 h
- **10.5** Alertas: bajas de asistencia y jugadores inactivos — 1 h
- **10.6** Sección de rankings (goleadores, MVPs, mejor valoración media) — 1 h

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
