-- F5 Lote A — Mensajería interna y anuncios al equipo
--
-- Modelo (decisiones en docs/specs/5.0-mensajeria-push.md):
--   - conversations: 1:1 estricta coach ↔ jugador/familia. La familia se modela
--     vía player_accounts (todos los tutores leen y escriben el mismo hilo).
--     NO multi-participante.
--   - messages: texto plano, sender forzado a auth.uid() por trigger.
--     read_at se cierra cuando el receptor abre el hilo.
--   - announcements: broadcast read-only del staff al team. Sin reply directo;
--     si la familia quiere responder, abre conversación con el coach.
--   - audit_log: tabla append-only para registrar accesos privilegiados
--     (D4.bis del spec). F5 deja la infraestructura; F14 cierra la UI completa.
--
-- Permisos delegados a RLS:
--   - can_message_families (capability F1.4) cubre conversaciones Y anuncios.
--     Admin/coord/principal pueden por rol; ayudante solo si la cap está ON.
--   - Admin/coord NO tienen override de RLS sobre conversaciones/mensajes.
--     Su acceso de auditoría va por SECURITY DEFINER + audit_log (ver §5).
--   - Anuncios SÍ son visibles para admin/coord por RLS (broadcast, sin
--     expectativa de privacidad).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum extension — añadir tipos para F5
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.notification_type add value if not exists 'new_message';
alter type public.notification_type add value if not exists 'new_announcement';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. conversations
-- ─────────────────────────────────────────────────────────────────────────────

create table public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  club_id             uuid not null references public.clubs(id) on delete cascade,
  player_id           uuid not null references public.players(id) on delete cascade,
  coach_profile_id    uuid not null references public.profiles(id) on delete cascade,
  created_at          timestamptz not null default now(),
  last_message_at     timestamptz not null default now(),
  -- Un único hilo por (coach, jugador). Si el coach quiere "archivar y
  -- empezar de cero" lo haremos vía soft-delete futuro; F5 no expone esa op.
  constraint conversations_coach_player_unique unique (coach_profile_id, player_id)
);

create index conversations_player_idx        on public.conversations (player_id);
create index conversations_coach_idx         on public.conversations (coach_profile_id);
create index conversations_club_recent_idx   on public.conversations (club_id, last_message_at desc);

comment on table public.conversations is
  'F5 Lote A — hilo 1:1 coach ↔ jugador. La familia se modela vía player_accounts.';

-- Trigger: garantizar que el club_id de la conversación coincide con el del
-- player. Previene un coach del club A escribiendo a un player del club B
-- por error del cliente. RLS también lo bloquearía, pero defensive.
create or replace function public.conversations_same_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_player_club uuid;
begin
  select club_id into v_player_club from public.players where id = new.player_id;
  if v_player_club is null or v_player_club <> new.club_id then
    raise exception 'conversation_player_club_mismatch'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger conversations_same_club_trg
before insert on public.conversations
for each row execute function public.conversations_same_club();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. messages
-- ─────────────────────────────────────────────────────────────────────────────

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  sender_profile_id   uuid not null references public.profiles(id) on delete restrict,
  body                text not null check (char_length(body) between 1 and 2000),
  sent_at             timestamptz not null default now(),
  read_at             timestamptz
);

create index messages_conv_recent_idx on public.messages (conversation_id, sent_at desc);
create index messages_unread_idx      on public.messages (conversation_id)
  where read_at is null;

comment on table public.messages is
  'F5 Lote A — mensaje plano texto. sender_profile_id forzado a auth.uid().';

-- Trigger: forzar sender_profile_id = auth.uid() en INSERT.
-- Refuerza la policy INSERT y bloquea cualquier escritura "en nombre de" otro
-- participante incluso si una policy futura lo permitiera por error.
create or replace function public.messages_force_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = 'insufficient_privilege';
  end if;
  if new.sender_profile_id is distinct from auth.uid() then
    raise exception 'sender_must_equal_auth_uid'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger messages_force_sender_trg
before insert on public.messages
for each row execute function public.messages_force_sender();

-- Trigger: bump conversations.last_message_at en cada nuevo mensaje.
-- Permite ordenar el listado de conversaciones por actividad reciente sin
-- subquery cara cada vez.
create or replace function public.messages_bump_conv_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.sent_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_bump_conv_trg
after insert on public.messages
for each row execute function public.messages_bump_conv_last_message_at();

-- Trigger: proteger campos inmutables en UPDATE — solo se permite cerrar
-- read_at (NULL → timestamptz). Body, sender_profile_id, sent_at, etc.
-- no pueden cambiar después del INSERT.
create or replace function public.messages_protect_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id_immutable' using errcode = 'check_violation';
  end if;
  if new.conversation_id is distinct from old.conversation_id then
    raise exception 'conversation_id_immutable' using errcode = 'check_violation';
  end if;
  if new.sender_profile_id is distinct from old.sender_profile_id then
    raise exception 'sender_immutable' using errcode = 'check_violation';
  end if;
  if new.body is distinct from old.body then
    raise exception 'body_immutable' using errcode = 'check_violation';
  end if;
  if new.sent_at is distinct from old.sent_at then
    raise exception 'sent_at_immutable' using errcode = 'check_violation';
  end if;
  -- read_at solo puede pasar de NULL → not null (cierre). Volver a abrir no.
  if old.read_at is not null and new.read_at is null then
    raise exception 'read_at_cannot_reopen' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger messages_protect_update_trg
before update on public.messages
for each row execute function public.messages_protect_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. announcements
-- ─────────────────────────────────────────────────────────────────────────────

create table public.announcements (
  id                  uuid primary key default gen_random_uuid(),
  team_id             uuid not null references public.teams(id) on delete cascade,
  author_profile_id   uuid not null references public.profiles(id) on delete restrict,
  title               text not null check (char_length(title) between 1 and 120),
  body                text not null check (char_length(body) between 1 and 2000),
  pinned              boolean not null default false,
  expires_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index announcements_team_recent_idx on public.announcements (team_id, created_at desc);
create index announcements_team_active_idx on public.announcements (team_id, expires_at desc nulls first);

comment on table public.announcements is
  'F5 Lote A — broadcast read-only del staff al team. Sin replies; si la familia quiere responder, abre conversación con el coach.';

-- Trigger: bump updated_at en cada UPDATE.
create or replace function public.announcements_bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger announcements_bump_updated_at_trg
before update on public.announcements
for each row execute function public.announcements_bump_updated_at();

-- Trigger: author_profile_id inmutable.
create or replace function public.announcements_protect_author()
returns trigger
language plpgsql
as $$
begin
  if new.author_profile_id is distinct from old.author_profile_id then
    raise exception 'author_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger announcements_protect_author_trg
before update on public.announcements
for each row execute function public.announcements_protect_author();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. audit_log (D4.bis — append-only para accesos privilegiados)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.audit_log (
  id                  uuid primary key default gen_random_uuid(),
  actor_profile_id    uuid not null references public.profiles(id) on delete restrict,
  action              text not null,
  target_kind         text not null,
  target_id           uuid not null,
  club_id             uuid not null references public.clubs(id) on delete cascade,
  reason              text not null check (char_length(reason) between 5 and 500),
  occurred_at         timestamptz not null default now()
);

create index audit_log_target_idx on public.audit_log (target_kind, target_id, occurred_at desc);
create index audit_log_actor_idx  on public.audit_log (actor_profile_id, occurred_at desc);
create index audit_log_club_idx   on public.audit_log (club_id, occurred_at desc);

comment on table public.audit_log is
  'F5 D4.bis — log append-only de accesos privilegiados (admin/coord leyendo conversaciones para auditoría). Ampliado en F14 RGPD.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Helpers RLS específicos de F5
-- ─────────────────────────────────────────────────────────────────────────────

-- TRUE si el user es coach de la conversation o si tiene un player_account
-- activo sobre el player_id de la conversation (es decir, el jugador mismo
-- o un tutor/familiar). Wrapper de la condición que se repite en messages.
create or replace function public.user_is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and (
        c.coach_profile_id = auth.uid()
        or exists (
          select 1 from public.player_accounts pa
          where pa.player_id = c.player_id
            and pa.profile_id = auth.uid()
        )
      )
  );
$$;

comment on function public.user_is_conversation_participant(uuid) is
  'TRUE si el user es coach de la conversation o tutor/jugador vinculado por player_accounts. SECURITY DEFINER para que las RLS de messages la usen sin tropezar.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — conversations
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conversations enable row level security;

-- SELECT: solo participants. Admin/coord NO tienen override; van por
-- SECURITY DEFINER + audit_log para acceso de auditoría (D4.bis).
create policy conversations_select_participants on public.conversations
  for select to authenticated
  using (
    coach_profile_id = auth.uid()
    or exists (
      select 1 from public.player_accounts pa
      where pa.player_id = conversations.player_id
        and pa.profile_id = auth.uid()
    )
  );

-- INSERT: solo el coach que firma la conversación. Y debe ser staff del club
-- con can_message_families (admin/coord/principal pueden por rol).
create policy conversations_insert_coach on public.conversations
  for insert to authenticated
  with check (
    coach_profile_id = auth.uid()
    and (
      public.user_role_in_club(club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
      or public.user_has_capability_in_club(club_id, 'can_message_families')
    )
  );

-- UPDATE/DELETE: no permitidos desde cliente. Si en futuro se introduce
-- "archivar conversación" será vía función SECURITY DEFINER, no RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — messages
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.messages enable row level security;

-- SELECT: solo participants de la conversation padre.
create policy messages_select_participants on public.messages
  for select to authenticated
  using (public.user_is_conversation_participant(conversation_id));

-- INSERT: participant escribiendo en su propio nombre. Trigger refuerza
-- sender_profile_id = auth.uid().
create policy messages_insert_participant on public.messages
  for insert to authenticated
  with check (
    sender_profile_id = auth.uid()
    and public.user_is_conversation_participant(conversation_id)
  );

-- UPDATE: solo participant (para marcar read_at). El trigger ya valida que
-- solo read_at cambia; aquí cubrimos la visibilidad.
create policy messages_update_participant on public.messages
  for update to authenticated
  using (public.user_is_conversation_participant(conversation_id))
  with check (public.user_is_conversation_participant(conversation_id));

-- DELETE: no permitido a nadie.

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS — announcements
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.announcements enable row level security;

-- SELECT: cualquier miembro del club al que pertenece el team (broadcast).
-- Esto incluye staff del team, jugadores/familia con team_members activo, y
-- admin/coord del club. No necesita auditoría porque no hay expectativa de
-- privacidad: es broadcast por definición.
create policy announcements_select_club_member on public.announcements
  for select to authenticated
  using (
    exists (
      select 1 from public.teams t
      join public.categories cat on cat.id = t.category_id
      where t.id = announcements.team_id
        and public.user_role_in_club(cat.club_id) is not null
    )
  );

-- INSERT: staff del team con can_message_families (D3 revisada) o
-- admin/coord/principal del club.
create policy announcements_insert_staff on public.announcements
  for insert to authenticated
  with check (
    author_profile_id = auth.uid()
    and exists (
      select 1 from public.teams t
      join public.categories cat on cat.id = t.category_id
      where t.id = announcements.team_id
        and (
          public.user_role_in_club(cat.club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
          or public.user_has_capability_in_club(cat.club_id, 'can_message_families')
        )
    )
  );

-- UPDATE: autor o admin/coord/principal del club.
create policy announcements_update_author_or_manager on public.announcements
  for update to authenticated
  using (
    author_profile_id = auth.uid()
    or exists (
      select 1 from public.teams t
      join public.categories cat on cat.id = t.category_id
      where t.id = announcements.team_id
        and public.user_role_in_club(cat.club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
    )
  )
  with check (
    author_profile_id = auth.uid()
    or exists (
      select 1 from public.teams t
      join public.categories cat on cat.id = t.category_id
      where t.id = announcements.team_id
        and public.user_role_in_club(cat.club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
    )
  );

-- DELETE: autor o admin/coord/principal del club.
create policy announcements_delete_author_or_manager on public.announcements
  for delete to authenticated
  using (
    author_profile_id = auth.uid()
    or exists (
      select 1 from public.teams t
      join public.categories cat on cat.id = t.category_id
      where t.id = announcements.team_id
        and public.user_role_in_club(cat.club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RLS — audit_log
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.audit_log enable row level security;

-- SELECT: admin/coord del club pueden ver los accesos pasados a su club.
create policy audit_log_select_managers on public.audit_log
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
  );

-- INSERT/UPDATE/DELETE: bloqueados desde authenticated. La única escritura
-- legal viene de la función SECURITY DEFINER `audit_get_conversation` que
-- inserta en nombre del caller validado.

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Función SECURITY DEFINER — audit_get_conversation
-- ─────────────────────────────────────────────────────────────────────────────
-- Acceso privilegiado de admin/coord a una conversación 1:1. CADA acceso
-- queda registrado en audit_log con razón obligatoria (≥ 5 chars). F5 deja
-- la infra; F14 cierra la UI completa de auditoría.

create or replace function public.audit_get_conversation(
  p_conversation_id uuid,
  p_reason text
)
returns table (
  message_id        uuid,
  sender_profile_id uuid,
  body              text,
  sent_at           timestamptz,
  read_at           timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
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

  -- Validar que el caller es admin/coord del club.
  if public.user_role_in_club(v_club_id) not in ('admin_club', 'coordinador') then
    raise exception 'audit_requires_admin_or_coordinator'
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
$$;

revoke all on function public.audit_get_conversation(uuid, text) from public;
grant execute on function public.audit_get_conversation(uuid, text) to authenticated;

comment on function public.audit_get_conversation(uuid, text) is
  'D4.bis — admin/coord acceden a una conversación 1:1 para auditoría. Cada acceso queda en audit_log con razón obligatoria. F5 deja la infra; F14 cierra la UI completa.';
