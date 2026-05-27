# ADR-0002 — Modelo de roles y capabilities configurables

- **Status**: Accepted — implementado en Fase 1
- **Date**: 2026-05-27 (revisado tras Fase 1)
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase + RLS), Fase 1 del Plan Maestro (implementación), migraciones `20260527110831_schema_base.sql` … `20260527134819_fix_invitations_email_policy.sql`

## Context

El fútbol base/amateur no encaja en jerarquías rígidas tipo SaaS profesional. La realidad operativa es:

- Un **club** agrupa varias **categorías** (Alevín, Infantil, Cadete, Juvenil…). Cada categoría tiene 1+ **equipos**.
- Cada equipo tiene un **entrenador principal** y normalmente uno o varios **ayudantes** con relaciones de confianza variables: el ayudante puede ser un padre, un excompañero, un estudiante de ciencias del deporte.
- El **coordinador** supervisa varios equipos pero no entrena.
- El **admin del club** gestiona altas/bajas y configuración general.
- Los **jugadores** son menores en su mayoría (RGPD aplica). Pueden tener **múltiples cuentas vinculadas**: la suya propia más una o varias cuentas de padres/tutores que reciben convocatorias, confirman asistencia y leen los reportes mensuales.

Un sistema rígido de roles fallaría en el caso del ayudante: en un equipo puede gestionar la pizarra y la asistencia, en otro solo puede consultar. Necesitamos **capabilities granulares** que el entrenador principal pueda activar/desactivar.

## Decision

Modelo de **5 roles + capabilities configurables del ayudante**, con cuentas múltiples por jugador.

### Roles (tabla `memberships`)

`memberships(profile_id, club_id, role)` — `role` enumerado con CHECK.

| Rol | Scope | Descripción |
|---|---|---|
| `admin_club` | club | Gestión total del club: altas, configuración, invitaciones. |
| `coordinador` | club | Supervisa equipos del club. Puede gestionar categorías, equipos y plantilla; no es responsable directo de un equipo. |
| `entrenador_principal` | equipo | Dueño del equipo. Puede asignar ayudantes y configurar sus capabilities. Asignación al equipo concreto vía Fase 2 (UI staff). |
| `entrenador_ayudante` | equipo | Permisos definidos por capabilities, configuradas por el principal/coordinador/admin. |
| `jugador` | jugador | Cubre tanto al propio jugador adulto (`relation = self`) como a familias (`relation = parent` o `guardian`). Las cuentas se enlazan al jugador-ficha vía `player_accounts`. |

> **Decisión fusionada en Fase 1**: el rol `familia` se eliminó y se fusionó con `jugador`. Una cuenta familia es un `profile` con membership rol `jugador` vinculado al jugador-ficha vía `player_accounts.relation in ('parent','guardian')`. Argumento: simplifica el modelo, evita duplicar lógica de permisos, y permite a un padre ser también jugador (caso real en equipos amateur).

### Capabilities del ayudante (tabla `capabilities`)

`capabilities(membership_id, capability_name, granted bool)` — UNIQUE (membership_id, capability_name).

8 capabilities estándar (CHECK en la columna):

- `can_evaluate` — publicar valoraciones de partido/entrenamiento.
- `can_create_lineups` — crear/editar alineaciones.
- `can_register_match_events` — registrar eventos en la pantalla de toma de datos del partido.
- `can_create_sessions` — crear/editar sesiones de entrenamiento.
- `can_create_plays` — crear jugadas en la pizarra táctica.
- `can_see_medical` — leer las notas médicas de los jugadores (sensible).
- `can_message_families` — escribir a las cuentas familia.
- `can_manage_squad` — altas/bajas/dorsales en la plantilla.

**Trigger `ensure_assistant_capabilities`**: al crear o actualizar una membership con `role='entrenador_ayudante'`, se siembran automáticamente las 8 filas con `granted=false`. El principal/coordinador/admin las pone en `true` desde la UI (que llega en Fase 2).

**Helper SQL** `public.user_has_capability(membership_id, capability)` — usable desde policies y desde el server side.

### Cuentas múltiples por jugador (tabla `player_accounts`)

`player_accounts(player_id, profile_id, relation)` con `relation in ('self', 'parent', 'guardian')` y UNIQUE (player_id, profile_id).

- Un jugador puede tener 0..1 cuenta `self`, 0..N cuentas `parent`, 0..N `guardian`.
- Las cuentas `parent`/`guardian` reciben convocatorias y pueden confirmar asistencia en nombre del menor.
- RLS: una cuenta solo ve los `players` con los que está enlazada o los del club si tiene rol de staff.

### Implementación RLS

Helpers en schema `public` (no `auth`, porque `auth` es propiedad de `supabase_auth_admin` y no se nos permite crear funciones ahí):

```sql
public.user_role_in_club(p_club_id uuid) returns text         -- STABLE SECURITY DEFINER
public.user_has_capability_in_club(p_club_id, p_capability)   -- STABLE SECURITY DEFINER
public.user_has_capability(p_membership_id, p_capability)      -- STABLE SECURITY DEFINER
public.current_user_email() returns text                       -- SECURITY DEFINER, lee auth.users
```

`current_user_email()` apareció en una migración fix (`20260527134819`) tras detectar en los tests que el rol `authenticated` no tiene `SELECT` sobre `auth.users`. La policy de invitations leía directamente esa tabla → fallo. La función SECURITY DEFINER hace el lookup en nombre del caller.

### Bootstrap del primer admin

Para que el flow de `/onboarding` funcione sin un INSERT bypass:

- Policy `clubs_insert_first`: cualquier user autenticado **sin** memberships puede INSERT clubs.
- Policy `memberships_insert_bootstrap_or_admin`: tres ramas:
  1. Auto-insert `admin_club` para sí mismo si no tiene otras memberships.
  2. Auto-insert al aceptar una invitación cuyo email coincide con el del user (vía `current_user_email()`).
  3. Insert por admin/coordinador del club destino.

## Consequences

**Positivas**

- Refleja la realidad del fútbol base sin imponer una jerarquía artificial.
- El entrenador principal mantiene control sobre delegaciones — alinea con la responsabilidad real.
- Las cuentas múltiples resuelven el caso "padre confirma asistencia por el menor" sin hackeos.
- RLS expresable en Postgres con joins claros entre `memberships`, `players`, `player_accounts`, `team_members`, `capabilities`.
- Aislamiento multi-tenant verificado por tests SQL (`supabase/tests/rls_multi_tenant.sql`, 4 escenarios).

**Negativas**

- Más complejidad de UI: el entrenador principal necesita una pantalla de configuración de capabilities por ayudante (Fase 2).
- Las políticas RLS son más densas que un esquema "1 cuenta = 1 rol global". Mitigación: helpers SQL `STABLE` + tests en `supabase/tests/`.
- Riesgo MVCC con helpers `STABLE` en políticas de SELECT cuando se usan con `INSERT … RETURNING` (gotcha conocido). Mitigación: usar checks row-aware donde aplica (ver `memberships_insert_bootstrap_or_admin`).

**Neutras**

- `jugador` como rol es opcional en la base: menores pequeños sin cuenta propia operan vía cuentas `parent`/`guardian`.
- Granularidad por equipo del entrenador (`principal` vs `ayudante` en equipo X vs Y) se pospone a Fase 2: en 1.7 las policies tratan a todo `entrenador_principal` del club como con permisos sobre cualquier player del club. Aceptable mientras Fase 2 introduce la asignación staff↔equipo.

## Alternatives considered

- **3 roles fijos sin capabilities** (`admin`, `coach`, `viewer`): muy simple pero no cubre el caso del ayudante con permisos variables. Descartado.
- **RBAC genérico con tabla `permissions` arbitraria**: máxima flexibilidad pero overkill para 8 capabilities conocidas, y UI de gestión más compleja. Descartado a favor del set fijo de booleans.
- **Una sola cuenta por jugador con un campo `manages_player_ids`**: no permite que el jugador menor *también* tenga su propia cuenta más adelante (cuando crezca) sin migrar datos. La tabla `player_accounts` lo resuelve naturalmente.
- **Helpers en schema `auth`**: idea inicial. Descartado tras detectar en migración que Supabase no permite crear funciones ahí. Movidos a `public.`.
