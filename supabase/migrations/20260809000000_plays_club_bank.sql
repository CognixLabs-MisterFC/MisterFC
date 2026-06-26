-- JR-0 (ADR-0019) — Jugadas: de team-scoped+directo a BANCO DEL CLUB + ciclo de
-- aprobación (patrón ejercicios F11). Solo 1 jugada en BD → migración trivial.
--
-- Cambios:
--  * plays: + status/approved_by/approved_at/rejection_reason/archived_at;
--    se QUITAN team_id y visibility de la identidad (la jugada es del club).
--  * nueva tabla team_plays: selección por equipo (playbook) + shared_with_family.
--  * helpers user_can_create_plays(club_id) [reescrito club-scoped] y
--    user_can_approve_plays(club_id)=admin∪coordinador [NUEVO, separado de
--    user_can_publish_methodology de ejercicios, que NO cambia].
--  * RLS de plays por estado (clon de exercises) + RLS de team_plays.
--  * migración de datos: la jugada existente → published; su vínculo de equipo y
--    el "shared_with_family" se preservan en team_plays.
--
-- El contrato jsonb de la jugada (play/frames) NO cambia.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas de ciclo de metodología en plays
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.plays
  add column status           text not null default 'draft'
                                check (status in ('draft', 'proposed', 'published', 'rejected')),
  add column approved_by      uuid references public.profiles(id),
  add column approved_at      timestamptz,
  add column rejection_reason text,
  add column archived_at      timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabla team_plays — selección de jugadas del banco por equipo (playbook)
-- ─────────────────────────────────────────────────────────────────────────────
create table public.team_plays (
  id                 uuid primary key default gen_random_uuid(),
  club_id            uuid not null references public.clubs(id) on delete cascade,  -- derivado del team
  team_id            uuid not null references public.teams(id) on delete cascade,
  play_id            uuid not null references public.plays(id) on delete cascade,
  added_by           uuid references public.profiles(id),
  shared_with_family boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (team_id, play_id)
);
create index team_plays_team_idx on public.team_plays (team_id);
create index team_plays_play_idx on public.team_plays (play_id);

comment on table public.team_plays is
  'JR-0/ADR-0019 — playbook por equipo: jugadas del banco del club que un equipo ha seleccionado. shared_with_family expone la jugada al jugador/familia del equipo.';

-- Trigger team_plays: fuerza added_by + deriva club_id del team + inmutabilidad.
create or replace function public.team_plays_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select c.club_id into v_club
    from public.teams t join public.categories c on c.id = t.category_id
   where t.id = new.team_id;
  if v_club is null then
    raise exception 'team_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.added_by := auth.uid();
    end if;
  else  -- UPDATE: team_id/play_id/club_id inmutables (solo se togglea shared_with_family)
    if new.team_id is distinct from old.team_id then
      raise exception 'team_immutable' using errcode = 'check_violation';
    end if;
    if new.play_id is distinct from old.play_id then
      raise exception 'play_immutable' using errcode = 'check_violation';
    end if;
    new.club_id := old.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_team_plays_validate
  before insert or update on public.team_plays
  for each row execute function public.team_plays_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Migración de datos: backfill team_plays + publicar jugadas existentes
--    (debe ir ANTES de eliminar team_id/visibility).
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.team_plays (club_id, team_id, play_id, added_by, shared_with_family)
select p.club_id, p.team_id, p.id, p.owner_profile_id, (p.visibility = 'team')
  from public.plays p;

update public.plays
   set status      = 'published',
       approved_by = owner_profile_id,
       approved_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Quitar RLS y trigger viejos de plays (referencian team_id/visibility y el
--    helper team-scoped) para poder reescribirlos.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists plays_select on public.plays;
drop policy if exists plays_insert on public.plays;
drop policy if exists plays_update on public.plays;
drop policy if exists plays_delete on public.plays;
drop trigger if exists trg_plays_validate on public.plays;

-- El helper team-scoped ya no lo usa ninguna policy → se puede dropear y recrear
-- con otra firma (club-scoped). drop explícito porque cambia el nombre del arg.
drop function if exists public.user_can_create_plays(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Eliminar team_id y visibility de la identidad de plays (D5/D3).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.plays drop column team_id;
alter table public.plays drop column visibility;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Helpers nuevos
-- ─────────────────────────────────────────────────────────────────────────────
-- Crear/proponer jugadas en el club (clon de user_can_create_exercises).
create or replace function public.user_can_create_plays(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador')
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
    );
$$;
comment on function public.user_can_create_plays(uuid) is
  'JR-0 — TRUE si el user puede crear/proponer jugadas en el club: admin/coord, capability can_create_plays, o principal de algún equipo del club. Club-scoped (antes era team-scoped).';
grant execute on function public.user_can_create_plays(uuid) to authenticated;

-- Aprobar/rechazar/archivar jugadas del banco: admin ∪ coordinador (D1).
-- SEPARADO de user_can_publish_methodology (ejercicios = solo admin, sin cambios).
create or replace function public.user_can_approve_plays(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador');
$$;
comment on function public.user_can_approve_plays(uuid) is
  'JR-0/ADR-0019 D1 — TRUE si el user puede aprobar/rechazar/archivar jugadas del banco del club (admin_club o coordinador). Separado de ejercicios.';
grant execute on function public.user_can_approve_plays(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Trigger de plays con máquina de estados (clon de exercises_validate).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.plays_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Forma ligera del jsonb play (autoritativo = parsePlay en la app).
  if jsonb_typeof(new.play) <> 'object' then
    raise exception 'play_not_object' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(new.play -> 'frames') <> 'array' then
    raise exception 'play_frames_not_array' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(new.play -> 'frames') < 1
     or jsonb_array_length(new.play -> 'frames') > 60 then
    raise exception 'play_frames_out_of_range' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_profile_id := auth.uid();
    end if;
    if new.status = 'rejected' then
      raise exception 'cannot_create_rejected' using errcode = 'check_violation';
    end if;
    if new.status = 'published' then
      if not public.user_can_approve_plays(new.club_id) then
        raise exception 'publish_requires_approver' using errcode = 'check_violation';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;

  else  -- UPDATE
    if new.owner_profile_id is distinct from old.owner_profile_id then
      raise exception 'owner_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();

    if new.status is distinct from old.status then
      if new.status in ('published', 'rejected')
         and not public.user_can_approve_plays(new.club_id) then
        raise exception 'transition_requires_approver' using errcode = 'check_violation';
      end if;
      if new.status = 'rejected'
         and (new.rejection_reason is null or btrim(new.rejection_reason) = '') then
        raise exception 'rejection_reason_required' using errcode = 'check_violation';
      end if;
      if new.status = 'published' then
        new.approved_by := auth.uid();
        new.approved_at := now();
        new.rejection_reason := null;
      end if;
    end if;

    if new.archived_at is not null and old.archived_at is null then
      if new.status <> 'published' then
        raise exception 'archive_only_published' using errcode = 'check_violation';
      end if;
      if not public.user_can_approve_plays(new.club_id) then
        raise exception 'archive_requires_approver' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_plays_validate
  before insert or update on public.plays
  for each row execute function public.plays_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS de plays por estado (clon de exercises_select/insert/update/delete).
-- ─────────────────────────────────────────────────────────────────────────────
create policy plays_select on public.plays
  for select to authenticated
  using (
    case
      when status = 'draft' then
        owner_profile_id = auth.uid()
      when status in ('proposed', 'rejected') then
        owner_profile_id = auth.uid()
        or public.user_can_approve_plays(club_id)
      else  -- published (incl. archivadas)
        public.user_role_in_club(club_id) in
          ('admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
    end
  );

create policy plays_insert on public.plays
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_can_create_plays(club_id)
  );

create policy plays_update on public.plays
  for update to authenticated
  using (
    (owner_profile_id = auth.uid() and status in ('draft', 'proposed', 'rejected'))
    or public.user_can_approve_plays(club_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.user_can_approve_plays(club_id)
  );

create policy plays_delete on public.plays
  for delete to authenticated
  using (
    (owner_profile_id = auth.uid() and status in ('draft', 'proposed', 'rejected'))
    or (public.user_can_approve_plays(club_id) and status <> 'published')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS de team_plays.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.team_plays enable row level security;

-- SELECT: staff del equipo + admin/coord del club; familia/jugador del equipo
-- solo las compartidas (para el playbook de /mi-equipo).
create policy team_plays_select on public.team_plays
  for select to authenticated
  using (
    public.user_is_staff_of_team(team_id)
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or (shared_with_family and public.user_is_team_member_account(team_id))
  );

-- INSERT: staff del equipo añade jugadas PUBLICADAS del banco a su playbook.
create policy team_plays_insert on public.team_plays
  for insert to authenticated
  with check (
    public.user_is_staff_of_team(team_id)
    and exists (
      select 1 from public.plays p
      where p.id = play_id and p.status = 'published' and p.club_id = club_id
    )
  );

-- UPDATE: staff del equipo togglea shared_with_family.
create policy team_plays_update on public.team_plays
  for update to authenticated
  using (public.user_is_staff_of_team(team_id))
  with check (public.user_is_staff_of_team(team_id));

-- DELETE: staff del equipo quita la jugada de su playbook.
create policy team_plays_delete on public.team_plays
  for delete to authenticated
  using (public.user_is_staff_of_team(team_id));
