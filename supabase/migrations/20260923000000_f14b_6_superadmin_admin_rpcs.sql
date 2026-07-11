-- F14B-6 — RPCs admin transversales para el superadmin.
--
-- El chokepoint (F14B-2) da acceso de LECTURA como admin, pero estos RPCs
-- SECURITY DEFINER comprueban role='admin_club' A MANO (inline, sin el helper),
-- así que el superadmin no podía EJECUTAR gestión en clubs donde no es miembro.
-- Se abre cada gate a: (admin_club del club) OR is_superadmin().
--
-- Barrido re-confirmado sobre la BD viva: el set inline (sin helper) que
-- referencia 'admin_club' son 10 funciones. FUERA de esta subfase:
--   · create_club_with_admin  → lo reescribe F14B-5 (crear club sin membership
--     del superadmin); NO se toca aquí.
--   · team_chat_member_profile_ids → helper de LECTURA que lista miembros del
--     chat de un equipo (no es un gate de ejecutar); el superadmin NO debe
--     aparecer como miembro de los chats. NO se toca.
-- DENTRO (8): open_next_season, finalize_active_season,
--   place_players_in_upcoming, unplace_player_from_upcoming, set_player_left_club,
--   admin_update_staff_profile, admin_update_staff_role, admin_update_staff_contact.
--
-- Cada función se recrea con su cuerpo VIVO idéntico salvo el gate. En
-- admin_update_staff_role se parchea SOLO el gate del caller; los guards
-- owner_immutable / high_role_invite_only / forbidden_requires_owner y el guard
-- "último admin" (would_remove_last_admin) quedan INTACTOS: el superadmin puede
-- gestionar staff pero NUNCA puede dejar un club real sin su admin, y el
-- superadmin no cuenta como admin del club para ese guard (no es miembro).
--
-- ALCANCE ESTRICTO: solo estos 8 gates. No se audita (F14B-4), no se toca
-- create_club_with_admin (F14B-5), no se construye consola.

CREATE OR REPLACE FUNCTION public.open_next_season(p_club_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_active   text;
  v_upcoming text;
  v_year     int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club puede abrir temporada (coincide con la RLS de seasons).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select label into v_active from public.seasons
   where club_id = p_club_id and status = 'active' limit 1;
  if v_active is null then
    raise exception 'no_active_season' using errcode = 'P0001';
  end if;

  -- Reanuda la upcoming si ya existe; si no, créala con el label siguiente.
  select label into v_upcoming from public.seasons
   where club_id = p_club_id and status = 'upcoming' limit 1;

  if v_upcoming is null then
    v_year := left(v_active, 4)::int;  -- 'YYYY-YY' → siguiente: YYYY+1 - (YYYY+2 mod 100)
    v_upcoming := (v_year + 1)::text || '-' || lpad(((v_year + 2) % 100)::text, 2, '0');
    insert into public.seasons (club_id, label, status)
      values (p_club_id, v_upcoming, 'upcoming')
    on conflict (club_id, label) do update set status = 'upcoming', updated_at = now();
  end if;

  -- Clona la estructura de equipos de la activa → upcoming (idempotente por nombre).
  -- NO se tocan los equipos de la activa. La season upcoming ya existe (arriba).
  insert into public.teams (club_id, category_id, season, name, format, color, division)
    select s.club_id, s.category_id, v_upcoming, s.name, s.format, s.color, s.division
      from public.teams s
     where s.club_id = p_club_id
       and s.season = v_active
       and not exists (
         select 1 from public.teams d
          where d.club_id = p_club_id
            and d.season = v_upcoming
            and lower(d.name) = lower(s.name)
       );

  return v_upcoming;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_active_season(p_club_id uuid, p_cutoff date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_active    text;
  v_upcoming  text;
  v_max_join  date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con C6/C7).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if p_cutoff is null then
    raise exception 'cutoff_required' using errcode = 'P0001';
  end if;

  select label into v_active from public.seasons
   where club_id = p_club_id and status = 'active' limit 1;
  if v_active is null then
    raise exception 'no_active_season' using errcode = 'P0001';
  end if;

  -- Guard: sin upcoming no hay temporada nueva que activar.
  select label into v_upcoming from public.seasons
   where club_id = p_club_id and status = 'upcoming' limit 1;
  if v_upcoming is null then
    raise exception 'no_upcoming' using errcode = 'P0001';
  end if;

  -- La fecha de corte no puede ser anterior a ninguna alta abierta de la activa
  -- (rompería team_members_left_at_check: left_at >= joined_at). Mensaje limpio.
  select max(tm.joined_at) into v_max_join
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.club_id = p_club_id and t.season = v_active and tm.left_at is null;
  if v_max_join is not null and p_cutoff < v_max_join then
    raise exception 'cutoff_too_early' using errcode = 'P0001';
  end if;

  -- 1. Cierra las membresías abiertas de los equipos de la ACTIVA. Las de la
  --    upcoming (equipos con season = v_upcoming) no entran en el filtro.
  update public.team_members tm
     set left_at = p_cutoff
    from public.teams t
   where tm.team_id = t.id
     and t.club_id = p_club_id
     and t.season = v_active
     and tm.left_at is null;

  -- 2 + 3. Demoter la activa ANTES de promover la upcoming (índice parcial).
  update public.seasons set status = 'finalized', updated_at = now()
   where club_id = p_club_id and label = v_active and status = 'active';

  update public.seasons set status = 'active', updated_at = now()
   where club_id = p_club_id and label = v_upcoming and status = 'upcoming';

  return v_upcoming;
end;
$function$;

CREATE OR REPLACE FUNCTION public.place_players_in_upcoming(p_club_id uuid, p_dest_team_id uuid, p_player_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid         uuid := auth.uid();
  v_dest_season text;
  v_placed      int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con quién abre la temporada en C6).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El equipo destino debe pertenecer al club y a su temporada UPCOMING.
  select t.season into v_dest_season
    from public.teams t
   where t.id = p_dest_team_id and t.club_id = p_club_id;
  if v_dest_season is null then
    raise exception 'dest_team_invalid' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.seasons s
     where s.club_id = p_club_id and s.label = v_dest_season and s.status = 'upcoming'
  ) then
    raise exception 'dest_not_upcoming' using errcode = 'P0001';
  end if;

  -- COLOCA: solo INSERT. Una membresía activa en el equipo destino por cada
  -- jugador del club marcado que aún NO esté activo en ese equipo. Cross-categoría
  -- permitido (no se valida la categoría del origen). NUNCA cierra/modifica nada.
  with ins as (
    insert into public.team_members (player_id, team_id, joined_at)
    select pid, p_dest_team_id, current_date
      from unnest(p_player_ids) as pid
     where exists (
             select 1 from public.players p
              where p.id = pid and p.club_id = p_club_id
           )
       and not exists (
             select 1 from public.team_members tm
              where tm.player_id = pid
                and tm.team_id = p_dest_team_id
                and tm.left_at is null
           )
    returning 1
  )
  select count(*) into v_placed from ins;

  return v_placed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unplace_player_from_upcoming(p_club_id uuid, p_team_id uuid, p_player_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_season  text;
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con C6/C7/C8).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El equipo debe pertenecer al club.
  select t.season into v_season
    from public.teams t
   where t.id = p_team_id and t.club_id = p_club_id;
  if v_season is null then
    raise exception 'team_invalid' using errcode = 'P0001';
  end if;

  -- GUARD CRÍTICO: solo equipos de una temporada UPCOMING. Si la season del equipo
  -- es active o finalized (o no existe como upcoming) → se rechaza: borrar ahí
  -- sería destruir histórico real.
  if not exists (
    select 1 from public.seasons s
     where s.club_id = p_club_id and s.label = v_season and s.status = 'upcoming'
  ) then
    raise exception 'not_upcoming' using errcode = 'P0001';
  end if;

  -- Borra la colocación ABIERTA. Idempotente: si no estaba colocado, 0 filas.
  -- Nunca toca la membresía de la temporada activa (otro team_id, otra season).
  with del as (
    delete from public.team_members tm
     where tm.player_id = p_player_id
       and tm.team_id   = p_team_id
       and tm.left_at is null
    returning 1
  )
  select count(*) into v_deleted from del;

  return v_deleted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_player_left_club(p_club_id uuid, p_player_id uuid, p_left_at date, p_reason text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con el resto de Rework C).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El jugador debe pertenecer al club.
  if not exists (
    select 1 from public.players p
     where p.id = p_player_id and p.club_id = p_club_id
  ) then
    raise exception 'player_invalid' using errcode = 'P0001';
  end if;

  -- Baja (left_at no nulo) o reactivar (left_at NULL → limpia la razón). Solo
  -- toca estas dos columnas: nunca team_members/stats/eventos. Idempotente.
  update public.players
     set left_club_at     = p_left_at,
         left_club_reason = case when p_left_at is null then null else p_reason end,
         updated_at       = now()
   where id = p_player_id and club_id = p_club_id;

  return p_left_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_staff_profile(p_club_id uuid, p_target_profile_id uuid, p_full_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(p_full_name), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo admin_club del club (coordinador NO: la identidad es más sensible).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_staff_contact(p_club_id uuid, p_target_profile_id uuid, p_phone text, p_contact_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(btrim(p_contact_email), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo admin_club del club (coordinador NO: el contacto es identidad sensible).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club (no se pueden tocar membresías ajenas).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = p_target_profile_id
  ) then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  if v_phone is not null and char_length(v_phone) not between 3 and 32 then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;

  if v_email is not null then
    if char_length(v_email) > 254 then
      raise exception 'contact_email_invalid' using errcode = 'P0001';
    end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'contact_email_invalid' using errcode = 'P0001';
    end if;
  end if;

  -- Solo phone/contact_email de la membership de ESE club. Nunca auth, profiles,
  -- role ni otras columnas.
  update public.memberships
     set phone = v_phone, contact_email = v_email
   where club_id = p_club_id and profile_id = p_target_profile_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_staff_role(p_club_id uuid, p_target_profile_id uuid, p_new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
