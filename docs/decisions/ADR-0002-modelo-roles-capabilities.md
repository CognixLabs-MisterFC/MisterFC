# ADR-0002 — Modelo de roles y capabilities configurables

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase + RLS), Fase 1 del Plan Maestro (implementación)

## Context

El fútbol base/amateur no encaja en jerarquías rígidas tipo SaaS profesional. La realidad operativa es:

- Un **club** agrupa varias **categorías** (Alevín, Infantil, Cadete, Juvenil…). Cada categoría tiene 1+ **equipos**.
- Cada equipo tiene un **entrenador principal** y normalmente uno o varios **ayudantes** con relaciones de confianza variables: el ayudante puede ser un padre, un excompañero, un estudiante de ciencias del deporte.
- El **coordinador** supervisa varios equipos pero no entrena.
- El **admin del club** gestiona altas/bajas y configuración general.
- Los **jugadores** son menores en su mayoría (RGPD aplica). Pueden tener **múltiples cuentas vinculadas**: la suya propia más una o varias cuentas de padres/tutores que reciben convocatorias, confirman asistencia y leen los reportes mensuales.

Un sistema rígido de roles fallaría en el caso del ayudante: en un equipo puede gestionar la pizarra y la asistencia, en otro solo puede consultar. Necesitamos **capabilities granulares** que el entrenador principal pueda activar/desactivar.

## Decision

Modelo de **5 roles base + capabilities configurables del ayudante**:

### Roles

| Rol | Scope | Descripción |
|---|---|---|
| `admin_club` | club | Gestión total del club: altas, configuración, facturación futura. |
| `coordinador` | club | Supervisa equipos del club. Sin permisos de edición sobre datos de juego. |
| `entrenador_principal` | equipo | Dueño del equipo. Puede asignar ayudantes y configurar sus capabilities. |
| `entrenador_ayudante` | equipo | Permisos definidos por capabilities, configuradas por el principal. |
| `jugador` | jugador | Acceso a su propio perfil. Las cuentas de padres se enlazan vía `player_accounts`. |

### Capabilities del ayudante

Booleans por (ayudante, equipo) configurados por el entrenador principal:

- `can_manage_attendance` — marcar asistencia y convocatorias.
- `can_manage_lineups` — editar alineaciones del partido.
- `can_record_match_data` — usar la pantalla de toma de datos en directo.
- `can_post_evaluations` — publicar valoraciones de partido/entrenamiento.
- `can_manage_calendar` — crear/editar eventos del equipo.
- `can_send_messages` — escribir en la mensajería del equipo.
- `can_view_only` — solo lectura. Por defecto `true`; los demás son opt-in.

### Cuentas múltiples por jugador

Tabla `player_accounts (player_id, account_id, relation)` donde `relation ∈ { 'self', 'parent', 'guardian' }`.

- Un jugador puede tener 0..1 cuenta `self` y 0..N cuentas `parent` / `guardian`.
- Las cuentas `parent` reciben push de convocatoria y pueden confirmar asistencia en nombre del jugador menor.
- RLS: una `account` solo ve los jugadores con los que está enlazada.

## Consequences

**Positivas**

- Refleja la realidad del fútbol base sin imponer una jerarquía artificial.
- El entrenador principal mantiene control sobre delegaciones — alinea con la responsabilidad real.
- Las cuentas múltiples resuelven el caso “padre confirma asistencia por el menor” sin hackeos.
- RLS expresable en Postgres con joins claros entre `accounts`, `players`, `player_accounts`, `team_members` y `coach_capabilities`.

**Negativas**

- Más complejidad de UI: el entrenador principal necesita una pantalla de configuración de capabilities por ayudante. Asumido en Fase 1.
- Las políticas RLS son más densas que un esquema “1 cuenta = 1 rol global”. Mitigación: helpers SQL (`STABLE` functions) para checks de capability + tests pgTAP exhaustivos en Fase 1.
- Riesgo MVCC con helpers `STABLE` en políticas de SELECT cuando se usan con `INSERT … RETURNING` (gotcha conocido). Mitigación: usar políticas row-aware o `SECURITY DEFINER` cuando aplique. Documentar en la spec de Fase 1.

**Neutras**

- `jugador` como rol es opcional en la base: niños pequeños pueden no tener cuenta propia; el padre opera por ellos hasta cierta edad.

## Alternatives considered

- **3 roles fijos sin capabilities** (`admin`, `coach`, `viewer`): muy simple pero no cubre el caso del ayudante con permisos variables. Descartado.
- **RBAC genérico con tabla `permissions` arbitraria**: máxima flexibilidad pero overkill para 7 capabilities conocidas, y UI de gestión más compleja. Descartado a favor del set fijo de booleans.
- **Una sola cuenta por jugador con un campo `manages_player_ids`**: no permite que el jugador menor *también* tenga su propia cuenta más adelante (cuando crezca) sin migrar datos. La tabla `player_accounts` lo resuelve naturalmente.
