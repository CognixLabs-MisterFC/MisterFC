-- F1B-2b — Los roles ALTOS (director/admin_club) se alcanzan SOLO por invitación,
-- NUNCA por cambio de rol (para NADIE, ni el owner).
--
-- Corrige la decisión de producto de F1B-2 (20260824): allí el owner podía fijar
-- a alguien A director/admin_club vía admin_update_staff_role. Ahora ese destino
-- se RECHAZA siempre (high_role_invite_only). El cambio de rol solo mueve entre
-- roles bajos (coordinador/entrenador_principal/entrenador_ayudante/jugador).
--
-- Se conserva TODO lo demás de F1B-2:
--   · Caller gestor: admin_club o director.
--   · DEGRADAR desde un rol alto (tocar a un director/admin) → SOLO owner
--     (potestad del owner; subir a alto por esta vía ya no existe).
--   · Owner (target) inmutable; guarda del último admin_club; validación de rol.
--
-- Copia fiel de la versión vigente (20260824) cambiando SOLO la regla de destino.

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
  v_caller_role  text;
  v_current_role text;
  v_admin_count  int;
  v_is_owner     boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Caller debe ser gestor del club: admin_club o director.
  select m.role into v_caller_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = v_uid;
  if v_caller_role is null or v_caller_role not in ('admin_club', 'director') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  v_is_owner := public.profile_is_club_owner(p_club_id, v_uid);

  -- El target debe ser miembro de ESE club (no se tocan membresías ajenas).
  select m.role into v_current_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = p_target_profile_id;
  if v_current_role is null then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  -- Rol destino dentro del conjunto válido (mismo CHECK de memberships.role: 6).
  if v_role is null or v_role not in (
    'admin_club', 'director', 'coordinador', 'entrenador_principal',
    'entrenador_ayudante', 'jugador'
  ) then
    raise exception 'role_invalid' using errcode = 'P0001';
  end if;

  -- El OWNER no puede ser degradado ni cambiado por nadie (ni por sí mismo).
  if public.profile_is_club_owner(p_club_id, p_target_profile_id) then
    raise exception 'owner_immutable' using errcode = 'P0001';
  end if;

  -- F1B-2b — el DESTINO nunca puede ser un rol ALTO: director/admin_club se
  -- asignan SOLO por invitación (para NADIE, ni el owner). Sin excepción.
  if public.membership_role_is_high(v_role) then
    raise exception 'high_role_invite_only' using errcode = 'P0001';
  end if;

  -- Cambiar DESDE un rol alto (degradar a un director/admin) → SOLO owner. Subir
  -- HACIA alto ya quedó rechazado arriba; aquí solo cubre la degradación.
  if public.membership_role_is_high(v_current_role) and not v_is_owner then
    raise exception 'forbidden_requires_owner' using errcode = 'P0001';
  end if;

  -- GUARDA: nunca dejar el club sin admin_club (igual que antes; sobre otro o uno mismo).
  if v_current_role = 'admin_club' and v_role <> 'admin_club' then
    select count(*) into v_admin_count
      from public.memberships m
     where m.club_id = p_club_id and m.role = 'admin_club';
    if v_admin_count <= 1 then
      raise exception 'would_remove_last_admin' using errcode = 'P0001';
    end if;
  end if;

  -- No-op explícito si no cambia.
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
  'F1B-2b — cambia el rol de club de un miembro entre roles BAJOS. El destino nunca '
  'puede ser director/admin_club (high_role_invite_only: los roles altos se asignan solo '
  'por invitación, ni el owner los fija por cambio de rol). Degradar a un director/admin '
  'sigue siendo potestad exclusiva del owner. Owner target inmutable; guarda del último '
  'admin_club. SECURITY DEFINER, solo la columna role.';
