-- F8.1 — Modelo de valoraciones (partido y entrenamiento).
--
-- Spec: docs/specs/8.0-valoraciones.md §3 (ciclo/estado), §5 (modelo + trigger), §6 (RLS).
--
-- Contenido:
--   1. evaluations            — valoración subjetiva por (event_id, player_id). rating 1-10
--                               NULLABLE; obligatorio a NIVEL DE FILA en partido
--                               (match/friendly/tournament), opcional en entreno (training).
--                               comment VISIBLE; is_mvp (único por evento); created_by forzado.
--   2. evaluation_private_notes — nota PRIVADA del staff, tabla aparte (column-leak safe,
--                               patrón lineup_tactical_notes F6.9). Nunca a jugador/familia.
--   3. club_settings          — config por club (1 fila/club). evaluations_player_visibility.
--   4. match_state.post_match_done — marca aditiva de "etapa post-partido completada"
--                               (nodo "cerrado" del ciclo). status='closed' = FINALIZADO;
--                               post_match_done=true = ciclo cerrado. Reset a false al reabrir.
--   5. Helpers SECURITY DEFINER (sin recursión): user_is_account_of_player,
--      club_evaluations_visible. Reusa user_can_record_match (F7), match_assert_player_in_team.
--   6. RLS de las tres tablas (§6).
--
-- NOTA DE DISEÑO — por qué evaluations NO usa match_assert_event():
--   match_assert_event() (F7) RECHAZA eventos que no sean match/friendly. F8 valora también
--   ENTRENAMIENTOS, así que el trigger deriva club_id/team_id/event_type directo de `events`
--   y reusa solo match_assert_player_in_team (que valida roster+club, sin mirar el tipo).
--
-- NOTA DE DISEÑO — nota privada en tabla aparte (lección column-leak F6.9):
--   La RLS de Postgres filtra FILAS, no COLUMNAS. La fila de `evaluations` se amplía en
--   lectura a jugador/familia (visibilidad por club). Si la nota privada fuera una columna,
--   el jugador la leería con un GET REST directo. Aislada en su tabla solo-staff, no se filtra.
--
-- NOTA — MVCC (lección NIDO): los helpers de las policies leen events/team_*/player_accounts/
--   club_settings; ninguna de esas tablas la mutan los INSERT a evaluations/private_notes →
--   el RETURNING * pasa la policy SELECT sin tropezar.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. club_settings — configuración por club (D5). Va primero porque el helper
--    club_evaluations_visible() la referencia en su cuerpo.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.club_settings (
  club_id                       uuid primary key references public.clubs(id) on delete cascade,
  evaluations_player_visibility boolean not null default false,  -- D4: OFF por defecto (opt-in)
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

comment on table public.club_settings is
  'F8 — ajustes por club (una fila por club, pensada para crecer). evaluations_player_visibility: si TRUE, jugador/familia ven nota+comentario+MVP de SUS valoraciones. Default false = privacidad por defecto (D4). Solo el admin del club lo modifica (D10). Ver ADR-0014.';

create trigger trg_club_settings_updated_at
  before update on public.club_settings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- ¿el user actual es la cuenta (jugador self, o familia parent/guardian) de ESTE jugador?
-- Player-scoped: a diferencia de user_can_see_shared_lineup, restringe al jugador concreto
-- (la familia de un jugador NO ve la valoración de sus compañeros).
create or replace function public.user_is_account_of_player(p_player_id uuid)
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

comment on function public.user_is_account_of_player(uuid) is
  'F8 — TRUE si el user actual está vinculado (player_accounts: self/parent/guardian) a ESTE jugador. Player-scoped (no a nivel de equipo). SECURITY DEFINER para la RLS de evaluations sin recursión.';

-- ¿el club tiene activada la visibilidad de valoraciones para jugador/familia?
-- Sin fila en club_settings = false (privacidad por defecto, D4).
create or replace function public.club_evaluations_visible(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select evaluations_player_visibility from public.club_settings where club_id = p_club_id),
    false
  );
$$;

comment on function public.club_evaluations_visible(uuid) is
  'F8 — TRUE si el club tiene evaluations_player_visibility=true. Sin fila en club_settings = false (D4, opt-in). SECURITY DEFINER para usarse en la RLS de evaluations sin acoplar la policy a club_settings.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. evaluations — la valoración (unificada partido + entreno)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.evaluations (
  event_id    uuid not null references public.events(id)  on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  club_id     uuid not null references public.clubs(id)   on delete cascade,  -- DERIVADO en trigger
  team_id     uuid not null references public.teams(id)   on delete cascade,  -- DERIVADO en trigger
  event_type  text not null,   -- DERIVADO de events.type; filtra/indexa partido vs entreno

  rating      smallint check (rating is null or rating between 1 and 10),  -- nullable; obligatoriedad por trigger
  comment     text     check (comment is null or char_length(comment) between 1 and 2000),  -- VISIBLE
  is_mvp      boolean  not null default false,

  created_by  uuid not null references public.profiles(id),  -- forzado a auth.uid() en trigger
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (event_id, player_id)
);

comment on table public.evaluations is
  'F8 — valoración subjetiva de un jugador en un evento (partido o entrenamiento). Una fila por (event_id, player_id). rating 1-10 obligatorio a NIVEL DE FILA en partido (match/friendly/tournament), opcional en entreno (training); por trigger. comment VISIBLE a jugador/familia si club_settings lo activa. is_mvp único por evento. Nota PRIVADA aparte (evaluation_private_notes). No se mezcla con match_player_stats. Valorar no es obligatorio para cerrar (D6).';

-- A lo sumo un MVP por evento (D9).
create unique index evaluations_one_mvp_per_event
  on public.evaluations (event_id) where is_mvp;

-- Lecturas: por jugador (perfil F9) y por evento+tipo.
create index evaluations_player_idx     on public.evaluations (player_id, created_at desc);
create index evaluations_event_type_idx on public.evaluations (event_type, event_id);

-- Validación/derivación.
create or replace function public.evaluations_validate()
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

  new.club_id    := v_event.club_id;  -- derivado, autoritativo
  new.team_id    := v_event.team_id;  -- derivado, autoritativo
  new.event_type := v_event.type;     -- derivado, autoritativo

  -- el jugador pertenece al club del evento y al roster del team a la fecha (reusa F7).
  perform public.match_assert_player_in_team(new.player_id, v_event);

  -- D8: en partido (match/friendly/tournament) la fila DEBE llevar número. A nivel de FILA,
  -- no de partido: cerrar el partido no exige valorar a todos (D6). Consecuencia: en partido
  -- no se admite fila con solo comentario o solo MVP sin rating.
  if new.event_type in ('match', 'friendly', 'tournament') and new.rating is null then
    raise exception 'rating_required_for_match' using errcode = 'check_violation';
  end if;

  -- No crear valoraciones vacías (en entreno, al menos un campo con contenido).
  if new.rating is null
     and (new.comment is null or char_length(trim(new.comment)) = 0)
     and new.is_mvp = false then
    raise exception 'empty_evaluation' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();  -- forzado
    end if;
  else
    if new.event_id is distinct from old.event_id
       or new.player_id is distinct from old.player_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'immutable_field' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_evaluations_validate
  before insert or update on public.evaluations
  for each row execute function public.evaluations_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. evaluation_private_notes — nota privada del staff (column-leak safe)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.evaluation_private_notes (
  event_id   uuid not null,
  player_id  uuid not null,
  note       text not null check (char_length(note) between 1 and 2000),
  created_by uuid not null references public.profiles(id),  -- forzado a auth.uid() en trigger
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (event_id, player_id),
  foreign key (event_id, player_id)
    references public.evaluations (event_id, player_id) on delete cascade
);

comment on table public.evaluation_private_notes is
  'F8 — nota PRIVADA del cuerpo técnico ligada a una valoración (este evento). Tabla aparte a propósito: la RLS de Postgres no filtra columnas; aislarla evita que el jugador la lea por GET REST cuando la fila de evaluations se comparte. Nunca expuesta a jugador/familia. Distinta de player_notes (7.13, transversal al jugador).';

create or replace function public.evaluation_private_notes_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();  -- forzado
    end if;
  else
    if new.event_id is distinct from old.event_id
       or new.player_id is distinct from old.player_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'immutable_field' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_evaluation_private_notes_validate
  before insert or update on public.evaluation_private_notes
  for each row execute function public.evaluation_private_notes_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. match_state.post_match_done — cierre del ciclo (aditivo sobre F7, §3.5)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.match_state
  add column if not exists post_match_done boolean not null default false;

comment on column public.match_state.post_match_done is
  'F8 — TRUE cuando el staff ha completado/cerrado la etapa de valoraciones (nodo "cerrado" del ciclo). status="closed" = partido FINALIZADO (pitido, stats materializadas, post-partido abierto); post_match_done=true = ciclo terminado. Se resetea a false al reabrir (status vuelve a live). No bloquea: cerrar no exige valorar a todos (D6).';

-- Al reabrir (status vuelve a 'live'), el ciclo deja de estar cerrado.
create or replace function public.match_state_reset_post_match()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'live' and old.status is distinct from 'live' then
    new.post_match_done := false;
  end if;
  return new;
end;
$$;

create trigger trg_match_state_reset_post_match
  before update on public.match_state
  for each row execute function public.match_state_reset_post_match();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- 6.1 evaluations — staff CRUD (user_can_record_match); jugador/familia SELECT condicionado.
alter table public.evaluations enable row level security;

create policy evaluations_insert on public.evaluations
  for insert to authenticated with check (public.user_can_record_match(event_id));

create policy evaluations_update on public.evaluations
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));

create policy evaluations_delete on public.evaluations
  for delete to authenticated using (public.user_can_record_match(event_id));

create policy evaluations_select on public.evaluations
  for select to authenticated using (
    public.user_can_record_match(event_id)
    or (
      public.user_is_account_of_player(player_id)   -- su jugador (D2: familia = jugador)
      and public.club_evaluations_visible(club_id)   -- club opt-in (D4)
    )
  );

-- 6.2 evaluation_private_notes — SOLO staff. Nunca ampliada a jugador/familia.
alter table public.evaluation_private_notes enable row level security;

create policy evaluation_private_notes_all on public.evaluation_private_notes
  for all to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));

-- 6.3 club_settings — lee admin+coord; ESCRIBE solo admin (D10).
alter table public.club_settings enable row level security;

create policy club_settings_select on public.club_settings
  for select to authenticated
  using (public.user_role_in_club(club_id) in ('admin_club', 'coordinador'));

create policy club_settings_write on public.club_settings
  for all to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club')
  with check (public.user_role_in_club(club_id) = 'admin_club');
