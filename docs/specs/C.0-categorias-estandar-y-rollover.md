# Spec C.0 — Rework C: categorías estándar fijas + transición de temporada (rollover)

> Estado: **decisiones cerradas** (2026-06-10) · Solo spec, **cero código/migraciones** en esta tanda.
> Autor: auditoría 2026-06-10 sobre el modelo REAL (no de memoria), rama `docs/spec-rework-c`.
> Precede: Rework A (la temporada vive en el equipo) y Rework B (invitaciones).
> Cubre dos features (numeración del usuario): **#3 categorías estándar fijas** y **#4 transición de temporada**.

---

## 0. Resumen ejecutivo

- **#3 — Categorías estándar fijas:** que cada club tenga SIEMPRE el catálogo estándar de fútbol base sembrado (los `kind` canónicos O1), y que el admin **solo cree equipos dentro**, no categorías. Refina A4 (que dejó el alta de categorías libre en `/equipos/plantillas`).
- **#4 — Transición de temporada (rollover):** el admin **finaliza** la temporada actual (p.ej. 25/26), **abre** la siguiente (26/27), **recrea equipos** y **reasigna jugadores en bloque** de forma manual y fácil (ej. *Infantil A 25/26 → Cadete C 26/27*), **preservando TODO el histórico** (stats F9, evaluaciones F8, asistencia, eventos).
- **La buena noticia del modelo actual:** el histórico ya está protegido por diseño. La pertenencia jugador↔equipo es **temporal** (`team_members` con `joined_at`/`left_at`) y las queries de roster filtran por **ventana de fechas**; la temporada vive **solo** en `teams.season` y todo lo demás cuelga de `team_id`. Por tanto el rollover **no migra datos viejos**: crea equipos nuevos y mueve membresías; los equipos viejos (y su histórico) se quedan intactos.
- **El riesgo principal:** casi todos los FK a `teams(id)` son `ON DELETE CASCADE`. **Borrar un equipo viejo destruye su histórico.** El rollover debe basarse en *crear nuevo + cerrar membresía*, **nunca** en borrar.

---

## 1. Estado actual verificado (auditoría 2026-06-10)

Fuente: `packages/core/src/supabase/database.ts` (tipos generados del remoto), migraciones `supabase/migrations/*`, y actions/queries reales. Citas con archivo:línea.

### 1.1 `categories` — plantilla permanente (tras A6)

Columnas reales (database.ts):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `club_id` | uuid | FK clubs |
| `name` | text | |
| `kind` | **text \| null** | **NO es enum de BD**: texto libre validado en código |
| `half_duration_minutes` | int | duración de cada tiempo |
| `created_at` | timestamptz | |

- **NO** tiene `season` ni `order_idx` (los quitó A6, `20260630000000_rework_a6_categories_contract.sql`). El orden de listado se **deriva de `kind`** vía `CATEGORY_KIND_ORDER` (O1).
- Constraint de A6: **`unique(club_id, lower(name))`** (un nombre por club, case-insensitive).
- **`kind` canónico (O1)** — `packages/core/src/schemas/club-structure.ts:35-66`. 10 valores con ordinal y `half_duration` (este último por backfill de `20260605000003_categories_half_duration.sql`, **no** forzado por columna/constraint):

  | kind | ordinal | half_duration (min) |
  |---|---|---|
  | querubin | 1 | 15 |
  | prebenjamin | 2 | 20 |
  | benjamin | 3 | 25 |
  | alevin | 4 | 30 |
  | infantil | 5 | 35 |
  | cadete | 6 | 40 |
  | juvenil | 7 | 45 |
  | amateur | 8 | 45 |
  | senior | 9 | 45 |
  | veterano | 10 | 45 |

  > El usuario listó 9; el código tiene **10** (incluye `senior`, que "algunos clubs usan en vez de amateur" — comentario de la migración). `kind = null` permitido (plantillas sin grupo de edad → ordinal 99, al final).

- **Cómo se crean hoy (A4):** pantalla `/equipos/plantillas`. CRUD libre por admin/coord en `equipos/plantillas/actions.ts`:
  - `createCategoryTemplate` (:80) — INSERT con `name + kind(opcional) + half_duration_minutes`; unicidad suave por nombre.
  - `updateCategoryTemplate` (:110) — renombrar/editar kind/duración.
  - `deleteCategoryTemplate` (:147) — bloqueado si la plantilla tiene equipos colgando (cualquier temporada), porque `teams.category_id` es **NOT NULL** y la cascada borraría equipos.
  - Form: `equipos/plantillas/category-dialog.tsx` (kind como selector opcional + duración).

### 1.2 `teams` — instancia por temporada (tras A1)

Columnas reales:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `club_id` | uuid **NOT NULL** | **derivado por trigger** desde la categoría (D3) |
| `category_id` | uuid **NOT NULL** | ⚠️ **no es nullable** (la suposición del encargo era incorrecta) |
| `season` | text **NOT NULL** | `YYYY-YY`, **string libre** (regex), sin tabla detrás |
| `name` | text | |
| `format` | text | `F7`/`F8`/`F11` |
| `division` | text \| null | slug opcional |
| `color` | text | `#RRGGBB` |
| `created_at` | timestamptz | |

- `unique(club_id, name, season)` + índice `(club_id, season)` (A1, `20260627000000`).
- **Trigger `teams_derive_from_category`** (`20260627000001`, BEFORE INSERT/UPDATE): pone `club_id := categories.club_id` siempre. El fallback de `season` desde la categoría **ya se retiró en A6** (categories.season no existe); el alta aporta `season` explícita.
- **Cómo se crean hoy:** pantalla `/equipos` → `teamCreateSchema` (`club-structure.ts:152`): `category_id + season + name + format + color + division`. La `season` por defecto en la UI sale de `currentSeason()`.

### 1.3 Vínculo jugador↔equipo — **`team_members`** (CRÍTICO para el rollover)

**No existe `players.team_id`.** El único vínculo es la tabla `team_members` (`20260527114323_players_and_team_members.sql:85`):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `player_id` | uuid NOT NULL | FK players, **ON DELETE CASCADE** |
| `team_id` | uuid NOT NULL | FK teams, **ON DELETE CASCADE** |
| `joined_at` | date NOT NULL | default `current_date` |
| `left_at` | date \| null | **NULL = activo**; fecha = histórico |
| `dorsal_in_team` | int \| null | dorsal en ese equipo |
| `position_in_team` | text \| null | gk/def/mid/fwd |

- **Es un historial, no un estado.** Comentario de la tabla: *"Al cambiar de equipo no se borra: se cierra con `left_at` y se inserta nueva fila."*
- `unique(player_id, team_id) where left_at is null` — una sola pertenencia **activa** por (jugador, equipo).
- **Roster time-aware:** convocatorias/alineación/próximo-partido seleccionan miembros con `joined_at <= fecha_evento AND (left_at IS NULL OR left_at >= fecha_evento)` (`convocatorias/actions.ts:40-47`, `next-match-queries.ts:128-133`, `alineacion/actions.ts:202-205`). → **un evento histórico ve a los jugadores que estaban en el equipo ESE día**, aunque luego se muevan.
- **Asignación hoy (uno a uno):** `jugadores/actions.ts:330` `assignPlayerToTeam` → **cierra** el `team_member` activo (cualquier equipo) con `left_at = today` (:360) e **inserta** uno nuevo con `joined_at = today` (:372). **Esto es exactamente el primitivo del rollover, pero individual.**

> **Implicación para #4:** "mover Infantil A 25/26 → Cadete C 26/27" = insertar `team_members(player, equipo_nuevo, joined_at = inicio_26/27)` y cerrar la membresía del equipo viejo. Como son `team_id` distintos, el histórico 25/26 queda intacto (las queries de eventos 25/26 siguen viendo al jugador en Infantil A por la ventana de fechas).

### 1.4 Concepto de "temporada"

- **NO hay tabla `seasons`.** **NO hay "temporada activa" de club** (revisado `clubs`, `club_settings` — solo `evaluations_player_visibility`). La temporada es **solo** el string `teams.season`.
- El **25/26 por defecto** sale de `currentSeason()` (`club-structure.ts:167`): heurística por reloj (cambia el 1 de agosto, formato `YYYY-YY`). Se usa en `/equipos` (filtro/ default) y en el import.
- El conjunto de temporadas existentes se calcula a runtime como `distinct teams.season` por club (`/equipos`).

### 1.5 Qué cuelga de equipo/temporada (qué PRESERVAR en el rollover)

`season` vive solo en `teams`; **todo lo demás cuelga de `team_id`** (y por tanto hereda temporada del equipo). FK a `teams(id)` (auditoría de migraciones):

- **ON DELETE CASCADE** (se destruyen si se borra el equipo → **el rollover NO debe borrar equipos**): `team_members`, `match_player_stats` (F9), `evaluations`/`team_evaluations` (F8), `lineups`/`lineup_positions`, `match_*` (periods, events, state, starters, absences, callup_meta), `training_attendance`, `coach_formations`, `team_staff`.
- **ON DELETE SET NULL** (sobreviven, se desvinculan): `events.team_id` (nullable), `announcements`, `notifications` (algunas).
- Eventos: `events` tiene `team_id` (nullable, set null) + `category_id` (nullable) + `starts_at`. La asistencia/convocatoria de un evento cuelga del evento.

> **Conclusión:** preservar histórico = **no borrar equipos viejos**. El rollover crea equipos nuevos (`season` nueva) y mueve membresías; los equipos 25/26 y todo su histórico permanecen consultables.

### 1.6 Creación de club

- RPC **`create_club_with_admin`** (SECURITY DEFINER atómica, `20260527153019`): crea `clubs` + membership `admin_club`. `clubs` tiene INSERT directo prohibido (`clubs_insert_forbidden`).
- **Hoy NO siembra categorías.** Es el punto natural para el sembrado de #3 (+ backfill de clubes existentes).

---

## 2. Feature #3 — Categorías estándar fijas

### 2.1 Objetivo

Cada club arranca con el catálogo estándar sembrado (los `kind` O1, con su `half_duration` por defecto). El admin **crea equipos dentro de las categorías**, no categorías. Esto da consistencia entre clubs (informes, comparativas, el rollover "sube de categoría") y elimina la deriva de nombres libres de A4.

### 2.2 Qué implica sobre lo actual

- **Sembrado al crear club:** añadir a `create_club_with_admin` (o un paso post-creación) el INSERT de las N categorías estándar (`name` legible + `kind` + `half_duration` del mapa O1).
- **Backfill de clubes existentes:** migración que, por cada club, inserta las categorías estándar que le falten (idempotente, por `kind`).
- **Reconciliación de categorías custom (A4):** los clubs pueden haber creado categorías con nombre libre y `kind` null o repetido. **Se conservan (grandfathering, D-a)**: no se borran ni se migran. La unicidad `unique(club_id, lower(name))` puede chocar al sembrar si el club ya tiene "Infantil" con otro casing → el sembrado es *upsert por kind*, no por name.
- **UI de crear categorías:** se **retira** el alta de categorías (D-a/C4); el club solo crea equipos. Se mantiene editar `half_duration` de las estándar.

### 2.3 Naming del catálogo estándar

`kind` es el identificador canónico (querubin…veterano). El `name` sembrado es el label legible (es-ES / Comunidad Valenciana, p.ej. "Infantil", "Cadete"), con localización vía el namespace i18n `category_kinds`; `kind` = canónico. Así el orden por `kind` ya funciona y el club no ve un string técnico.

---

## 3. Feature #4 — Transición de temporada (rollover)

### 3.1 Objetivo

Flujo guiado para que el admin pase de 25/26 a 26/27:
1. **Finalizar 25/26** (cerrar la temporada que acaba).
2. **Abrir 26/27** (definir la temporada destino).
3. **Recrear equipos** en 26/27 (clonar la estructura de equipos de 25/26, o crear desde cero).
4. **Reasignar jugadores en bloque**, manual y fácil: por cada equipo origen elegir el equipo destino (ej. *Infantil A 25/26 → Cadete C 26/27*), revisando/ajustando la lista de jugadores.
5. **Preservar todo el histórico** (stats, evaluaciones, asistencia, eventos de 25/26 intactos).

### 3.2 Cómo encaja en el modelo actual (sin reinventar)

- **Recrear equipos = insertar `teams` con `season = '2026-27'`** (mismo `category_id`/`name`/`format`/`color` o ajustados). Los equipos 25/26 **se quedan**.
- **Reasignar jugador = mover su `team_members`**: insertar fila en el equipo destino con `joined_at = inicio de 26/27` y cerrar (`left_at`) la del equipo origen. Idéntico a `assignPlayerToTeam`, pero **en lote por equipo**.
- **Histórico:** no se toca nada de 25/26. Las queries time-aware garantizan que los eventos viejos sigan coherentes.
- **"Subir de categoría" (Infantil→Cadete):** es solo que el equipo destino cuelga de otra categoría. No hay lógica de edad automática en esta tanda (manual, como pide el encargo).

### 3.3 Cómo queda definido (núcleo de #4)

- **"Finalizar temporada"** (D-b): la season saliente pasa a `status = finalized` y se activa la nueva; las membresías activas no movidas se cierran (`left_at`) a una fecha de corte. No borra nada.
- **Modelo de temporada** (D-b): tabla `seasons(club_id, label, status active|finalized)`, una activa por club, controlada por el admin; los equipos nuevos toman la activa por defecto (se desacopla del reloj `currentSeason()`).
- **Reasignación en bloque** (D-c): asistente de mapeo equipo→equipo con checklist de jugadores, sobre la mecánica de `assignPlayerToTeam`, idempotente y sin borrar.

---

## 4. Decisiones (🔒 CERRADAS — 2026-06-10)

### 🔒 D-a · Catálogo estándar fijo; el club NO crea categorías; custom preexistentes se conservan
- Se **siembran las 10 categorías estándar** (los `kind` canónicos O1) por club. Son **no borrables** y su `kind` no se renombra (sí editable `half_duration`).
- Se **QUITA la creación de categorías por el club**: el club **solo crea equipos** dentro de las categorías.
- Las **categorías custom preexistentes** (creadas libremente en A4) se **CONSERVAN** (grandfathering, no destructivo): no se borran ni se migran, pero **no se pueden crear nuevas**.
- Consecuencia: la subfase **CONTRACT deja de ser opcional** — incluye **retirar la UI/acción de crear categorías** (`createCategoryTemplate` + el botón/diálogo de alta) conservando las custom existentes.

### 🔒 D-b · Tabla `seasons` mínima + temporada activa controlada por el admin
- Nueva tabla por club: **`seasons(club_id, label, status)`** con `status ∈ {active, finalized}` y **una sola `active` por club** (constraint).
- La **temporada activa la controla el ADMIN** (no el reloj). Los equipos nuevos toman por defecto la **temporada activa** del club.
- Se **desacopla el default del reloj** `currentSeason()`: deja de ser la fuente del 25/26 por defecto (puede quedar como semilla inicial al sembrar la primera season, pero la UI lee la activa).

### 🔒 D-c · Asistente de mapeo equipo→equipo, idempotente, sin borrar
- **Asistente de rollover** de una pantalla por **mapeo de equipos**: "Equipo (season activa) → [selector] Equipo (season nueva)", y bajo cada fila la **lista de jugadores con checkbox** (todos marcados por defecto) para excluir bajas.
- Un submit que, por jugador marcado, **reutiliza la mecánica de `assignPlayerToTeam`**: cierra la membresía origen (`left_at`) y abre la destino (`joined_at = inicio de la nueva season`).
- **Idempotente** (si un jugador ya está en destino, no duplica). **Invariante: NUNCA borra** — crear equipo nuevo + mover membresía.
- **No** hay ascenso automático por edad (manual, como pide el encargo). Hueco para sugerencias futuras (Infantil→Cadete por `kind` ordinal +1).

### 🔒 D-d · Migración de #3 con patrón EXPAND → MIGRATE → CONTRACT
- Mismo patrón que Rework A, para no romper histórico ni lectores:
  - **EXPAND:** señal `is_standard` en `categories` (o derivar de `kind` canónico) + backfill idempotente que siembra en cada club los estándar que falten (upsert por `kind`) + semilla en `create_club_with_admin`. Aditivo.
  - **MIGRATE:** `/equipos/plantillas` pasa a catálogo gestionado; estándar no borrables/renombrables; reconciliación visible de custom (se conservan, sin borrar equipos).
  - **CONTRACT (no opcional):** retirar la UI/acción de **crear** categorías; las custom existentes se quedan. No destructivo.

---

## 5. Troceo en subfases (pequeñas, en orden)

> **Dependencia global: el bloque #3 (C1–C4) va ANTES que el #4 (C5–C8).** Cada subfase: una migración aditiva como mucho, lectores migrados aparte, contract al final. Verificación typecheck+lint+test+build + pgTAP donde toque. PRs independientes, sin merge automático.

**Bloque #3 — categorías estándar (C1 → C2 → C3 → C4, en orden)**
- **C1 — EXPAND (aditiva):** catálogo estándar como datos. Helper en core con la lista canónica (reusar O1) + labels i18n. Migración: señal `is_standard` en `categories` (o derivada del `kind` canónico) + backfill idempotente que siembra en cada club los estándar que falten (upsert por `kind`). NO toca UI. *(Depende de: nada.)*
- **C2 — semilla al crear club:** ampliar `create_club_with_admin` para sembrar el catálogo estándar al crear club. Test: club nuevo nace con las 10 categorías. *(Depende de: C1.)*
- **C3 — UI plantillas (MIGRATE):** `/equipos/plantillas` pasa a catálogo gestionado: estándar **no borrables/renombrables** (editable `half_duration`); custom preexistentes visibles y conservadas. Aún no se retira el alta (se prepara). *(Depende de: C1–C2.)*
- **C4 — CONTRACT (no opcional):** retirar la **UI/acción de crear categorías** (`createCategoryTemplate` + diálogo/botón de alta). Las custom existentes se conservan (grandfathering, no destructivo). El club a partir de aquí **solo crea equipos**. *(Depende de: C3.)*

**Bloque #4 — rollover (C5 → C6 → C7 → C8; arranca solo tras C4)**
- **C5 — modelo de temporada:** tabla `seasons(club_id, label, status active|finalized)` con **una activa por club**; backfill desde `distinct teams.season` (la más reciente = activa); migrar los usos de `currentSeason()` → **temporada activa del club**. Aditiva. *(Depende de: #3 cerrado.)*
- **C6 — recrear equipos:** acción "abrir temporada nueva" que clona la estructura de equipos de la activa a la nueva (insert `teams` con la season nueva), **sin tocar los viejos**. UI de revisión. *(Depende de: C5.)*
- **C7 — reasignación en bloque:** asistente de **mapeo equipo→equipo + checklist de jugadores** (D-c); RPC/serv. action que, por jugador, cierra membresía origen y abre destino (`joined_at = inicio nueva season`). **Idempotente, sin borrar.** *(Depende de: C6.)*
- **C8 — finalizar temporada:** marcar la season saliente `finalized` + activar la nueva; cerrar `left_at` de las membresías activas no movidas, a fecha de corte. Salvaguardas (confirmación; **no borra nada**). *(Depende de: C7.)*

---

## 6. Invariantes y salvaguardas (no negociables)

1. **Nunca borrar equipos para "limpiar" temporada** → cascada destruye histórico (F8/F9/asistencia). Cerrar/archivar, no borrar.
2. **Roster es temporal:** mover jugadores = cerrar `left_at` + abrir fila nueva; jamás `update team_id` in-place (rompería la ventana de fechas del histórico).
3. **Idempotencia** del sembrado (#3) y del rollover (#4): re-ejecutar no duplica ni rompe.
4. **Categorías estándar identificadas por `kind` canónico** (O1), no por nombre libre.
5. Patrón **EXPAND→MIGRATE→CONTRACT** y verificación completa por subfase, como en Rework A.

---

## 7. Fuera de alcance (explícito)

- Ascenso automático por edad (Infantil→Cadete) — en #4 es **manual**.
- Multi-club / traspasos entre clubs.
- Cambios en el motor de stats (F9) o evaluaciones (F8): solo se **preservan**.
- Branding/email (eso es Rework B3).

---

## 8. ADR candidato

- **ADR-00XX — Modelo de temporada y rollover sin destruir histórico:** categorías estándar fijas por `kind` (club no crea categorías, custom A4 grandfathered), temporada como entidad (`seasons` + temporada activa controlada por el admin), rollover por *crear-equipo-nuevo + mover-membresía* (cerrar `left_at`/abrir fila), prohibición de borrado de equipos. Decisiones D-a..D-d cerradas (§4); redactar el ADR al arrancar C1.
