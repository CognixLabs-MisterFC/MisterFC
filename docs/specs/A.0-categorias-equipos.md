# Spec A.0 — Rework A: categorías ↔ equipos (la temporada vive en el EQUIPO)

> Tipo: **REWORK** (no es una fase del Plan Maestro; reestructura modelo + UI ya existentes de F2/F3).
> Estado: ✅ **DEFINITIVO — implementado y cerrado (2026-06-10)**. Todas las subfases A1–A6 entregadas y verificadas; `main` verde. Nota de cierre con el estado **real** implementado en **§12**.
> Autor: Iker Milla · Fecha: 2026-06-09 · Cierre: 2026-06-10
> Depende de: F2 (categories/teams/team_members/players, import), F3 (events), F7.6c (substitution_regimes, categories.kind, teams.division), F9 (fichas que filtran por temporada).
> ADR asociado: **[ADR-0017](../decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md) — Temporada en el equipo; categoría como plantilla permanente** (§11) — Accepted.

---

## 0. Resumen ejecutivo

Hoy la **temporada** vive en `categories.season`: cada "Infantil A" es una **fila distinta por temporada**, y el equipo hereda la temporada de su categoría (`team → category.season`). Este rework **mueve la temporada al equipo**:

- La **categoría** pasa a ser una **plantilla permanente** del club: `name + kind + half_duration_minutes`. **Sin `season` ni `order_idx`** manual (el orden se deriva del `kind`/edad).
- El **equipo** es una **instancia por temporada**: `teams` gana `season`. "Infantil A 2025-26" y "Infantil A 2026-27" son equipos **distintos** (mismo nombre, otra temporada, otro roster vía `team_members`).
- **Crear equipo** = elegir **temporada + categoría (+ división)** + nombre.
- La **navegación gira en torno al equipo**: nuevo listado `/equipos` (por temporada) + una pantalla simple para gestionar las categorías-plantilla. El nav "Categorías" pasa a "Equipos".
- El **import de jugadores** podrá asignar a un **equipo por fila** (p.ej. "Infantil B") y acepta una **columna de email** preparada para el futuro auto-envío de invitaciones.

El **régimen de cambios** (`categories.kind` + `teams.division` → `substitution_regimes`) y la **duración** (`categories.half_duration_minutes`) **no se tocan**: ya viven donde deben (kind/duración en la plantilla; división en el equipo). La temporada **no** interviene en el régimen.

---

## 1. Estado actual verificado (auditoría)

### 1.1 Modelo
- **`categories`** ([schema_base.sql:55-71](../../supabase/migrations/20260527110831_schema_base.sql)): `id, club_id, name, season (NOT NULL regex YYYY-YY), order_idx (NOT NULL default 0), created_at`, + `half_duration_minutes (NOT NULL default 45)` (20260605000003) + `kind (nullable)` (20260616000000). Índice `categories_club_season_idx (club_id, season)`. Comentario de tabla: *"Categoría dentro de un club y temporada"*.
- **`teams`** ([schema_base.sql:79-95](../../supabase/migrations/20260527110831_schema_base.sql)): `id, category_id (NOT NULL FK), name, format (F7/F8/F11), color, created_at`, + `division (nullable, slug)` (20260616000000). **Sin `season` ni `club_id`** → ambos se derivan vía `category`.
- **FKs directas a `categories(id)`** (solo 2): `teams.category_id` (NOT NULL) y **`events.category_id`** (NULLABLE; `events` también tiene `team_id` nullable — [events.sql:57-60](../../supabase/migrations/20260530000000_events.sql)).
- **`substitution_regimes`** (PK `category_kind, division`): régimen de cambios; datos de referencia. No depende de season.
- **`team_members`**: ata jugador↔equipo (`joined_at/left_at`) → la pertenencia ya es por equipo; al mover season al equipo, queda **por temporada** sin cambios de modelo.

### 1.2 Cómo se crea hoy
- **Categoría**: dialog [category-dialog.tsx](../../apps/web/src/app/%5Blocale%5D/%28authenticated%29/categorias/category-dialog.tsx) → [actions.ts](../../apps/web/src/app/%5Blocale%5D/%28authenticated%29/categorias/actions.ts). Pide **name + season + order_idx**.
- **Equipo**: dentro de `/categorias/[categoryId]` ([team-dialog.tsx](../../apps/web/src/app/%5Blocale%5D/%28authenticated%29/categorias/%5BcategoryId%5D/team-dialog.tsx) + actions). Pide name + format + division (la season la da la categoría).

### 1.3 Import
- [plantilla/importar/](../../apps/web/src/app/%5Blocale%5D/%28authenticated%29/plantilla/importar/) (UI) + `@misterfc/core/import` (`parse.ts`, `schema.ts`, `validate.ts`). Columnas: `first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, height_cm, weight_kg, origin`. **Sin email.** Asigna a **un equipo elegido en la UI para todo el lote** (`team_id` del wizard → `team_members`). `players` **no** tiene columna email.

### 1.4 Nav
- `categorias` → `/categorias` (lista categorías por temporada + alta) → `/categorias/[categoryId]` gestiona los **equipos** de esa categoría. No hay `/equipos` raíz (sí `/equipos/[teamId]` de detalle). Roles `admin_club`, `coordinador`.

---

## 2. Decisiones

### 🔒 Cerradas

- **🔒 D1 — Categoría = plantilla permanente** (`name + kind + half_duration_minutes`). **Sin `season` ni `order_idx`**. El **orden de listado se deriva del `kind`** (edad) — mapa concreto en **🔒 O1**.
- **🔒 D2 — Equipo por temporada**: `teams.season` (regex `^[0-9]{4}-[0-9]{2}$`). Mismo nombre en distinta temporada = equipos distintos, con su propio roster (`team_members`). Crear equipo = temporada + categoría + división + nombre.
- **🔒 D3 — Unicidad de equipo**: `unique (club_id, name, season)` (no dos equipos con el mismo nombre en el mismo club y temporada). Implica **denormalizar `club_id` en `teams`** (§3.2) — la constraint no puede mirar la `club_id` de la categoría sin trigger/columna generada.
- **🔒 D4 — Navegación en torno al equipo**: nuevo `/equipos` (listado por temporada; alta = temporada + categoría + división + nombre) + pantalla simple de **categorías-plantilla** (crear/renombrar, sin season ni orden). Nav `categorias → equipos`. Reparto de rutas en §6. Roles `admin_club` + `coordinador`.

### 🔒 Cerradas (antes abiertas; renombradas O1/O2/O3 para no chocar con las subfases A1–A6)

- **🔒 O1 — Mapa `kind → ordinal` y el `NULL`** (cierra D1). `querubin 1, prebenjamin 2, benjamin 3, alevin 4, infantil 5, cadete 6, juvenil 7, amateur 8, senior 9, veterano 10`; `kind = NULL` → ordinal `99` (al final), desempate por `name` (collation `es`, case-insensitive). Constante **`CATEGORY_KIND_ORDER`** en `@misterfc/core`, reutilizable por la UI.
- **🔒 O2 — Email del import → columna NUEVA en `players`, nullable, SOLO guardar (sin enviar)**, nombrada **`players.invite_email`** (es el email de **contacto/invitación**, probablemente del **familiar**, no del menor). **Quién recibe la invitación y el tratamiento RGPD se deciden en la fase futura del auto-envío** (fuera de este rework); aquí solo se persiste el dato.
- **🔒 O3 — Rutas**: **`/equipos` real** (listado + alta) + **redirect 308 `/categorias → /equipos`**; pantalla de categorías-plantilla y conservación de `/equipos/[teamId]` según §6.

---

## 3. Modelo final (DDL propuesto — NO crear aún)

### 3.1 `categories` (plantilla permanente) — ESTADO FINAL

> Este es el estado **final** (tras A6 CONTRACT). El rework llega aquí en pasos (EXPAND→MIGRATE→CONTRACT, §5/§9): **A1 NO toca `categories`**; en **A4** `season`/`order_idx` se hacen **NULLABLE** (ya migrados los lectores de display en A3, para no romper el typecheck); el **DROP + dedup + nueva unicidad** ocurre en **A6 CONTRACT**, cuando ya nadie las lee.

```sql
-- A6 CONTRACT — la categoría queda permanente por club (sin temporada ni orden).
alter table public.categories drop column season;
alter table public.categories drop column order_idx;
drop index if exists categories_club_season_idx;
-- nueva unicidad de plantilla: un nombre de categoría por club (normalizado).
create unique index categories_club_name_uniq
  on public.categories (club_id, lower(name));
comment on table public.categories is
  'Plantilla permanente de categoría del club (name + kind + half_duration_minutes). NO tiene temporada: la temporada vive en teams.season. El orden de listado se deriva de kind (CATEGORY_KIND_ORDER).';
```

Orden de listado (no es columna; se calcula en lectura): por `CATEGORY_KIND_ORDER[kind]` (🔒 O1), `NULL` al final, desempate por `name`.

### 3.2 `teams` (instancia por temporada)

```sql
alter table public.teams add column season text;          -- backfill §5, luego NOT NULL
alter table public.teams add column club_id uuid;          -- denormalizado (D3); backfill §5, luego NOT NULL
-- tras backfill:
alter table public.teams
  alter column season set not null,
  add constraint teams_season_format check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  alter column club_id set not null,
  add constraint teams_club_id_fkey foreign key (club_id) references public.clubs(id) on delete cascade,
  add constraint teams_club_name_season_uniq unique (club_id, name, season);
create index teams_club_season_idx on public.teams (club_id, season);
comment on column public.teams.season is
  'Temporada del equipo (YYYY-YY). La categoría es permanente; la temporada vive aquí.';
```

> Nota D3: la constraint `unique(club_id, name, season)` exige `club_id` en `teams`. Se **denormaliza** (vs. un trigger que valide contra `category.club_id`): es más simple, más barato y `club_id` de un equipo no cambia. Coherencia garantizada en el backfill (`teams.club_id := category.club_id`) y en el alta (se deriva de la categoría elegida).

### 3.3 `events`
Sin cambios de columnas. `events.category_id` (nullable) y `events.team_id` (nullable) se conservan. La **temporada del evento** se deriva ahora por `event → team → teams.season` (los eventos sin `team_id` —club-wide— no tienen temporada, como hoy).

### 3.4 Import (§7)
```sql
-- 🔒 O2 (A5): email de contacto/invitación (probablemente del familiar). SOLO se
-- guarda; el auto-envío y el RGPD son fase futura.
alter table public.players add column invite_email text
  check (invite_email is null or invite_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
```

---

## 4. Antes → después (de un vistazo)

| Aspecto | Hoy | Tras el rework |
|---|---|---|
| Temporada | `categories.season` | **`teams.season`** |
| Categoría | fila por (club, nombre, **temporada**) | **plantilla permanente** por (club, nombre) — `name + kind + half_duration_minutes` |
| Orden de categorías | `order_idx` manual | **derivado de `kind`** (edad) — 🔒O1 |
| Equipo | hereda temporada de su categoría | **instancia por temporada** (mismo nombre = equipos distintos por año) |
| Unicidad de equipo | (implícita por categoría) | **`unique(club_id, name, season)`** (+ `club_id` denormalizado) — D3 |
| Crear equipo | dentro de `/categorias/[id]` (name+format+division) | en `/equipos` (**temporada + categoría + división + nombre**) |
| Nav | "Categorías" → `/categorias` | **"Equipos" → `/equipos`** + pantalla de plantillas |
| Régimen / duración | `kind`+`division` / `half_duration` | **sin cambios** |
| Import | equipo único de lote | **equipo por fila** (+ fallback de lote) + **`players.invite_email`** |

---

## 5. Plan de migración — patrón EXPAND → MIGRATE → CONTRACT (NO crear aún)

**Por qué no una sola migración**: borrar `categories.season` de golpe rompería el **typecheck** de los ~20 sitios que hoy leen `teams.categories.season` → CI rojo. Se hace en **dos migraciones** (en subfases distintas, §9), con todo el código migrado en medio. **Invariante**: cada subfase = un PR que deja `main` con **CI verde y F9 funcionando**.

### Migración 1 — EXPAND (subfase A1, aditiva, **SOLO `teams`** — no rompe nada)
> Ajuste sobre el plan inicial: **A1 NO toca `categories`**. Ablandar `categories.season`/`order_idx` a NULLABLE se hace en **A4** (con la pantalla de plantillas), no aquí: hacerlo en A1 volvería `categories.season` `string | null` y rompería el typecheck de los ~14 lectores de display/DTO aún sin migrar (A3) → CI rojo.

1. **`teams.season` + `teams.club_id`** (nullable de inicio).
2. **Backfill** desde la categoría actual:
   ```sql
   update public.teams t
      set season  = c.season,
          club_id = c.club_id
     from public.categories c
    where c.id = t.category_id;
   ```
3. **Endurecer `teams`**: `season`/`club_id` → `NOT NULL` + check regex de `season` + FK de `club_id` + `unique(club_id, name, season)` + índice `teams_club_season_idx`.
4. **`categories` NO se toca en A1** (sigue con `season`/`order_idx` `NOT NULL` como hoy → todos los lectores actuales siguen funcionando).

### MIGRATE (código, subfases A2→A5, sin DDL salvo A4/A5)
Migrar lectura/escritura a `teams.season` (A2 filtros F9, A3 display). En **A4** se **ablanda `categories.season`/`order_idx` a NULLABLE** (ya migrados los lectores de display en A3) para que la pantalla de plantillas cree categorías sin season/orden; se reorienta UI (`/equipos` + plantillas). En **A5** se añade `players.invite_email` (import). Al acabar A5 **nada lee** `categories.season`/`order_idx`.

### Migración 2 — CONTRACT (subfase A6, cuando ya nadie las lee)
5. **Deduplicar categorías** (colapsar las que solo difieren por temporada). Por `(club_id, lower(name))` se elige **superviviente** (menor `created_at`); se re-apunta `teams.category_id` y `events.category_id`; se conservan `kind`/`half_duration_minutes` (iguales por nombre):
   ```sql
   with ranked as (
     select id,
            row_number() over (partition by club_id, lower(name) order by created_at, id) as rn,
            first_value(id) over (partition by club_id, lower(name) order by created_at, id) as keeper
       from public.categories
   )
   update public.teams  t set category_id = r.keeper from ranked r where t.category_id = r.id and r.rn > 1;
   update public.events e set category_id = r.keeper from ranked r where e.category_id = r.id and r.rn > 1;
   delete from public.categories c using ranked r where c.id = r.id and r.rn > 1;
   ```
   *(Datos actuales: 2 categorías de 1 temporada → 0 fusiones; escrita robusta para el caso general.)*
6. **Quitar de `categories`**: `season`, `order_idx`, `categories_club_season_idx`, actualizar el comentario de tabla, y añadir `categories_club_name_uniq (club_id, lower(name))` (§3.1).
7. **⚠️ Ajustar el trigger `teams_derive_from_category`** (creado en A1, migración `20260627000001`): **QUITAR el fallback de `season`** (la rama `if new.season is null then new.season := v_cat.season`), porque lee `categories.season` que aquí se borra. En A6 la `season` la aporta SIEMPRE el flujo `/equipos` (A4), así que ya no hace falta el fallback. **La derivación de `club_id` se MANTIENE** (`categories.club_id` sobrevive). Recrear la función con `create or replace` sin esa rama.
8. **Verificación post-CONTRACT** (en el spec): `events.category_id` apunta a categorías vivas; sin colisión de la nueva unicidad; insertar un team sin `season` ya falla (NOT NULL) en vez de heredarla.

> `players.invite_email` (🔒 O2) entra con el **import (A5)**, no aquí.

**pgTAP**: unicidad de equipo `(club, name, season)` (A1); categoría sin season + unicidad por nombre + `events.category_id` coherente tras dedup (A6). La temporada de un partido se deriva por `team.season`; régimen intacto.

---

## 6. Plan de /equipos + categorías-plantilla (D4)

| Ruta | Hoy | Tras el rework |
|---|---|---|
| `/categorias` | lista categorías por temporada + alta | **redirect 308 → `/equipos`** |
| `/equipos` | — (no existe raíz) | **NUEVO**: listado de equipos **agrupado/filtrado por temporada** (selector de temporada, default la más reciente); alta = **temporada + categoría + división + nombre** (reusa la validación de división contra `substitution_regimes`) |
| `/equipos/plantillas` | — | **NUEVO**: gestión de **categorías-plantilla** (crear/renombrar; `kind`/`half_duration`; **sin season ni orden** — funciona ya en A4 porque A1 las dejó nullable) |
| `/categorias/[categoryId]` | gestiona equipos de la categoría | **redirect 308 → `/equipos/plantillas`** |
| `/equipos/[teamId]` | detalle de equipo (anuncios, staff…) | **sin cambios** |
| nav `categorias` | "Categorías" → `/categorias` | **"Equipos" → `/equipos`** (clave i18n + href) |

- **Enlaces internos** a `/categorias` (revisar y re-apuntar): los que haya en otras vistas. Roles: `admin_club` + `coordinador` (igual que hoy).
- El alta de equipo deja de "colgar" de la categoría: ahora es un formulario propio con selector de **temporada** (libre, formato YYYY-YY) + **categoría** (plantilla existente) + **división** (catálogo del `kind`) + **nombre**.

---

## 7. Plan del import (#3 + 2º-bloque #1)

1. **Columna de EQUIPO por fila** (p.ej. "Infantil B"):
   - `@misterfc/core/import`: añadir `team` a `PLAYER_IMPORT_COLUMNS` + aliases (`equipo`, `team`) en `parse.ts`; validación en `schema.ts` (string libre, opcional).
   - **Resolución nombre→`team_id`**: en el server, dentro del **club + temporada activa** (la del wizard), match por `lower(name)`; fila con equipo no resoluble → error de fila (no se importa o se deja sin equipo, según UX).
   - `actions.ts`: usar el `team_id` **por fila**; **mantener el selector de lote como fallback** (filas sin columna de equipo → al equipo elegido en el wizard).
2. **Columna de EMAIL** (preparada, sin enviar nada — 🔒 O2): `invite_email` en columnas + aliases (`email`, `correo`, `e-mail`, `email familiar`) + validación (regex). Se persiste en **`players.invite_email`** (§3.4). Es el email de **contacto/invitación** (probablemente del familiar).
3. **Fuera de alcance aquí**: el auto-envío real de la invitación, **quién la recibe** y el **tratamiento RGPD** (fase posterior; leerá `players.invite_email` para crear la `invitation`).

---

## 8. Mapa del ripple (la temporada deja de venir por `category.season`)

### 🔴 Filtros REALES de query (6) — pasan a `team.season`. **Subfase propia y temprana (A2)**; crítico no romper F9.
- `jugadores/[playerId]/page.tsx`: `.eq('teams.categories.season', activeSeason)` ×3 (stats L182, asistencia L199, evolución L216) + lista de temporadas del selector desde trayectoria (L143/159).
- `mi-ficha/page.tsx`: idénticos ×3 (L139/154/171) + lista (L109/120).
→ Cambian a filtrar/derivar por **`teams.season`** (un nivel menos de embed): `teams!inner(season)` + `.eq('teams.season', activeSeason)`.

### 🟡 DISPLAY / DTO (~14) — cambio mecánico `teams.categories.season` → `teams.season`
- `jugadores/queries.ts` (`current_category_season`, season en lista de equipos), `cuerpo-tecnico/queries.ts` (varios `category_season`), `calendario/queries.ts`, `asistencia/queries.ts`, `convocatorias/queries.ts`, `convocatorias/[eventId]/directo/queries.ts` (`categorySeason`), `convocatorias/[eventId]/alineacion/queries.ts`, `equipos/[teamId]/page.tsx` + `equipos/[teamId]/anuncios/page.tsx`, `mis-equipos/queries.ts`, `mi-equipo/page.tsx`. *(Renombrar el campo a `season`/`teamSeason` o mantener el alias `category_season` apuntando a `team.season` para minimizar cambios de tipos en UI — a decidir en implementación.)*

### 🟢 Semántica que cambia (CRUD de categorías)
- `categorias/page.tsx` (lista por temporada), `categorias/category-dialog.tsx` + `actions.ts` (alta con season + order_idx), `categorias/[categoryId]/page.tsx`/`team-dialog.tsx` → se reescriben hacia `/equipos` + categorías-plantilla (§6).

### ⚪ NO se tocan
- Régimen de cambios (`kind` + `division` + `substitution_regimes`) y `half_duration_minutes`. La derivación del directo seguirá leyendo `categories.kind` + `teams.division` (y ahora `teams.season` para display).

---

## 9. Subfases (patrón EXPAND → MIGRATE → CONTRACT)

**Invariante**: cada subfase es **un PR** que deja `main` con **CI verde (typecheck/lint/test/build) y F9 funcionando**. Por eso `categories.season` **no se borra** hasta A6, cuando ya nadie la lee.

| Subfase | Tipo | Alcance | Est. |
|---|---|---|---|
| **A1** | **EXPAND** | Migración 1 (§5): `teams.season`+`teams.club_id` con backfill + endurecer (`NOT NULL`, regex, FK, `unique(club_id,name,season)`, índice). **SOLO `teams` — NO toca `categories`**. Migración 2: **trigger `teams_derive_from_category`** (deriva `club_id` siempre + `season` si NULL desde la categoría, BEFORE → los inserts existentes y los 24 fixtures pasan sin tocarlos). Editar **solo** `categorias/[categoryId]/actions.ts` (pasa `club_id`+`season` de la categoría → satisface el tipo Insert). **ADR-0017**. pgTAP de unicidad de equipo + backfill. Regenerar `database.ts`. | 3–4 h |
| **A2** | MIGRATE | **F9 a `team.season` (CRÍTICO)**: los 6 filtros + selectores de temporada de `jugadores/[playerId]` y `mi-ficha`. Smoke de las dos fichas. | 2–3 h |
| **A3** | MIGRATE | **Ripple display/DTO** (~14 puntos §8): cambio mecánico a `teams.season` en listados/cabeceras. | 2–3 h |
| **A4** | MIGRATE | **`categories.season`/`order_idx` → NULLABLE** (migración aditiva; ya migrados los lectores de display en A3) **+ `/equipos` + categorías-plantilla** (§6, 🔒O3): listado por temporada + alta (temporada+categoría+división+nombre), pantalla de plantillas (crear/renombrar sin season/orden — funciona porque ya son nullable), nav "Equipos", redirects 308 `/categorias`→`/equipos` y `/categorias/[id]`→`/equipos/plantillas`. **Retira el CRUD viejo de `/categorias` basado en temporada.** Orden por `kind` (🔒O1). i18n. | 4–6 h |
| **A5** | MIGRATE | **Import** (§7): columna de **equipo por fila** (resolución nombre→team_id en club+temporada) + **`players.invite_email`** (🔒O2); selector de lote como fallback. Migración aditiva de `players.invite_email`. Tests de `@misterfc/core/import`. | 3–4 h |
| **A6** | **CONTRACT** | Migración CONTRACT (§5): **dedup de categorías** (re-apunta `teams`/`events`) → **quitar `categories.season`+`order_idx`** + índice + comentario → `unique(club_id, lower(name))` → **ajustar el trigger `teams_derive_from_category`: quitar el fallback de `season`** (mantener la derivación de `club_id`). pgTAP (categoría sin season, unicidad por nombre, `events.category_id` coherente, insert de team sin season → NOT NULL). Regenerar `database.ts`. *(Seguro: A2–A5 ya dejaron de leer `category.season`.)* | 2–3 h |

**Orden**: **A1 (EXPAND)** → **A2 (F9, crítico)** → A3 → A4 → A5 → **A6 (CONTRACT)**. **Total** ≈ **16–23 h**.

---

## 10. Fuera de alcance (explícito)

- **Season rollover / clonar equipos-rosters** de una temporada a la siguiente (crear los equipos de 2026-27 copiando los de 2025-26 con su plantilla): **futuro**, su propia mini-spec.
- **Auto-envío real del email** de invitación desde el import: **fase posterior** (este rework solo **guarda** el email y deja la columna/alias listos).
- **Histórico/versionado de plantillas** de categoría (renombrar una categoría afecta a todos sus equipos de todas las temporadas): se asume aceptable; no se versiona.

---

## 11. ADR candidato

- **ADR-0017 — Temporada en el equipo; categoría como plantilla permanente** (siguiente nº libre; último en main es ADR-0016). Decisión con impacto estructural duradero: invierte la relación temporada↔(categoría/equipo) de F2, denormaliza `club_id` en `teams` para la unicidad (D3), y reorienta la navegación al equipo (D4). Escribir al implementar A1. → **Escrito y Accepted**: [ADR-0017](../decisions/ADR-0017-temporada-en-equipo-categoria-permanente.md).

---

## 12. Nota de cierre (2026-06-10) — estado REAL implementado

> Esta sección refleja **lo que de verdad se construyó**, no el plan inicial. Donde el plan y la realidad difieren, manda esta nota.

**Modelo final (tras A6 CONTRACT)**:

- **`teams`**: gana `season` (`text`, `NOT NULL`, regex `^[0-9]{4}-[0-9]{2}$`) y `club_id` (`uuid`, `NOT NULL`, FK a `clubs`, denormalizado). `unique(club_id, name, season)` + índice `teams_club_season_idx`.
- **`categories`**: **sin `season` ni `order_idx`** (borradas en A6). Queda como **plantilla permanente**: `name + kind + half_duration_minutes`. Unicidad nueva `unique(club_id, lower(name))` (índice `categories_club_name_uniq`); índice viejo `categories_club_season_idx` eliminado. El orden de listado se deriva del `kind` (no es columna).
- **`players`**: gana `invite_email` (`text`, NULLABLE, check de formato). 🔒O2: **solo se persiste** desde el import; auto-envío/RGPD/destinatario son fase futura.
- **`events`**: sin cambios de columnas; la temporada de un evento se deriva por `event → team → teams.season`.

**Decisiones materializadas**:

- 🔒**O1** — `CATEGORY_KIND_ORDER` (+ `CATEGORY_KINDS`, `categoryKindOrdinal`) vive en `@misterfc/core`; la UI ordena las plantillas por `kind` (NULL al final, desempate por nombre, collation `es`).
- 🔒**O2** — columna `players.invite_email` (no se envía nada).
- 🔒**O3** — `/equipos` real (listado por temporada + alta = temporada+categoría+división+nombre) + `/equipos/plantillas` (crear/renombrar plantillas) + **redirect 308** `/categorias`→`/equipos` y `/categorias/[id]`→`/equipos/plantillas` (en `next.config.ts`). Nav "categorías"→"equipos".

**Ajustes vs. el plan de §5/§9 (importante)**:

1. **A1 tocó SOLO `teams`** (no `categories`). El plan inicial contemplaba ablandar `categories.season` antes; se movió a **A4** para no volver `categories.season` `string|null` y romper el typecheck de los ~14 lectores de display aún sin migrar. En su lugar A1 añadió el **trigger `teams_derive_from_category`** (BEFORE INSERT/UPDATE): deriva `club_id` **siempre** (denormalización autoritativa) y `season` por **fallback transicional** si llega `NULL` (la de la categoría) — así los writers y los 24 fixtures existentes seguían funcionando sin tocarlos.
2. **A4** ablandó `categories.season`/`order_idx` a **NULLABLE** (no las borró) para habilitar las categorías-plantilla sin romper CI; el **DROP** real es A6.
3. **A6 CONTRACT** dedujo categorías por `(club_id, lower(name))` (re-apuntando `teams`/`events`; con los datos reales **0 fusiones**), borró `season`/`order_idx`, creó la unicidad por nombre y **retiró el fallback de `season` del trigger** (la derivación de `club_id` se mantiene). Desde A6, un insert de team sin `season` falla por `NOT NULL` (correcto): la `season` la aporta siempre el flujo `/equipos`.

**Subfases / PRs**: A1 #80 · A2 #81 · A3 #82 · A4 #83 · A5 #84 · A6 #86. *(El #85 — A6 apilado sobre la rama de A5 — se cerró al borrarse su base en el merge de #84; se rehízo rebaseado a `main` como #86.)*

**Verificación**: cada PR con typecheck · lint · test · build en verde; `db:test` (pgTAP contra remoto) en verde tras A6 — `supabase/tests/categories_contract.sql` (unicidad case-insensitive, trigger deriva `club_id` pero ya no `season`, insert sin season → NOT NULL, dedup re-apunta `teams`/`events`) + 25 fixtures existentes ajustados al modelo nuevo.

**Fuera de alcance (futuro)**: season rollover / clonado de equipos-rosters entre temporadas; auto-envío real del `invite_email`.

---

> **Estado del documento**: ✅ **definitivo / cerrado (2026-06-10)**. **Todas las decisiones cerradas**: 🔒 D1–D4 (modelo/nav) y 🔒 O1 (kind→ordinal/NULL), 🔒 O2 (`players.invite_email`, solo guardar; RGPD/destinatario en fase futura), 🔒 O3 (`/equipos` real + redirect 308). Implementado con **EXPAND→MIGRATE→CONTRACT** (§5/§9), CI verde y F9 vivo en cada PR. Estado real implementado en **§12**.
