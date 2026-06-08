- **Status**: Accepted
- **Date**: 2026-06-08
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase como backend), ADR-0002 (modelo roles/capabilities), Fase 8 del Plan Maestro, `docs/specs/8.0-valoraciones.md` (§2 D5/D10, §5.3, §6.4)

# ADR-0014 — `club_settings`: configuración por club en tabla dedicada

## Context

F8 (valoraciones) introduce el **primer ajuste configurable por club**: la visibilidad de las valoraciones hacia jugadores y familias (`evaluations_player_visibility`, OFF por defecto — decisión D4/D5 de la spec 8.0). Es una **política de privacidad de todo el club**, que solo el admin del club puede cambiar (D10).

No es un ajuste aislado: se anticipan más preferencias por club en Olas próximas (políticas de notificación, política de reparto de minutos, ventanas de edición de partidos cerrados, idioma por defecto del club, etc.). La decisión de **dónde** vive la configuración por club marca el patrón para todas esas.

Opciones a comparar:

- **A** — **Columnas sueltas en `clubs`**. Cada ajuste es una columna nueva de la tabla núcleo. Sin JOIN extra.
- **B** — **Tabla dedicada `club_settings`** (1:1 con `clubs`, una columna por ajuste, fila *lazy*: sin fila = defaults).
- **C** — **JSONB `clubs.settings`** (un único blob de configuración).

## Decision

**Opción B — tabla dedicada `club_settings`**.

```sql
create table public.club_settings (
  club_id                       uuid primary key references public.clubs(id) on delete cascade,
  evaluations_player_visibility boolean not null default false,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
```

### Reglas del contrato

1. **Una fila por club, *lazy*.** La fila puede **no existir** para un club. Toda lectura sensible pasa por un helper `SECURITY DEFINER` que aplica `coalesce(..., <default>)` (p.ej. `club_evaluations_visible(club_id)` → `false` si no hay fila). No hace falta sembrarla en el alta del club; se crea al primer guardado desde la UI de ajustes.
2. **Una columna por ajuste, con su `CHECK`/`default` propios.** Cada preferencia nueva es un `ALTER TABLE public.club_settings ADD COLUMN ... default ...` — aditivo, sin downtime, y el generador de tipos de Supabase emite el tipo correcto por columna.
3. **Las lecturas de cara a usuarios no-admin van por helper definer, no por la RLS de `club_settings`.** La policy `SELECT` de `club_settings` se restringe a admin/coord (UI de ajustes); la visibilidad efectiva para jugador/familia se resuelve con `club_evaluations_visible(...)` (definer), para **no** acoplar la RLS de cada feature a `club_settings`.
4. **Escritura restringida por política, no por capability.** El flag de privacidad lo cambia solo `user_role_in_club = 'admin_club'` (D10). Otros ajustes futuros definirán su propia autoridad en su feature.

### Por qué NO la opción A (columnas en `clubs`)

- `clubs` es la tabla **núcleo multi-tenant** (identidad del club, FK desde casi todo el esquema). Mezclar **identidad** con **preferencias mutables** la ensucia y la hace caliente: cada ajuste nuevo es un `ALTER` sobre una tabla referenciada por todo.
- La RLS y los índices de `clubs` están afinados para el control de acceso del tenant; añadir columnas de configuración con sus propias necesidades de lectura (a veces públicas vía helper, a veces solo-admin) complica esa policy.

### Por qué NO la opción C (JSONB)

- Pierde el `CHECK`/tipado **por columna** y el autocompletado del generador de tipos (un `Json` opaco). Cada consumidor tendría que validar el shape por su cuenta y divergiría con el tiempo (mismo argumento que ADR-0007 contra `text` sin contrato fuerte).
- Versionar/migrar shape de un blob JSONB es más frágil que un `ADD COLUMN` con default.

## Consequences

### Positivas

- F8.5 y futuros ajustes por club crecen con `ADD COLUMN` aditivos sobre `club_settings`, sin tocar `clubs`.
- El patrón "helper `SECURITY DEFINER` + `coalesce(default)`" desacopla la RLS de cada feature de la tabla de settings y respeta privacidad por defecto.
- Tipos fuertes por ajuste; el cliente autocompleta cada flag.

### Negativas / coste asumido

- Un JOIN/subselect extra para leer la config (mitigado: las lecturas sensibles van por helper definer cacheable por query, y la tabla es 1 fila por club).
- Hay que recordar tratar "sin fila" como defaults en cada helper nuevo (el contrato lo fija como regla 1).

## Referencias

- spec `docs/specs/8.0-valoraciones.md` (§2 D5/D10, §5.3 modelo, §6.4 RLS).
- migración `supabase/migrations/20260622000000_evaluations.sql` (definición de `club_settings` + `club_evaluations_visible`).
