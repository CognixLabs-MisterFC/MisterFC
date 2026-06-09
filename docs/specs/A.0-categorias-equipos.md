# Spec A.0 — Rework A: categorías ↔ equipos (la temporada vive en el EQUIPO)

> Tipo: **REWORK** (no es una fase del Plan Maestro; reestructura modelo + UI ya existentes de F2/F3).
> Estado: ☐ **borrador para revisión del responsable** (esperando OK antes de implementar). **Nada de código ni migraciones se ha creado con esta spec.**
> Autor: Iker Milla · Fecha: 2026-06-09
> Depende de: F2 (categories/teams/team_members/players, import), F3 (events), F7.6c (substitution_regimes, categories.kind, teams.division), F9 (fichas que filtran por temporada).
> ADR asociado (propuesto): **ADR-0017 — Temporada en el equipo; categoría como plantilla permanente** (§11).

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

- **🔒 D1 — Categoría = plantilla permanente** (`name + kind + half_duration_minutes`). **Sin `season` ni `order_idx`**. El **orden de listado se deriva del `kind`** (edad). Ver §3.1 (mapa `kind→ordinal` y manejo de `kind = NULL`) — el mapa concreto queda como ❓ a confirmar.
- **🔒 D2 — Equipo por temporada**: `teams.season` (regex `^[0-9]{4}-[0-9]{2}$`). Mismo nombre en distinta temporada = equipos distintos, con su propio roster (`team_members`). Crear equipo = temporada + categoría + división + nombre.
- **🔒 D3 — Unicidad de equipo**: `unique (club_id, name, season)` (no dos equipos con el mismo nombre en el mismo club y temporada). Implica **denormalizar `club_id` en `teams`** (§3.2) — la constraint no puede mirar la `club_id` de la categoría sin trigger/columna generada.
- **🔒 D4 — Navegación en torno al equipo**: nuevo `/equipos` (listado por temporada; alta = temporada + categoría + división + nombre) + pantalla simple de **categorías-plantilla** (crear/renombrar, sin season ni orden). Nav `categorias → equipos`. Reparto de rutas en §6. Roles `admin_club` + `coordinador`.

### ❓ Abiertas (recomendación; las cierra el responsable)

- **❓ A1 — Mapa `kind → ordinal` y el `NULL`** (D1). **Recomendación**: `querubin 1, prebenjamin 2, benjamin 3, alevin 4, infantil 5, cadete 6, juvenil 7, amateur 8, senior 9, veterano 10`; `kind = NULL` → ordinal `99` (al final), desempate por `name` (collation `es`, case-insensitive). Vivirá como constante en `@misterfc/core` (`CATEGORY_KIND_ORDER`), reutilizable por UI y, si hiciera falta, por una columna generada.
- **❓ A2 — Dónde persiste el email del import** (no hay columna hoy). Opciones: (a) **`players.email`** (columna nullable nueva) — dato de contacto durable del jugador; (b) fila en `invitations` (ya existe esa tabla con `email/player_relation/expires_at`) creada en el import. **Recomendación: (a) `players.email`** ahora (solo guardar; **sin enviar nada**), y que el futuro auto-envío (fase posterior) **lea** ese email para crear la `invitation`. Es el cambio mínimo y no acopla el import al flujo de invitaciones.
- **❓ A3 — Reestructura de rutas** (D4). **Recomendación**: crear `/equipos` (listado+alta) y `/equipos/plantillas` (o `/categorias` **reconvertida** a "categorías-plantilla", sin season/orden); **redirect 308 `/categorias → /equipos`**; conservar `/equipos/[teamId]` y `/categorias/[categoryId]` (este último puede quedar como detalle de plantilla o redirigir). **Alternativa**: mantener la ruta física `/categorias` y solo cambiar la etiqueta i18n del nav a "Equipos" + reordenar contenido (menos churn, URLs menos coherentes). Recomiendo la reestructura real con redirect.

---

## 3. Modelo final (DDL propuesto — NO crear aún)

### 3.1 `categories` (plantilla permanente)

```sql
-- quita la temporada y el orden manual; la categoría es permanente por club.
alter table public.categories drop column season;       -- (tras migrar season a teams, §5)
alter table public.categories drop column order_idx;     -- el orden se deriva de kind
drop index if exists categories_club_season_idx;
-- nueva unicidad de plantilla: un nombre de categoría por club (normalizado).
create unique index categories_club_name_uniq
  on public.categories (club_id, lower(name));
comment on table public.categories is
  'Plantilla permanente de categoría del club (name + kind + half_duration_minutes). NO tiene temporada: la temporada vive en teams.season. El orden de listado se deriva de kind (CATEGORY_KIND_ORDER).';
```

Orden de listado (no es columna; se calcula en lectura): por `CATEGORY_KIND_ORDER[kind]` (❓ A1), `NULL` al final, desempate por `name`.

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
-- ❓ A2 (recomendado): contacto del jugador para el futuro auto-envío.
alter table public.players add column email text
  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
```

---

## 4. Antes → después (de un vistazo)

| Aspecto | Hoy | Tras el rework |
|---|---|---|
| Temporada | `categories.season` | **`teams.season`** |
| Categoría | fila por (club, nombre, **temporada**) | **plantilla permanente** por (club, nombre) — `name + kind + half_duration_minutes` |
| Orden de categorías | `order_idx` manual | **derivado de `kind`** (edad) — ❓A1 |
| Equipo | hereda temporada de su categoría | **instancia por temporada** (mismo nombre = equipos distintos por año) |
| Unicidad de equipo | (implícita por categoría) | **`unique(club_id, name, season)`** (+ `club_id` denormalizado) — D3 |
| Crear equipo | dentro de `/categorias/[id]` (name+format+division) | en `/equipos` (**temporada + categoría + división + nombre**) |
| Nav | "Categorías" → `/categorias` | **"Equipos" → `/equipos`** + pantalla de plantillas |
| Régimen / duración | `kind`+`division` / `half_duration` | **sin cambios** |
| Import | equipo único de lote | **equipo por fila** (+ fallback de lote) + **columna email** |

---

## 5. Plan de migración (por pasos — propuesto, NO crear aún)

Todo en **una migración nueva** (sin editar las aplicadas), idempotente y robusta para el caso general aunque hoy los datos sean mínimos (2 categorías de una sola temporada → 0 fusiones reales).

1. **`teams.season` + `teams.club_id`** (nullable de inicio).
2. **Backfill** desde la categoría actual:
   ```sql
   update public.teams t
      set season  = c.season,
          club_id = c.club_id
     from public.categories c
    where c.id = t.category_id;
   ```
3. **Deduplicar categorías** (fusionar las que solo difieren por temporada). Para cada `(club_id, lower(name))` se elige una **superviviente** (la de menor `created_at`); se re-apunta `teams.category_id` y `events.category_id` a la superviviente; se conservan `kind`/`half_duration_minutes` (que no dependen de temporada y son iguales por nombre). Esquema:
   ```sql
   with ranked as (
     select id, club_id, lower(name) as norm,
            row_number() over (partition by club_id, lower(name)
                               order by created_at, id) as rn,
            first_value(id) over (partition by club_id, lower(name)
                                  order by created_at, id) as keeper
       from public.categories
   )
   -- 3a. re-apuntar teams y events a la superviviente
   update public.teams t set category_id = r.keeper
     from ranked r where t.category_id = r.id and r.rn > 1;
   update public.events e set category_id = r.keeper
     from ranked r where e.category_id = r.id and r.rn > 1;
   -- 3b. borrar las categorías duplicadas (rn > 1)
   delete from public.categories c using ranked r
     where c.id = r.id and r.rn > 1;
   ```
   *(Con los datos actuales no fusiona nada; queda escrita para el caso general.)*
4. **Endurecer `teams`**: `season`/`club_id` → NOT NULL + checks + FK + `unique(club_id, name, season)` + índice `teams_club_season_idx`.
5. **Quitar de `categories`**: `season`, `order_idx`, `categories_club_season_idx`, y actualizar el comentario de tabla. Añadir `categories_club_name_uniq`.
6. **(❓ A2)** `players.email` (si se aprueba).
7. **Verificación post-migración** (en el spec, no automatizable): `events.category_id` sigue apuntando a categorías vivas; ningún `team` sin `season`/`club_id`; ninguna colisión de la nueva unicidad.

**pgTAP** (al implementar): unicidad de equipo `(club, name, season)`; categoría sin season; la temporada de un partido se deriva por `team.season`; régimen intacto.

---

## 6. Plan de /equipos + categorías-plantilla (D4)

| Ruta | Hoy | Tras el rework |
|---|---|---|
| `/categorias` | lista categorías por temporada + alta | **redirect 308 → `/equipos`** |
| `/equipos` | — (no existe raíz) | **NUEVO**: listado de equipos **agrupado/filtrado por temporada** (selector de temporada, default la más reciente); alta = **temporada + categoría + división + nombre** (reusa la validación de división contra `substitution_regimes`) |
| `/equipos/plantillas` (o `/categorias` reconvertida) | — | **NUEVO/ADAPTADO**: gestión de **categorías-plantilla** (crear/renombrar; `kind`/`half_duration`; **sin season ni orden**) |
| `/categorias/[categoryId]` | gestiona equipos de la categoría | detalle de plantilla (o redirect a `/equipos?categoria=`) |
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
2. **Columna de EMAIL** (preparada, sin enviar nada): `email` en columnas + aliases (`email`, `correo`, `e-mail`) + validación (regex). Persistencia según **❓ A2** (recomendado `players.email`).
3. **Fuera de alcance aquí**: el auto-envío real de la invitación por email (fase posterior; leerá `players.email` para crear la `invitation`).

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

## 9. Subfases (troceado, estimación y orden)

| Subfase | Alcance | Est. |
|---|---|---|
| **A1** | **Migración del modelo** (§5): `teams.season`+`club_id` con backfill, dedup de categorías, endurecer constraints (D3), quitar `categories.season`/`order_idx`, (❓A2) `players.email`. + pgTAP. Regenerar `database.ts`. | 3–4 h |
| **A2** | **F9 a `team.season` (CRÍTICO)**: los 6 filtros + selectores de temporada de `jugadores/[playerId]` y `mi-ficha`. Smoke de las dos fichas. *(Va inmediatamente tras A1 para no dejar F9 roto.)* | 2–3 h |
| **A3** | **Ripple de display/DTO** (~14 puntos §8): cambio mecánico a `teams.season` en listados/cabeceras. | 2–3 h |
| **A4** | **`/equipos` + categorías-plantilla** (§6): listado por temporada + alta (temporada+categoría+división+nombre), pantalla de plantillas (crear/renombrar), nav "Equipos", redirect `/categorias`. Orden de categorías por `kind` (❓A1). i18n. | 4–6 h |
| **A5** | **Import por equipo + email** (§7): columna de equipo por fila (resolución nombre→team_id) + columna email; selector de lote como fallback. Tests de `@misterfc/core/import`. | 3–4 h |

**Orden**: A1 → **A2** (cerrar F9 ya) → A3 → A4 → A5. **Total** ≈ 14–20 h.

---

## 10. Fuera de alcance (explícito)

- **Season rollover / clonar equipos-rosters** de una temporada a la siguiente (crear los equipos de 2026-27 copiando los de 2025-26 con su plantilla): **futuro**, su propia mini-spec.
- **Auto-envío real del email** de invitación desde el import: **fase posterior** (este rework solo **guarda** el email y deja la columna/alias listos).
- **Histórico/versionado de plantillas** de categoría (renombrar una categoría afecta a todos sus equipos de todas las temporadas): se asume aceptable; no se versiona.

---

## 11. ADR candidato

- **ADR-0017 — Temporada en el equipo; categoría como plantilla permanente** (siguiente nº libre; último en main es ADR-0016). Decisión con impacto estructural duradero: invierte la relación temporada↔(categoría/equipo) de F2, denormaliza `club_id` en `teams` para la unicidad (D3), y reorienta la navegación al equipo (D4). Escribir al implementar A1.

---

> **Estado del documento**: ☐ borrador para revisión. Decisiones **🔒 D1–D4 cerradas**; **❓ A1 (kind→ordinal/NULL), A2 (persistencia del email), A3 (reestructura de rutas)** abiertas con recomendación. Nada de código ni migraciones creado con esta spec.
