-- ─────────────────────────────────────────────────────────────────────────────
-- F14E-4 (Opción A) — RPC set_session_shared: compartir/descompartir una sesión
-- con los jugadores del equipo.
--
-- NO se añade columna nueva ni se toca la RLS de LECTURA: el flag de compartido
-- SIGUE siendo `sessions.visibility` ('staff' = no compartida / 'team' = compartida),
-- que ya expone la sesión al jugador/familia del equipo (user_is_team_member_account,
-- 20260716000000) sin ninguna condición de convocatoria.
--
-- Lo ÚNICO que aporta este RPC es AMPLIAR el gate de "compartir" respecto al UPDATE
-- directo (sessions_update = user_can_create_sessions AND (owner ∪ admin ∪ staff-del-
-- equipo)): aquí basta con ser STAFF del equipo de la sesión (principal o AYUDANTE,
-- sin necesitar la capability de creación) o admin_club/director/superadmin. Así el
-- ayudante puede compartir aunque no pueda editar el contenido, y el director también.
--
-- SECURITY DEFINER + search_path fijo. El gate se comprueba dentro; el UPDATE
-- salta la RLS de UPDATE (por eso el gate es explícito). revoke public / grant
-- authenticated.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_session_shared(p_session_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id     uuid;
  v_club_id     uuid;
  v_is_template boolean;
begin
  select team_id, club_id, is_template
    into v_team_id, v_club_id, v_is_template
  from public.sessions
  where id = p_session_id;

  -- Sesión inexistente → not_found (no se filtra existencia a no autorizados: el
  -- gate va después, pero sin fila no hay nada que compartir).
  if v_club_id is null then
    raise exception 'session_not_found' using errcode = 'no_data_found';
  end if;

  -- Las plantillas (team_id NULL) no se comparten: siempre visibility='staff'
  -- (constraint sessions_template_staff_chk). Compartir una plantilla no tiene
  -- destinatarios → forbidden.
  if v_is_template then
    raise exception 'template_not_shareable' using errcode = 'insufficient_privilege';
  end if;

  -- Gate AMPLIADO: staff del equipo de la sesión (principal/ayudante activo) ∪
  -- admin_club/director del club ∪ superadmin de plataforma.
  if not (
    public.user_is_staff_of_team(v_team_id)
    or public.user_role_in_club(v_club_id) = any (array['admin_club', 'director'])
    or public.is_superadmin()
  ) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  update public.sessions
     set visibility = case when p_shared then 'team' else 'staff' end
   where id = p_session_id;
end;
$$;

comment on function public.set_session_shared(uuid, boolean) is
  'F14E-4 — Comparte (p_shared=true → visibility=team) o descomparte (false → staff) '
  'una sesión con los jugadores/familias de su equipo. Gate ampliado: staff del equipo '
  '(principal/ayudante) ∪ admin_club/director ∪ superadmin. NO cambia la RLS de lectura.';

revoke all on function public.set_session_shared(uuid, boolean) from public;
grant execute on function public.set_session_shared(uuid, boolean) to authenticated;
