-- F15-C1-fix — FIX DE SEGURIDAD: propagación de NULL en gates imperativos (RGPD).
--
-- Bug más grave encontrado (demostrado en prod con un usuario SIN membresías):
-- user_role_in_club devuelve NULL para un no-miembro → `NULL in (...)` = NULL →
-- helpers como user_is_admin_or_director devuelven NULL → en un gate IMPERATIVO
-- `if not (<NULL>) then raise forbidden`, como `not NULL = NULL` y `if NULL` no
-- entra en la rama, NO se lanza forbidden → la función sigue y ejecuta la acción.
-- En una policy RLS un NULL se trata como deny (seguro); en un `if not` NO.
--
-- Vía de máximo daño: get_player_medical → cualquier authenticated leía la
-- médica (art. 9 RGPD) de cualquier menor con consentimiento vigente. Auditoría
-- de la clase completa: la misma raíz afecta a varias RPC (festivos, aprobación
-- de eventos/entrenamientos, borrado RGPD, compartir sesión, auditar chats,
-- cancelar eventos, validación de plays/ejercicios).
--
-- FIX (raíz): que los helpers NUNCA devuelvan NULL (coalesce(...,false)) y que
-- los dos gates que usan user_role_in_club en crudo pasen por el helper ya
-- saneado. Sin CHECK, sin cambiar ninguna otra lógica. Recreadas desde su
-- DEF VIVA (pg_get_functiondef). Es seguro para las RLS: allí NULL ya era deny,
-- y false es deny igual; un admin/director legítimo sigue dando true.
--
-- Funciones que se corrigen SOLAS al sanear los helpers (no se editan aquí):
--   · user_is_admin_or_director → decide_event_approval, decide_player_erasure,
--     mark_holiday, unmark_holiday, physically_erase_player, events_guard_approval,
--     user_can_publish_methodology (→ exercises_validate), y
--     user_can_access_player_medical (→ get_player_medical, con cinturón extra).
--   · user_can_approve_plays → plays_validate, replace_play_with_proposal.
--   · user_can_manage_event → cancel_event, uncancel_event.

-- 1) Helper base: nunca NULL.
create or replace function public.user_is_admin_or_director(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(public.user_role_in_club(p_club_id) in ('admin_club', 'director'), false);
$function$;

-- 2) Aprobar plays: nunca NULL.
create or replace function public.user_can_approve_plays(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador'), false);
$function$;

-- 3) Gestionar evento: nunca NULL (envuelve TODA la disyunción en coalesce).
create or replace function public.user_can_manage_event(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    -- (A) admin o director del club (club-wide, igual que hoy)
    public.user_role_in_club(p_club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO de ESE equipo (C-1a)
    or (
      p_team_id is not null
      and public.user_coordinates_team(p_team_id)
    )
    -- (B) entrenador PRINCIPAL del equipo del evento (rol a nivel EQUIPO)
    or (
      p_team_id is not null
      and public.user_is_principal_of_team(p_team_id)
    )
    -- (C) cualquier staff del equipo con la capability can_manage_calendar
    or (
      p_team_id is not null
      and public.user_has_capability_in_club(p_club_id, 'can_manage_calendar')
      and public.user_is_staff_of_team(p_team_id)
    ),
  false);
$function$;

-- 4) get_player_medical: además del helper ya saneado, CINTURÓN coalesce en el
--    gate imperativo (defensa en profundidad). Resto idéntico a la def viva.
create or replace function public.get_player_medical(p_player_id uuid, p_ip text default null::text, p_user_agent text default null::text)
returns table(allergies text, medication text, medical_conditions text, emergency_contact text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.player_medical%rowtype;
  v_club uuid;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- F14-7 — jugador suprimido: sin médica (además la fila ya se borró al aprobar).
  if exists (select 1 from public.players where id = p_player_id and erased_at is not null) then
    return;
  end if;

  if not coalesce(
    public.user_can_access_player_medical(p_player_id)
    and public.user_has_medical_consent_read(p_player_id)
  , false) then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.player_medical where player_id = p_player_id;

  if v_row.player_id is null or (
       v_row.allergies is null
   and v_row.medication is null
   and v_row.medical_conditions is null
   and v_row.emergency_contact is null
  ) then
    return;
  end if;

  if not public.user_is_tutor_of_player(p_player_id) then
    select club_id into v_club from public.players where id = p_player_id;
    begin
      v_ip := nullif(btrim(p_ip), '')::inet;
    exception when others then
      v_ip := null;
    end;
    insert into public.audit_log (
      actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
    ) values (
      v_uid,
      case when public.is_superadmin() then 'medical.read.platform' else 'medical.read' end,
      'player_medical', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return query
    select v_row.allergies, v_row.medication, v_row.medical_conditions, v_row.emergency_contact;
end;
$function$;

-- 5) audit_get_conversation: el gate usaba user_role_in_club en crudo
--    (`not in (...)` → NULL para no-miembro → no lanzaba). Pasa por el helper
--    ya saneado (mismo significado para admin/director; NULL-safe). Resto igual.
create or replace function public.audit_get_conversation(p_conversation_id uuid, p_reason text)
returns table(message_id uuid, sender_profile_id uuid, body text, sent_at timestamp with time zone, read_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
begin
  -- Validar razón.
  if p_reason is null or char_length(trim(p_reason)) < 5 then
    raise exception 'audit_reason_required_min_5_chars'
      using errcode = 'check_violation';
  end if;

  -- Resolver club_id de la conversación.
  select club_id into v_club_id
    from public.conversations
   where id = p_conversation_id;
  if v_club_id is null then
    raise exception 'conversation_not_found'
      using errcode = 'no_data_found';
  end if;

  -- Validar que el caller es admin_club o director del club (coordinador NO).
  if not public.user_is_admin_or_director(v_club_id) then
    raise exception 'audit_requires_admin_or_director'
      using errcode = 'insufficient_privilege';
  end if;

  -- Registrar el acceso ANTES de devolver datos (append-only).
  insert into public.audit_log (
    actor_profile_id, action, target_kind, target_id, club_id, reason
  ) values (
    auth.uid(),
    'conversation.audit_read',
    'conversation',
    p_conversation_id,
    v_club_id,
    trim(p_reason)
  );

  -- Devolver los mensajes (bypass RLS por SECURITY DEFINER).
  return query
    select m.id, m.sender_profile_id, m.body, m.sent_at, m.read_at
      from public.messages m
     where m.conversation_id = p_conversation_id
     order by m.sent_at asc;
end;
$function$;

-- 6) set_session_shared: el gate incluía user_role_in_club en crudo
--    (`= any(array[...])` → NULL para no-miembro → no lanzaba). Pasa por el
--    helper ya saneado. Resto idéntico a la def viva.
create or replace function public.set_session_shared(p_session_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_team_id     uuid;
  v_club_id     uuid;
  v_is_template boolean;
begin
  select team_id, club_id, is_template
    into v_team_id, v_club_id, v_is_template
  from public.sessions
  where id = p_session_id;

  if v_club_id is null then
    raise exception 'session_not_found' using errcode = 'no_data_found';
  end if;

  if v_is_template then
    raise exception 'template_not_shareable' using errcode = 'insufficient_privilege';
  end if;

  -- Gate: staff del equipo de la sesión ∪ admin_club/director del club ∪ superadmin.
  if not (
    public.user_is_staff_of_team(v_team_id)
    or public.user_is_admin_or_director(v_club_id)
    or public.is_superadmin()
  ) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  update public.sessions
     set visibility = case when p_shared then 'team' else 'staff' end
   where id = p_session_id;
end;
$function$;

-- 7) CIERRE DE CLASE (defensa en profundidad). La auditoría (pg_proc) probó que
--    estos 8 helpers pueden devolver NULL para un no-miembro, PERO hoy solo se
--    consumen en posiciones NULL-safe: policies RLS (USING/CHECK), exists() y
--    cláusulas WHERE — donde NULL y false son idénticos (ambos = deny/excluir).
--    Ningún gate imperativo `if not (...)` los usa (imperativo_if_not = 0 para los
--    8). Los saneamos igualmente para que un consumidor imperativo FUTURO no pueda
--    reabrir el agujero: la raíz (devolver NULL) queda eliminada de la clase entera.
--    Cambio de comportamiento para los consumidores actuales: NINGUNO.
--    Recreados desde su DEF VIVA (pg_get_functiondef); solo se añade el coalesce.

create or replace function public.user_can_create_coach_formations(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    -- admin/director/coord del club.
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    -- staff del club con la capability (ayudantes con can_create_lineups).
    or public.user_has_capability_in_club(p_club_id, 'can_create_lineups')
    -- principal de ALGÚN team del club (autoridad vía team_staff.staff_role).
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

create or replace function public.user_can_create_exercises(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_exercises')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

create or replace function public.user_can_create_plays(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_plays')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

create or replace function public.user_can_create_sessions(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_sessions')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

-- Los 4 basados en evento: además del coalesce, si el evento no existe la
-- subconsulta da 0 filas → el coalesce del escalar la convierte en false.
create or replace function public.user_can_manage_callup(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      -- (A) admin o director del club: siempre (club-wide, igual que hoy)
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      -- (A') coordinador SOLO del equipo del evento (C-1a)
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      -- (B) principal del TEAM (autoridad: team_staff.staff_role)
      or (
        e.team_id is not null
        and exists (
          select 1
          from public.team_staff ts
          join public.memberships m on m.id = ts.membership_id
          where ts.team_id = e.team_id
            and ts.staff_role = 'entrenador_principal'
            and ts.left_at is null
            and m.profile_id = auth.uid()
            and m.club_id = e.club_id
        )
      )
      -- (C) staff activo del team con capability can_manage_callups (ayudantes)
      or (
        e.team_id is not null
        and public.user_has_capability_in_club(e.club_id, 'can_manage_callups')
        and public.user_is_staff_of_team(e.team_id)
      )
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

create or replace function public.user_can_manage_lineup(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      or (
        e.team_id is not null
        and exists (
          select 1
          from public.team_staff ts
          join public.memberships m on m.id = ts.membership_id
          where ts.team_id = e.team_id
            and ts.staff_role = 'entrenador_principal'
            and ts.left_at is null
            and m.profile_id = auth.uid()
            and m.club_id = e.club_id
        )
      )
      or (
        e.team_id is not null
        and public.user_has_capability_in_club(e.club_id, 'can_create_lineups')
        and public.user_is_staff_of_team(e.team_id)
      )
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

create or replace function public.user_can_record_attendance(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      or (e.team_id is not null and public.user_is_principal_of_team(e.team_id))
      or (
        e.team_id is not null
        and public.user_has_capability_in_club(e.club_id, 'can_mark_attendance')
        and public.user_is_staff_of_team(e.team_id)
      )
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

create or replace function public.user_can_record_match(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;
