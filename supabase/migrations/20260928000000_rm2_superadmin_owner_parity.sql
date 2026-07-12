-- RM-2 — SUPERADMIN = OWNER en cualquier club (paridad-owner completa).
--
-- MODELO (regla dura de Jose): el superadmin entra a cada club como su admin/owner,
-- con las MISMAS funcionalidades que el owner (invitar directores, subir documentos
-- legales, gestionar staff de alto rango, etc.). Hoy el chokepoint (F14B-2) le da
-- role='admin_club' (user_role_in_club) pero user_is_club_owner NO lo reconoce → no
-- puede hacer lo que exige owner. Esta migración le da paridad-owner en TODOS los
-- clubs, SIN debilitar la protección del owner REAL.
--
-- DOS TIPOS DE GATE DE OWNER (clave del diseño):
--   · CALLER  "¿el usuario ACTUAL puede hacer X de owner?"  → user_is_club_owner(club)
--     y el v_is_owner de admin_update_staff_role. Estos SÍ reconocen al superadmin.
--   · TARGET  "¿este profile ES el owner (para protegerlo)?" → profile_is_club_owner(
--     club, profile). Este NO se toca: su función es blindar al owner real de ser
--     degradado/eliminado, y el superadmin NO es ese profile.
--
-- ALCANCE:
--   1. user_is_club_owner: añade la rama superadmin (owner virtual). Consumidores
--      (RLS): invitations_insert_admin [rol alto], memberships_insert/update/delete
--      [rol alto] → el superadmin gana paridad ahí automáticamente.
--   2. admin_update_staff_role: el v_is_owner (gate CALLER) pasa a user_is_club_owner
--      (ya superadmin-aware) en lugar de profile_is_club_owner(caller). El guard
--      owner_immutable (TARGET, línea profile_is_club_owner(p_target_profile_id)) y
--      el resto quedan IDÉNTICOS → el owner real sigue intocable.
-- NO se toca profile_is_club_owner, ni las policies de memberships, ni el trigger de
-- owner (F14B-5b), ni RM-1 (índice de admin único).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. user_is_club_owner: el superadmin es "owner virtual" de cualquier club.
--    Copia FIEL de la def viva (F1B-0): language sql, STABLE, SECURITY DEFINER,
--    search_path=public. Se AÑADE solo la rama is_superadmin() al OR (equivalente
--    en SQL a "if is_superadmin() then return true").
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_is_club_owner(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- RM-2: un superadmin de plataforma actúa como owner en CUALQUIER club.
  select public.is_superadmin() or exists (
    select 1
    from public.clubs c
    where c.id = p_club_id
      and c.owner_profile_id = auth.uid()
  );
$$;

comment on function public.user_is_club_owner(uuid) is
  'True si el user actual (auth.uid()) es el owner del club indicado. Filtra siempre '
  'por club_id (aislamiento, como user_role_in_club). RM-2: si el user es superadmin '
  'de plataforma (is_superadmin), devuelve TRUE para CUALQUIER club (owner virtual → '
  'paridad-owner: invitar directores, gestionar roles altos). NO afecta a los demás '
  'usuarios (idéntico a F1B-0). profile_is_club_owner (protección del owner real) NO '
  'se cablea: el superadmin no ES el owner, solo actúa como tal.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_update_staff_role: rerutar el gate CALLER (v_is_owner) a
--    user_is_club_owner (superadmin-aware). Copia FIEL de la def viva (F14B-6);
--    ÚNICO cambio: la línea v_is_owner. El guard owner_immutable (TARGET) y
--    would_remove_last_admin quedan intactos → el owner REAL sigue protegido.
--    Para un usuario normal, user_is_club_owner(club) == profile_is_club_owner(
--    club, auth.uid()) → comportamiento idéntico; solo cambia para el superadmin.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_update_staff_role(p_club_id uuid, p_target_profile_id uuid, p_new_role text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- F14B-6: gestor del club (admin/director) O superadmin de plataforma.
  if not public.is_superadmin()
     and (v_caller_role is null or v_caller_role not in ('admin_club', 'director')) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- RM-2: gate CALLER de owner (¿el usuario ACTUAL actúa como owner?) → superadmin
  -- incluido. NO usa profile_is_club_owner(caller) para que el superadmin cuente.
  v_is_owner := public.user_is_club_owner(p_club_id);

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

  -- El OWNER no puede ser degradado ni cambiado por nadie (ni por sí mismo). TARGET
  -- gate: profile_is_club_owner(target) — NO reconoce al superadmin → el owner REAL
  -- sigue protegido incluso frente al superadmin.
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
$function$;

comment on function public.admin_update_staff_role(uuid, uuid, text) is
  'F1B-2/F14B-6/RM-2 — cambia el rol de club de un miembro. Caller admin_club/director '
  'O superadmin (F14B-6). RM-2: el gate CALLER de owner (v_is_owner) usa '
  'user_is_club_owner (superadmin = owner virtual) → el superadmin puede degradar roles '
  'altos como el owner. El owner REAL sigue INMUTABLE (owner_immutable vía '
  'profile_is_club_owner(target), no cableado) y se mantiene would_remove_last_admin. '
  'Rol destino alto sigue prohibido (high_role_invite_only). SECURITY DEFINER, solo role.';
