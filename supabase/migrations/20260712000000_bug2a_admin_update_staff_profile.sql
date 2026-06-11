-- Bug 2 · 2a — el admin puede editar el NOMBRE de un entrenador.
--
-- profiles.full_name es identidad del USUARIO (RLS profiles_update_self, self-only):
-- el admin no puede tocar el perfil de otro. Para corregir el nombre de un
-- entrenador de su club, una función SECURITY DEFINER estrecha y gateada — mismo
-- patrón que set_player_left_club / create_club_with_admin. NO se relaja
-- profiles_update_self (eso abriría que cualquier admin tocara cualquier perfil).
--
-- admin_update_staff_profile(club, target, full_name):
--   · exige auth.uid() = admin_club de p_club_id (solo admin_club, NO coordinador),
--   · exige que el target sea miembro de p_club_id,
--   · valida nombre no vacío (1..120),
--   · actualiza SOLO profiles.full_name (nada de auth, email ni otros campos).
-- Decisión: el nombre es GLOBAL del usuario (sin override por club).

create or replace function public.admin_update_staff_profile(
  p_club_id           uuid,
  p_target_profile_id uuid,
  p_full_name         text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(p_full_name), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo admin_club del club (coordinador NO: la identidad es más sensible).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club (no se pueden tocar perfiles ajenos).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = p_target_profile_id
  ) then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  if v_name is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'name_too_long' using errcode = 'P0001';
  end if;

  -- Solo el nombre. Nunca auth.users, email, locale ni otros campos.
  update public.profiles
     set full_name = v_name, updated_at = now()
   where id = p_target_profile_id;
end;
$$;

comment on function public.admin_update_staff_profile(uuid, uuid, text) is
  'Bug 2 (2a) — el admin_club corrige el full_name de un miembro de su club (nombre global). SECURITY DEFINER, solo admin_club, solo target del club, solo el campo full_name. No relaja profiles_update_self.';
