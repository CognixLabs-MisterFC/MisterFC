-- ═════════════════════════════════════════════════════════════════════════════
-- C-1c — ACOTAR EL COORDINADOR A SUS EQUIPOS: dominio CHATS / ANUNCIOS.
--
-- Serie C: coordinador = solo sus equipos (user_coordinates_team, C-0). admin/
-- director club-wide; principal/ayudante/capability/superadmin sin cambios. Reglas
-- de Jose para este dominio:
--   · Chats y anuncios de EQUIPO → coordinador solo en SUS equipos.
--   · Anuncios de CLUB (team_id IS NULL) → coordinador NO (solo dirección).
--   · Recepción (lectura) de anuncios de club → el coordinador la CONSERVA (como
--     cualquier miembro del club).
--
-- 5 policies inline (announcements x4 + conversations x1) + 1 RPC de auditoría.
-- 0 helpers recreados. Los chats de EQUIPO (team_conversations/team_messages/
-- team_chat_participation + helpers user_is_team_chat_member/user_can_post_team_chat)
-- ya son team-scoped (entran por user_is_staff_of_team) → NO se tocan.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. announcements_insert_managers (base viva f1b1 20260823) ───────────────
-- Tabla mixta. Antes: CLUB (team_id null) = admin/director/coord; EQUIPO = admin/
-- director/coord/principal OR can_message_families OR principal-del-team.
-- Después: CLUB pierde coord (solo admin/director); EQUIPO pierde coord de la
-- lista y gana rama user_coordinates_team(team_id). Resto intacto.
drop policy if exists announcements_insert_managers on public.announcements;
create policy announcements_insert_managers
  on public.announcements
  for insert
  to authenticated
  with check (
    author_profile_id = auth.uid()
    and (
      -- CLUB: solo dirección (coordinador excluido)
      (team_id is null and public.user_role_in_club(club_id) = any (array['admin_club', 'director']))
      -- EQUIPO
      or (
        team_id is not null
        and (
          public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
          or public.user_coordinates_team(team_id)
          or public.user_has_capability_in_club(club_id, 'can_message_families')
          or exists (
            select 1
            from public.team_staff ts
            join public.memberships m on m.id = ts.membership_id
            where ts.team_id = announcements.team_id
              and ts.staff_role = 'entrenador_principal'
              and ts.left_at is null
              and m.profile_id = auth.uid()
          )
        )
      )
    )
  );

-- ── 2. announcements_update_author_or_manager (base viva f1b1 20260823) ──────
-- Antes (plano, sin distinguir team_id): author OR role in (admin/director/coord/
-- principal). Después: coord fuera de la lista + rama team_id IS NOT NULL AND
-- user_coordinates_team(team_id). Coordinador edita solo anuncios de sus equipos,
-- excluido de los de club. author/admin/director/principal intactos.
drop policy if exists announcements_update_author_or_manager on public.announcements;
create policy announcements_update_author_or_manager
  on public.announcements
  for update
  to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
    or (team_id is not null and public.user_coordinates_team(team_id))
  )
  with check (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
    or (team_id is not null and public.user_coordinates_team(team_id))
  );

-- ── 3. announcements_delete_author_or_manager (base viva f1b1 20260823) ──────
-- Idéntico criterio que #2 (solo USING).
drop policy if exists announcements_delete_author_or_manager on public.announcements;
create policy announcements_delete_author_or_manager
  on public.announcements
  for delete
  to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
    or (team_id is not null and public.user_coordinates_team(team_id))
  );

-- ── 4. announcements_select_club_member (base viva 20260605000002) ──────────
-- LECTURA. Antes: author OR role in (admin_club,coordinador) OR (team_id IS NULL
-- AND role IS NOT NULL) OR (team_id IS NOT NULL AND (staff_of_team OR tutor)).
-- Después: quitar 'coordinador' de la lista → solo 'admin_club'. El coordinador
-- SIGUE recibiendo anuncios de CLUB por la rama (team_id IS NULL AND role IS NOT
-- NULL) y los de SUS equipos por user_is_staff_of_team(team_id); solo pierde los
-- de otros equipos. Recepción intacta.
drop policy if exists announcements_select_club_member on public.announcements;
create policy announcements_select_club_member
  on public.announcements
  for select
  to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
    or (team_id is null and public.user_role_in_club(club_id) is not null)
    or (
      team_id is not null
      and (
        public.user_is_staff_of_team(team_id)
        or exists (
          select 1
          from public.team_members tm
          join public.player_accounts pa on pa.player_id = tm.player_id
          where tm.team_id = announcements.team_id
            and tm.left_at is null
            and pa.profile_id = auth.uid()
        )
      )
    )
  );

-- ── 5. conversations_insert_coach (base viva f1b1 20260823) ──────────────────
-- Chat directo coach↔jugador (sin team_id). Antes: coach=auth.uid() AND (role in
-- (admin/director/coord/principal) OR can_message_families OR principal-de-un-team-
-- del-club). Después: coord fuera de la lista + rama team_members del jugador →
-- user_coordinates_team. El coordinador solo abre chat con jugadores de sus equipos.
drop policy if exists conversations_insert_coach on public.conversations;
create policy conversations_insert_coach
  on public.conversations
  for insert
  to authenticated
  with check (
    coach_profile_id = auth.uid()
    and (
      public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
      or exists (
        select 1
        from public.team_members tm
        where tm.player_id = conversations.player_id
          and tm.left_at is null
          and public.user_coordinates_team(tm.team_id)
      )
      or public.user_has_capability_in_club(club_id, 'can_message_families')
      or exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        join public.teams t on t.id = ts.team_id
        join public.categories c on c.id = t.category_id
        where ts.staff_role = 'entrenador_principal'
          and ts.left_at is null
          and m.profile_id = auth.uid()
          and c.club_id = conversations.club_id
      )
    )
  );

-- ── 6. audit_get_conversation (base viva messaging 20260605000000) ──────────
-- RPC break-glass (lee un chat 1-a-1 con motivo, trazado en audit_log). Antes el
-- gate permitía ('admin_club','coordinador') → el DIRECTOR estaba DENEGADO hoy.
-- Cambio (Jose): admin_club y director SÍ; coordinador NO. Solo cambia la lista de
-- roles permitidos; el logging (insert append-only en audit_log) NO se toca.
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
  if public.user_role_in_club(v_club_id) not in ('admin_club', 'director') then
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
