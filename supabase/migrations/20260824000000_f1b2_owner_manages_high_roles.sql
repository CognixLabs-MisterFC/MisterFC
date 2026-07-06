-- F1B-2 — La gestión de roles ALTOS (director / admin_club) es EXCLUSIVA del owner.
--
-- PRINCIPIO: 1 admin único = el OWNER (clubs.owner_profile_id, F1B-0). director =
-- admin en todo (datos, F1B-1) SALVO crear/gestionar directores y admins. Esta
-- pieza cierra exactamente esa excepción (el Grupo B, que F1B-1 dejó intacto).
--
-- REGLAS:
--   · Rol ALTO = ('admin_club','director'). Invitar con un rol alto, fijar el rol
--     de alguien A un rol alto, o cambiar/eliminar la membership DE un rol alto →
--     SOLO el owner (user_is_club_owner).
--   · Roles BAJOS (coordinador/entrenador_*/jugador) → un director los gestiona
--     igual que un admin (director = admin en gestión de roles bajos).
--   · El OWNER nunca es degradable ni eliminable por nadie (protección añadida a
--     la del "último admin", que se mantiene).
--
-- Aislamiento entre clubs (user_role_in_club) NO se toca. El barrido de datos de
-- F1B-1 NO se toca (director conserva su paridad de datos). SELECT de chats/
-- partidos (F5B/F7B) NO se toca. capabilities_* NO asignan roles de club (solo
-- abilities de ayudantes) → sin cambios.

-- ═════════════════════════════════════════════════════════════════════════════
-- 0. HELPERS
-- ═════════════════════════════════════════════════════════════════════════════

-- ¿Es 'role' un rol ALTO (admin_club/director)?
create or replace function public.membership_role_is_high(p_role text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_role in ('admin_club', 'director');
$$;

comment on function public.membership_role_is_high(text) is
  'F1B-2 — TRUE si el rol de club es "alto" (admin_club o director), cuya gestión '
  'es exclusiva del owner.';

grant execute on function public.membership_role_is_high(text) to authenticated;

-- ¿Es p_profile_id el owner del club p_club_id? (para proteger/gatear al owner
-- y a las memberships de rol alto; filtra por club_id, aislamiento).
create or replace function public.profile_is_club_owner(p_club_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clubs c
    where c.id = p_club_id
      and p_profile_id is not null
      and c.owner_profile_id = p_profile_id
  );
$$;

comment on function public.profile_is_club_owner(uuid, uuid) is
  'F1B-2 — TRUE si el profile indicado es el owner del club. Distinto de '
  'user_is_club_owner (que mira auth.uid()): aquí se comprueba un TARGET.';

grant execute on function public.profile_is_club_owner(uuid, uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. INVITACIONES — crear con rol alto → solo owner; rol bajo → admin/director/coord.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1.0 invitations.role: añadir 'director' al CHECK (F1B-0 solo tocó memberships.role;
--     sin esto no se puede invitar a un director). Copia fiel del CHECK original + 'director'.
alter table public.invitations
  drop constraint if exists invitations_role_check;
alter table public.invitations
  add constraint invitations_role_check check (role in (
    'admin_club',
    'director',
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador'
  ));

drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin on public.invitations
  for insert to authenticated
  with check (
    case
      when public.membership_role_is_high(role)
        then public.user_is_club_owner(club_id)
      else public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
    end
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. MEMBERSHIPS — insert manual / update / delete con gate de rol alto + owner.
-- ═════════════════════════════════════════════════════════════════════════════

-- 2.1 INSERT — bootstrap y aceptación de invitación INTACTOS (copia fiel); solo
--     se endurece la rama manual: rol alto → owner; rol bajo → admin/director/coord.
drop policy if exists memberships_insert_bootstrap_or_admin on public.memberships;
create policy memberships_insert_bootstrap_or_admin on public.memberships
  for insert to authenticated
  with check (
    (
      profile_id = auth.uid()
      and role = 'admin_club'
      and not exists (
        select 1 from public.memberships m where m.profile_id = auth.uid()
      )
    )
    or
    (
      -- Aceptación de invitación: el user se autoinserta porque la invitación
      -- ya fue creada por admin/coord. Verificación de email match va en la
      -- server action (SECURITY: la lectura del email exige RLS sobre invitations
      -- que también validamos abajo).
      profile_id = auth.uid()
      and exists (
        select 1 from public.invitations i
        where i.email ilike (select email from auth.users where id = auth.uid())
          and i.club_id = memberships.club_id
          and i.role = memberships.role
          and i.accepted_at is null
          and i.expires_at > now()
      )
    )
    or
    (
      -- Inserción manual: rol alto (admin_club/director) → SOLO owner; rol bajo
      -- → admin/director/coord (director = admin en gestión de roles bajos).
      case
        when public.membership_role_is_high(role)
          then public.user_is_club_owner(club_id)
        else public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
      end
    )
  );

-- 2.2 UPDATE — editar/degradar una membership de rol alto → owner; el owner nunca
--     editable; rol bajo → admin/director/coord.
drop policy if exists memberships_update_admin on public.memberships;
create policy memberships_update_admin on public.memberships
  for update to authenticated
  using (
    not public.profile_is_club_owner(club_id, profile_id)
    and (
      case
        when public.membership_role_is_high(role)
          then public.user_is_club_owner(club_id)
        else public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
      end
    )
  )
  with check (
    not public.profile_is_club_owner(club_id, profile_id)
    and (
      case
        when public.membership_role_is_high(role)
          then public.user_is_club_owner(club_id)
        else public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
      end
    )
  );

-- 2.3 DELETE — eliminar una membership de rol alto → owner; el owner nunca
--     eliminable; rol bajo → admin/director.
drop policy if exists memberships_delete_admin on public.memberships;
create policy memberships_delete_admin on public.memberships
  for delete to authenticated
  using (
    not public.profile_is_club_owner(club_id, profile_id)
    and (
      case
        when public.membership_role_is_high(role)
          then public.user_is_club_owner(club_id)
        else public.user_role_in_club(club_id) in ('admin_club', 'director')
      end
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. RPC admin_update_staff_role — reescrito con jerarquía de owner.
-- ═════════════════════════════════════════════════════════════════════════════
--   · Caller gestor: admin_club o director (paridad en roles bajos; coordinador
--     NO gestiona roles vía este RPC, como hoy).
--   · Fijar A un rol alto, o cambiar DESDE un rol alto → solo owner.
--   · El OWNER (target) nunca se cambia (owner_immutable).
--   · Se mantiene la guarda del último admin_club (would_remove_last_admin).
--   · new_role válido ahora incluye 'director'.
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

  -- Gestionar roles ALTOS (fijar A, o cambiar DESDE, admin_club/director) → owner.
  if (public.membership_role_is_high(v_role) or public.membership_role_is_high(v_current_role))
     and not v_is_owner then
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
  'F1B-2 — cambia el rol de club de un miembro. Caller admin_club/director; gestionar '
  'roles altos (admin_club/director: fijar A o cambiar DESDE) es exclusivo del owner; '
  'el owner (target) es inmutable; guarda del último admin_club. SECURITY DEFINER, solo '
  'la columna role.';
