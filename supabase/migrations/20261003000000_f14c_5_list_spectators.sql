-- F14C-5 — LISTADO de seguidores de un jugador (con identidad).
--
-- Las RPCs de F14C-2 (invite_spectator/remove_spectator) ya cubren invitar y
-- revocar. Falta LISTAR los seguidores actuales con nombre+email para la UI de
-- gestión del tutor/jugador. No se puede hacer solo con RLS: el tutor ve las
-- filas de player_spectators (F14C-1) pero NO la identidad del seguidor —
-- `profiles_select_clubmate` exige mismo club y el seguidor no tiene club, y
-- `authenticated` no puede SELECT sobre auth.users. Por eso una RPC SECURITY
-- DEFINER con el MISMO gate que invite/remove (tutor del jugador O el propio
-- jugador self) que une player_spectators ⋈ profiles ⋈ auth.users.
--
-- Sin cambios de acceso: solo LECTURA de identidad, y solo para quien ya podía
-- invitar/revocar. No abre nada nuevo.

create or replace function public.list_player_spectators(p_player_id uuid)
returns table (
  spectator_profile_id uuid,
  full_name text,
  email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate IDÉNTICO a invite_spectator/remove_spectator: SOLO el tutor del jugador
  -- o el propio jugador (self). Nadie más (ni admin, ni otro seguidor).
  if not (
    public.user_is_tutor_of_player(p_player_id)
    or exists (
      select 1 from public.player_accounts pa
      where pa.player_id = p_player_id
        and pa.profile_id = v_uid
        and pa.relation = 'self'
    )
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    ps.spectator_profile_id,
    pr.full_name,
    au.email::text,
    ps.created_at
  from public.player_spectators ps
  left join public.profiles pr on pr.id = ps.spectator_profile_id
  left join auth.users au on au.id = ps.spectator_profile_id
  where ps.player_id = p_player_id
  order by ps.created_at asc;
end;
$$;

comment on function public.list_player_spectators(uuid) is
  'F14C-5 — Lista los seguidores ACEPTADOS de un jugador (player_spectators) con '
  'identidad (full_name de profiles, email de auth.users). Gate: tutor del jugador '
  'O el propio jugador (self), idéntico a invite_spectator/remove_spectator. '
  'SECURITY DEFINER porque el tutor no puede leer por RLS el profile/email de un '
  'seguidor sin club. Solo lectura; no abre acceso nuevo.';

revoke all on function public.list_player_spectators(uuid) from public;
grant execute on function public.list_player_spectators(uuid) to authenticated;
