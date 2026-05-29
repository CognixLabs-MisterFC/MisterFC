-- Subfase 4.3 — Modelo de convocatoria de partido.
--
-- Spec: docs/specs/4.0-asistencia-convocatorias.md (Lote B, D3).
--
-- Tres tablas separadas (decisión D3 razonada en la spec):
--   1. match_callup_meta        — datos de citación (hora, lugar, transporte,
--                                  notas) por partido + estado borrador/publicado.
--   2. callup_responses         — respuesta del jugador o familia (yes/maybe/no
--                                  + razón opcional).
--   3. callup_decisions         — decisión técnica del cuerpo técnico
--                                  (called_up / discarded + razón opcional).
--
-- Reutiliza:
--   - events (F3) como ancla.
--   - team_members (F2.5) para validar roster histórico al día del partido.
--   - players, profiles, teams.
--   - user_role_in_club, user_is_staff_of_team, user_has_capability_in_club
--     (F1.7).
--
-- Capability `can_manage_callups` se añade en la migración siguiente
-- (20260602000001). Hasta entonces el helper devuelve false para ayudante.
--
-- Triggers en lugar de CHECK con función: las validaciones dependen de
-- `events` y `team_members`, tablas externas. Patrón heredado de F4.1
-- (training_attendance).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

create type public.transport_mode as enum ('club', 'individual', 'mixed');

create type public.callup_response_status as enum ('yes', 'maybe', 'no');

create type public.callup_decision_kind as enum ('called_up', 'discarded');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper RLS: user_can_manage_callup(event_id)
--
-- Mirror de user_can_record_attendance (F4.1) con `can_manage_callups`. NO
-- delega en user_can_manage_event para no conflar permisos de calendario
-- con permisos de convocatoria.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_manage_callup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(e.club_id) in ('admin_club', 'coordinador')
    or (
      e.team_id is not null
      and public.user_role_in_club(e.club_id) = 'entrenador_principal'
      and public.user_is_staff_of_team(e.team_id)
    )
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_manage_callups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

comment on function public.user_can_manage_callup(uuid) is
  'F4.3 — TRUE si el user actual puede gestionar la convocatoria del evento. admin/coord o principal/ayudante con can_manage_callups del team del evento.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper: user_owns_player_account(player_id)
--
-- TRUE si el user actual tiene una fila activa en player_accounts vinculando
-- su profile_id al player_id dado. La policy de callup_responses lo usa para
-- restringir INSERT/UPDATE a "el propio jugador o familia vinculada".
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_owns_player_account(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.player_accounts pa
     where pa.player_id = p_player_id
       and pa.profile_id = auth.uid()
  );
$$;

comment on function public.user_owns_player_account(uuid) is
  'F4.3 — TRUE si el user actual está vinculado al player vía player_accounts (jugador o familia, F2.4).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. match_callup_meta
-- ─────────────────────────────────────────────────────────────────────────────

create table public.match_callup_meta (
  event_id          uuid primary key references public.events(id) on delete cascade,
  meeting_at        timestamptz not null,
  meeting_location  text not null check (char_length(meeting_location) between 1 and 200),
  meeting_address   text check (meeting_address is null or char_length(meeting_address) <= 300),
  transport_mode    public.transport_mode,
  transport_notes   text check (transport_notes is null or char_length(transport_notes) <= 500),
  notes_general     text check (notes_general is null or char_length(notes_general) <= 1000),
  published_at      timestamptz,
  published_by      uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint match_callup_meta_published_pair
    check ((published_at is null and published_by is null)
        or (published_at is not null and published_by is not null))
);

comment on table public.match_callup_meta is
  'F4.3 — datos de citación de un partido + estado borrador/publicado.';

-- Trigger: enforce event.type='match' y proteger published_at.
create or replace function public.match_callup_meta_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type <> 'match' then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- event_id inmutable
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    -- published_at no puede revertir a NULL.
    if old.published_at is not null and new.published_at is null then
      raise exception 'cannot_unpublish' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  -- Si se está publicando ahora, forzar published_by = auth.uid().
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null) then
    if auth.uid() is null then
      raise exception 'published_by_required' using errcode = 'check_violation';
    end if;
    new.published_by := auth.uid();
  end if;

  return new;
end;
$$;

create trigger trg_match_callup_meta_validate
  before insert or update on public.match_callup_meta
  for each row execute function public.match_callup_meta_validate();

alter table public.match_callup_meta enable row level security;

-- SELECT: si publicada → cualquier miembro del club; si borrador → solo manager.
create policy match_callup_meta_select on public.match_callup_meta
  for select to authenticated
  using (
    case
      when published_at is not null then
        exists (
          select 1 from public.events e
           where e.id = match_callup_meta.event_id
             and public.user_role_in_club(e.club_id) is not null
        )
      else
        public.user_can_manage_callup(event_id)
    end
  );

create policy match_callup_meta_insert on public.match_callup_meta
  for insert to authenticated
  with check (public.user_can_manage_callup(event_id));

create policy match_callup_meta_update on public.match_callup_meta
  for update to authenticated
  using      (public.user_can_manage_callup(event_id))
  with check (public.user_can_manage_callup(event_id));

create policy match_callup_meta_delete on public.match_callup_meta
  for delete to authenticated
  using (public.user_can_manage_callup(event_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. callup_responses
-- ─────────────────────────────────────────────────────────────────────────────

create table public.callup_responses (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,
  status          public.callup_response_status not null,
  reason          text check (reason is null or char_length(reason) <= 500),
  responded_by    uuid not null references public.profiles(id),
  responded_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint callup_responses_unique_event_player unique (event_id, player_id)
);

create index callup_responses_event_idx on public.callup_responses (event_id);

create index callup_responses_player_idx on public.callup_responses (player_id);

comment on table public.callup_responses is
  'F4.3 — respuesta del jugador o familia a una convocatoria. Solo el linked profile (via player_accounts) puede escribir su fila.';

-- Trigger: enforce event.type='match', match_callup_meta publicada, roster
-- histórico, responded_by = auth.uid(), inmutabilidades.
create or replace function public.callup_responses_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_meta  match_callup_meta%rowtype;
  v_player players%rowtype;
  v_belongs boolean;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type <> 'match' then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  -- Solo se puede responder a convocatorias PUBLICADAS.
  select * into v_meta from public.match_callup_meta where event_id = new.event_id;
  if not found or v_meta.published_at is null then
    raise exception 'callup_not_published' using errcode = 'check_violation';
  end if;

  -- Validar player + club coincidente.
  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del partido.
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  -- Forzar responded_by = auth.uid().
  if auth.uid() is not null then
    new.responded_by := auth.uid();
  end if;

  if tg_op = 'INSERT' then
    new.updated_at := new.responded_at;
  else
    -- event_id, player_id, responded_by inmutables.
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    if new.responded_by is distinct from old.responded_by then
      raise exception 'responded_by_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_callup_responses_validate
  before insert or update on public.callup_responses
  for each row execute function public.callup_responses_validate();

alter table public.callup_responses enable row level security;

-- SELECT: managers (todos los de su team) + dueños del player (su fila).
create policy callup_responses_select on public.callup_responses
  for select to authenticated
  using (
    public.user_can_manage_callup(event_id)
    or public.user_owns_player_account(player_id)
  );

-- INSERT/UPDATE: solo el dueño del player_account. Managers NO escriben aquí
-- — usan callup_decisions.
create policy callup_responses_insert on public.callup_responses
  for insert to authenticated
  with check (public.user_owns_player_account(player_id));

create policy callup_responses_update on public.callup_responses
  for update to authenticated
  using      (public.user_owns_player_account(player_id))
  with check (public.user_owns_player_account(player_id));

create policy callup_responses_delete on public.callup_responses
  for delete to authenticated
  using (public.user_owns_player_account(player_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. callup_decisions
-- ─────────────────────────────────────────────────────────────────────────────

create table public.callup_decisions (
  event_id        uuid not null references public.events(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,
  decision        public.callup_decision_kind not null,
  reason          text check (reason is null or char_length(reason) <= 500),
  decided_by      uuid not null references public.profiles(id),
  decided_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (event_id, player_id)
);

create index callup_decisions_event_idx on public.callup_decisions (event_id);

comment on table public.callup_decisions is
  'F4.3 — decisión técnica del cuerpo técnico (called_up / discarded) por partido y jugador.';

-- Trigger: enforce event.type='match', roster histórico, decided_by forzado,
-- inmutabilidades.
create or replace function public.callup_decisions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_player players%rowtype;
  v_belongs boolean;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type <> 'match' then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  if auth.uid() is not null then
    new.decided_by := auth.uid();
  end if;

  if tg_op = 'INSERT' then
    new.updated_at := new.decided_at;
  else
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_callup_decisions_validate
  before insert or update on public.callup_decisions
  for each row execute function public.callup_decisions_validate();

alter table public.callup_decisions enable row level security;

-- SELECT: cualquier miembro del club (info que el jugador necesita saber al ir
-- al partido). Hereda el bug F3-rls-events-visibilidad documentado.
create policy callup_decisions_select on public.callup_decisions
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
       where e.id = callup_decisions.event_id
         and public.user_role_in_club(e.club_id) is not null
    )
  );

create policy callup_decisions_insert on public.callup_decisions
  for insert to authenticated
  with check (public.user_can_manage_callup(event_id));

create policy callup_decisions_update on public.callup_decisions
  for update to authenticated
  using      (public.user_can_manage_callup(event_id))
  with check (public.user_can_manage_callup(event_id));

create policy callup_decisions_delete on public.callup_decisions
  for delete to authenticated
  using (public.user_can_manage_callup(event_id));
