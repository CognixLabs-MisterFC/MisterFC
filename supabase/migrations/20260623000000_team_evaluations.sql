-- F8.3 — Valoración COLECTIVA del partido (coexiste con la individual).
--
-- Spec: docs/specs/8.0-valoraciones.md §3.6 (D11) + §5.4.
--
-- Una valoración del EQUIPO por partido (PK event_id), independiente de las
-- valoraciones individuales (`evaluations`, 8.1/8.2): conviven, ninguna sustituye
-- a la otra. El jugador/familia ven AMBAS. A diferencia de la individual, la
-- lectura de la colectiva es TEAM-scoped (la ve todo el equipo del partido), no
-- player-scoped.
--
-- Reusa los helpers de 8.1/F6/F7 (sin recursión):
--   · user_can_record_match(event_id)     → staff CRUD (admin/coord o team_staff).
--   · user_can_see_shared_lineup(event_id) → jugador/familia del equipo del evento.
--   · club_evaluations_visible(club_id)    → opt-in de visibilidad por club (D4).

create table public.team_evaluations (
  event_id    uuid primary key references public.events(id) on delete cascade,
  club_id     uuid not null references public.clubs(id) on delete cascade,  -- DERIVADO en trigger
  team_id     uuid not null references public.teams(id) on delete cascade,  -- DERIVADO en trigger
  rating      smallint not null check (rating between 1 and 10),            -- OBLIGATORIO (no nullable)
  comment     text     check (comment is null or char_length(comment) between 1 and 2000),
  created_by  uuid not null references public.profiles(id),                 -- forzado a auth.uid()
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.team_evaluations is
  'F8.3 — valoración COLECTIVA del equipo en un partido (una fila por event_id). rating 1-10 obligatorio + comment. Coexiste con evaluations (individual), no la sustituye. Lectura jugador/familia TEAM-scoped (user_can_see_shared_lineup) si el club activa la visibilidad. Solo partidos (match/friendly/tournament).';

-- Validación/derivación (mismo patrón que evaluations).
create or replace function public.team_evaluations_validate()
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
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;
  -- La valoración colectiva es SOLO de partidos (no entrenos).
  if v_event.type not in ('match', 'friendly', 'tournament') then
    raise exception 'event_not_a_match' using errcode = 'check_violation';
  end if;

  new.club_id := v_event.club_id;  -- derivado, autoritativo
  new.team_id := v_event.team_id;  -- derivado, autoritativo

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();  -- forzado
    end if;
  else
    if new.event_id is distinct from old.event_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'immutable_field' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_team_evaluations_validate
  before insert or update on public.team_evaluations
  for each row execute function public.team_evaluations_validate();

-- RLS — staff CRUD; lectura jugador/familia TEAM-scoped condicionada al flag de club.
alter table public.team_evaluations enable row level security;

create policy team_evaluations_insert on public.team_evaluations
  for insert to authenticated with check (public.user_can_record_match(event_id));

create policy team_evaluations_update on public.team_evaluations
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));

create policy team_evaluations_delete on public.team_evaluations
  for delete to authenticated using (public.user_can_record_match(event_id));

create policy team_evaluations_select on public.team_evaluations
  for select to authenticated using (
    public.user_can_record_match(event_id)
    or (
      public.user_can_see_shared_lineup(event_id)  -- todo el equipo (team-scoped, D11)
      and public.club_evaluations_visible(club_id)  -- club opt-in (D4)
    )
  );
