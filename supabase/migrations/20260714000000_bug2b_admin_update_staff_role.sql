-- Bug 2 · 2b — el admin edita el ROL DE CLUB de un miembro (memberships.role).
--
-- El rol de club es sensible: gobierna permisos en TODO el club (admin_club ve y
-- gestiona todo; coordinador gestiona; entrenadores tienen alcance acotado). La
-- RLS memberships_update_admin ya permite a admin_club cambiar columnas, pero —
-- igual que 2a/2c — encapsulamos el cambio en una función SECURITY DEFINER
-- estrecha y gateada para (1) testear la regla en pgTAP a nivel DB y (2) imponer
-- una GUARDA que la RLS por sí sola no puede: nunca dejar el club sin admin_club.
--
-- admin_update_staff_role(club, target, new_role):
--   · exige auth.uid() = admin_club de p_club_id (solo admin_club),
--   · exige que el target sea miembro de p_club_id,
--   · valida new_role dentro del conjunto válido de roles de club (el mismo
--     CHECK de memberships.role: 5 roles),
--   · GUARDA del último admin: si el cambio degradaría al ÚNICO admin_club del
--     club (incluido degradarse uno mismo siendo el último), BLOQUEA con
--     would_remove_last_admin. La guarda se aplica igual sobre otro o sobre uno
--     mismo. Promover a un segundo admin y luego degradar al primero SÍ funciona.
--   · actualiza SOLO memberships.role de esa membership. Nunca auth.users,
--     profiles, ni otros campos.

create or replace function public.admin_update_staff_role(
  p_club_id           uuid,
  p_target_profile_id uuid,
  p_new_role          text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_role         text := nullif(btrim(p_new_role), '');
  v_current_role text;
  v_admin_count  int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo admin_club del club (el rol gobierna permisos: NADIE más lo toca).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club (no se tocan membresías ajenas).
  select m.role into v_current_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = p_target_profile_id;
  if v_current_role is null then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  -- Rol destino dentro del conjunto válido (mismo CHECK de memberships.role).
  if v_role is null or v_role not in (
    'admin_club', 'coordinador', 'entrenador_principal',
    'entrenador_ayudante', 'jugador'
  ) then
    raise exception 'role_invalid' using errcode = 'P0001';
  end if;

  -- GUARDA: nunca dejar el club sin admin_club. Solo aplica si el target ES
  -- admin_club hoy y el cambio lo degrada (new_role != admin_club). Si es el
  -- único admin del club, se bloquea (sea otro o uno mismo).
  if v_current_role = 'admin_club' and v_role <> 'admin_club' then
    select count(*) into v_admin_count
      from public.memberships m
     where m.club_id = p_club_id and m.role = 'admin_club';
    if v_admin_count <= 1 then
      raise exception 'would_remove_last_admin' using errcode = 'P0001';
    end if;
  end if;

  -- No-op explícito si no cambia (evita updated_at innecesario y revalidación).
  if v_role = v_current_role then
    return;
  end if;

  -- Solo el rol de ESA membership. Nunca auth, profiles ni otras columnas.
  update public.memberships
     set role = v_role
   where club_id = p_club_id and profile_id = p_target_profile_id;
end;
$$;

comment on function public.admin_update_staff_role(uuid, uuid, text) is
  'Bug 2 (2b) — el admin_club cambia el rol de club (memberships.role) de un miembro de su club. SECURITY DEFINER, solo admin_club, solo target del club, solo la columna role. GUARDA: nunca degradar al último admin_club del club (would_remove_last_admin), igual sobre otro o sobre uno mismo.';
