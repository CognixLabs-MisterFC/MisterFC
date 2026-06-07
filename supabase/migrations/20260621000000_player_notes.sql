-- F7 (mejora) — Notas por jugador (persistentes, equipo propio).
--
-- Spec: docs/specs (mejora pre-cierre F7).
--
-- Permite al cuerpo técnico anotar observaciones de un jugador del equipo (rápido,
-- mejora en X, actitud…). La nota es PERSISTENTE y asociada al JUGADOR (no a un
-- partido concreto), consultable/editable desde la ficha. Opcionalmente guarda el
-- partido de origen (match_event_id) cuando se crea desde /directo.
--
-- Visibilidad: SOLO cuerpo técnico (principal+ayudante) / admin / coord. NO el
-- jugador ni la familia. Se resuelve con un helper SECURITY DEFINER
-- (user_can_access_player_notes) — patrón del fix de recursión de team_staff: la
-- RLS de player_notes NO lee team_staff/team_members directamente (lo hace el
-- helper bajo definer), evitando recursión.

-- Helper: ¿el user actual es cuerpo técnico del jugador? admin/coord del club del
-- jugador, o team_staff ACTIVO (principal o ayudante) de algún equipo ACTUAL del
-- jugador. SECURITY DEFINER → no recursa con la RLS de team_staff/team_members.
create or replace function public.user_can_access_player_notes(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        public.user_role_in_club(p.club_id) in ('admin_club', 'coordinador')
        or exists (
          select 1
          from public.team_members tm
          join public.team_staff ts
            on ts.team_id = tm.team_id and ts.left_at is null
          join public.memberships m on m.id = ts.membership_id
          where tm.player_id = p_player_id
            and tm.left_at is null
            and m.profile_id = auth.uid()
        )
      )
  );
$$;

comment on function public.user_can_access_player_notes(uuid) is
  'TRUE si el user es cuerpo técnico del jugador: admin/coord del club, o team_staff activo (principal/ayudante) de un equipo actual del jugador. SECURITY DEFINER para usarse en la RLS de player_notes sin recursión con team_staff/team_members. NO incluye jugador/familia.';

-- Tabla de notas por jugador.
create table public.player_notes (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references public.players(id) on delete cascade,
  club_id           uuid not null references public.clubs(id) on delete cascade,   -- DERIVADO en trigger
  team_id           uuid references public.teams(id) on delete set null,            -- opcional
  match_event_id    uuid references public.events(id) on delete set null,           -- opcional: partido de origen
  author_profile_id uuid not null references public.profiles(id),                   -- forzado a auth.uid() en trigger
  note              text not null check (char_length(note) between 1 and 2000),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.player_notes is
  'F7 mejora — notas del cuerpo técnico sobre un jugador (persistentes, asociadas al jugador, no a un partido). Visibles solo a staff/admin/coord (RLS user_can_access_player_notes). match_event_id opcional = partido de origen.';

create index player_notes_player_idx on public.player_notes (player_id, created_at desc);

-- Validación/derivación: club_id desde el jugador; author = auth.uid(); inmutables
-- player_id/author/created. updated_at en cada UPDATE.
create or replace function public.player_notes_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.players where id = new.player_id;
  if v_club is null then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;  -- derivado, autoritativo

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.author_profile_id := auth.uid();
    end if;
  else
    if new.id is distinct from old.id
       or new.player_id is distinct from old.player_id
       or new.author_profile_id is distinct from old.author_profile_id
       or new.created_at is distinct from old.created_at then
      raise exception 'immutable_field' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_player_notes_validate
  before insert or update on public.player_notes
  for each row execute function public.player_notes_validate();

-- RLS — solo cuerpo técnico del jugador (helper definer). Misma autoridad para
-- leer/crear/editar/borrar (el club es pequeño; la lista muestra autor + fecha).
alter table public.player_notes enable row level security;

create policy player_notes_select on public.player_notes
  for select to authenticated using (public.user_can_access_player_notes(player_id));
create policy player_notes_insert on public.player_notes
  for insert to authenticated with check (public.user_can_access_player_notes(player_id));
create policy player_notes_update on public.player_notes
  for update to authenticated
  using (public.user_can_access_player_notes(player_id))
  with check (public.user_can_access_player_notes(player_id));
create policy player_notes_delete on public.player_notes
  for delete to authenticated using (public.user_can_access_player_notes(player_id));
