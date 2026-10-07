-- user_is_principal_of_team mira la BAJA, como sus dos hermanos.
--
-- EL HUECO, anotado al cerrar #761 y decidido por Jose el 2026-10-07: de los tres
-- predicados de «qué eres en este equipo», dos comprueban que la membresía del club siga
-- viva y uno no.
--
--   user_coordinates_team   … ts.left_at is null and m.profile_id = auth.uid() and m.left_at is null
--   user_is_staff_of_team   … ts.left_at is null and m.profile_id = auth.uid() and m.left_at is null
--   user_is_principal_of_team … ts.left_at is null and m.profile_id = auth.uid()          ← FALTA
--
-- Qué significaba: alguien con la membresía del club CERRADA pero con su fila de
-- `team_staff` todavía abierta seguía siendo «principal» para la RLS. Un despedido con la
-- asignación colgando.
--
-- POR QUE NO BASTABA EL INVARIANTE. La baja pasa por `set_membership_left`
-- (20261053000000), que cierra las `team_staff` activas del target, así que en el camino
-- normal no hay colgantes. Lo que NO cubre es un `update memberships set left_at` A MANO,
-- y es justo como se cierran hoy las membresías: NINGÚN trigger de `memberships` vigila el
-- UPDATE (los dos que hay miran INSERT y DELETE). Es decir, el invariante lo sostiene una
-- RPC, no el motor; y un predicado de seguridad no debe apoyarse en que nadie escriba por
-- el otro lado.
--
-- EFECTO MEDIDO EN PRODUCCION (2026-10-07, antes de aplicar): **cero**. 5 asignaciones
-- activas, 2 de ellas de principal, 7 membresías de baja y **0 colgantes** —ni uno, ni de
-- principal ni de ningún rol—. Esto es endurecimiento LATENTE: no cambia lo que ve nadie
-- hoy, cierra lo que podría pasar mañana. Si hubiera habido colgantes, esto habría
-- retirado permisos a alguien y habría ido con aviso, no de callada.
--
-- QUIEN LO USA, censado en producción: TRES políticas y NINGUNA función.
--   · announcements_update_author_or_manager  (UPDATE, #761)
--   · announcements_delete_author_or_manager  (DELETE, #761)
--   · invitations_select_admin_or_invited     (SELECT)
--
-- Y lo que pierde un principal de baja en esa tercera, que es la única que no nace de
-- ayer: SOLO la cuarta rama. La política es
--
--   user_role_in_club(club_id) in ('admin_club','director')
--   or email ilike current_user_email()
--   or created_by = auth.uid()
--   or (team_id is not null and user_is_principal_of_team(team_id))
--
-- así que sigue viendo las invitaciones que él creó y las dirigidas a su propio correo. No
-- se queda ciego: deja de ver las de un equipo que ya no dirige.
--
-- COPIA FIEL: la definición sale de `pg_get_functiondef` de producción (leída el
-- 2026-10-07) y lo único que cambia es la línea `and m.left_at is null`. Firma, tipo de
-- retorno, STABLE, SECURITY DEFINER y `search_path` quedan idénticos — cambiar cualquiera
-- de esos en un `create or replace` es la forma silenciosa de romper tres políticas a la
-- vez (lección F1B, known-issues).
--
-- Suite: supabase/tests/principal_de_baja_no_manda.sql

create or replace function public.user_is_principal_of_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_staff ts
    join public.memberships m on m.id = ts.membership_id
    where ts.team_id = p_team_id
      and ts.left_at is null
      and ts.staff_role = 'entrenador_principal'
      and m.profile_id = auth.uid()
      -- La baja del club manda sobre la asignación al equipo. Igual que en
      -- user_coordinates_team y user_is_staff_of_team.
      and m.left_at is null
  );
$$;

comment on function public.user_is_principal_of_team(uuid) is
  'True si el user actual es entrenador PRINCIPAL del equipo indicado, con la asignacion '
  'team_staff abierta Y la membresia del club viva (left_at is null). Esa segunda '
  'condicion se anadio el 2026-10-07: faltaba, al contrario que en user_coordinates_team y '
  'user_is_staff_of_team, y un despedido con la asignacion colgando seguia mandando. La '
  'usan invitations_select_admin_or_invited y las dos de announcements (UPDATE/DELETE).';
