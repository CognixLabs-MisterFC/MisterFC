-- Subfase 12.1 — Modelo del planificador de SESIONES (cabecera + bloques +
-- tareas) + RLS + trigger + helpers + pgTAP.
--
-- Spec: docs/specs/12.0-planificador-sesiones.md §4. Calca el patrón de
-- `exercises` (F11.1): owner_profile_id forzado por trigger, club_id denormalizado
-- en las hijas (RLS sin joins), inmutabilidad de owner/club, índices por
-- (club_id, …). A diferencia de exercises NO hay máquina de estados (D2):
-- la sesión es de CREACIÓN DIRECTA (trigger simple). La visibilidad jugador/familia
-- (D3) reúsa el patrón de F6 Lote B (team_members + player_accounts).
--
-- Convención: atributos de dominio con clave en inglés y VALORES en español;
-- auditoría en inglés. La validación AUTORITATIVA de objetivos/forma es la capa de
-- app (Zod de @misterfc/core, mismos enums que exercises — D8); el CHECK SQL es
-- ligero (defensa en profundidad), para no duplicar el enum largo en SQL.
--
-- Decisiones tomadas en la implementación (Regla #11):
--   · La SIEMBRA del esqueleto (5 bloques) NO es un trigger: la hace la capa de
--     app (12.2) con buildDefaultSkeleton() de core, para que el clonado de
--     plantillas (12.6) pueda crear una sesión SIN sembrar y copiar sus bloques.
--   · club_id (y session_id en la tabla nieta) se DERIVAN del padre por trigger:
--     las columnas denormalizadas son siempre fiables y la app no puede falsearlas.
--   · Los UNIQUE de orden son DEFERRABLE INITIALLY DEFERRED para permitir
--     reordenar dentro de una transacción (12.2) sin colisiones intermedias.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers de autoridad
-- ─────────────────────────────────────────────────────────────────────────────

-- Quién puede CREAR/EDITAR sesiones del club (calca user_can_create_exercises):
--   admin/coord del club, principal de ALGÚN team del club (team_staff), o staff
--   con la capability can_create_sessions (ayudantes; sembrada desde F1.4).
create or replace function public.user_can_create_sessions(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador')
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
    );
$$;
comment on function public.user_can_create_sessions(uuid) is
  'F12.1 — TRUE si el user puede crear/editar sesiones en el club: admin/coord, principal de algún team, o staff con capability can_create_sessions.';
grant execute on function public.user_can_create_sessions(uuid) to authenticated;

-- ¿El user es jugador/familia del equipo? (D3, calca user_can_see_shared_lineup
-- de F6 Lote B, pero clavado por team_id en vez de event_id).
create or replace function public.user_is_team_member_account(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null and exists (
    select 1
    from public.team_members tm
    join public.player_accounts pa on pa.player_id = tm.player_id
    where tm.team_id = p_team_id
      and tm.left_at is null
      and pa.profile_id = auth.uid()
  );
$$;
comment on function public.user_is_team_member_account(uuid) is
  'F12.1 — TRUE si el user está vinculado (player_accounts) a un jugador del roster activo del team. Expone las sesiones visibility=team a jugadores y familias.';
grant execute on function public.user_is_team_member_account(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla: sessions — cabecera de la sesión (o plantilla si is_template — D5).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.sessions (
  id                   uuid primary key default gen_random_uuid(),
  owner_profile_id     uuid not null references public.profiles(id) on delete cascade,
  club_id              uuid not null references public.clubs(id)    on delete cascade,
  team_id              uuid references public.teams(id) on delete set null,   -- equipo destino
  is_template          boolean not null default false,                        -- D5
  session_date         date,                                                  -- NULL si is_template
  title                text check (title is null or char_length(title) between 1 and 120),
  objective_physical   text,                                                  -- D8 (libre)
  -- Objetivos: MISMO vocabulario que exercises (D8). Validación autoritativa = Zod
  -- de core; aquí solo se garantiza array no nulo (CHECK ligero, sin duplicar enum).
  tactical_objectives  text[] not null default '{}',
  technical_objectives text[] not null default '{}',
  mesocycle            text,                                                  -- D7 (libre)
  microcycle           text,                                                  -- D7 (libre)
  total_minutes        smallint check (total_minutes is null or total_minutes >= 0),
  event_id             uuid references public.events(id) on delete set null,  -- D4 (training, nullable)
  visibility           text not null default 'staff'
                         check (visibility in ('staff', 'team')),             -- D3
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Coherencia plantilla↔fecha (D5): una sesión real tiene fecha; una plantilla no.
  constraint sessions_template_date_chk check (
    (is_template and session_date is null)
    or (not is_template and session_date is not null)
  ),
  -- Una plantilla no se ata a un evento ni se publica a un equipo (solo staff).
  constraint sessions_template_no_event_chk check (not is_template or event_id is null),
  constraint sessions_template_staff_chk check (not is_template or visibility = 'staff')
);

comment on table public.sessions is
  'F12 — sesión de entrenamiento del club (o plantilla si is_template). Creación directa, sin ciclo de aprobación (D2). visibility staff|team (D3).';

create index sessions_club_team_date_idx on public.sessions (club_id, team_id, session_date);
create index sessions_owner_idx on public.sessions (owner_profile_id);
create index sessions_club_template_idx on public.sessions (club_id) where is_template;
create index sessions_event_idx on public.sessions (event_id) where event_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla: session_blocks — bloques ordenados (esqueleto sembrado por la app — D1).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.session_blocks (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  club_id     uuid not null references public.clubs(id) on delete cascade,   -- denorm (RLS), derivado por trigger
  block_type  text not null check (block_type in
                ('calentamiento', 'complementaria', 'principal', 'vuelta_a_la_calma')), -- D1
  title       text check (title is null or char_length(title) between 1 and 120),
  notes       text,
  order_idx   smallint not null,
  constraint session_blocks_order_uniq unique (session_id, order_idx)
    deferrable initially deferred
);

comment on table public.session_blocks is
  'F12 — bloques de una sesión (catálogo fijo D1). order_idx ordena; club_id se deriva del padre por trigger.';

create index session_blocks_session_idx on public.session_blocks (session_id);
create index session_blocks_club_idx on public.session_blocks (club_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla: session_block_exercises — join con OVERRIDE DEL DÍA (no va en el ejercicio).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.session_block_exercises (
  id           uuid primary key default gen_random_uuid(),
  block_id     uuid not null references public.session_blocks(id) on delete cascade,
  session_id   uuid not null references public.sessions(id) on delete cascade,  -- denorm, derivado por trigger
  club_id      uuid not null references public.clubs(id) on delete cascade,     -- denorm (RLS), derivado por trigger
  exercise_id  uuid not null references public.exercises(id) on delete restrict,
  order_idx    smallint not null,
  duration_min smallint check (duration_min is null or duration_min >= 0),  -- "18 min" (del día)
  series       text check (series is null or char_length(series) <= 60),    -- "2 x 8'" (del día)
  notes        text,                                                        -- ajuste del día
  constraint session_block_exercises_order_uniq unique (block_id, order_idx)
    deferrable initially deferred
);

comment on table public.session_block_exercises is
  'F12 — tareas de un bloque: ejercicio + override del día (duración/series/notas). session_id y club_id se derivan del bloque por trigger.';

create index session_block_exercises_block_idx on public.session_block_exercises (block_id);
create index session_block_exercises_session_idx on public.session_block_exercises (session_id);
create index session_block_exercises_club_idx on public.session_block_exercises (club_id);
create index session_block_exercises_exercise_idx on public.session_block_exercises (exercise_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers: owner forzado + inmutabilidad (D2, sin máquina de estados); las hijas
-- derivan club_id/session_id del padre (denorm fiable).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sessions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_profile_id := auth.uid();
    end if;
  else  -- UPDATE
    if new.owner_profile_id is distinct from old.owner_profile_id then
      raise exception 'owner_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_sessions_validate
  before insert or update on public.sessions
  for each row execute function public.sessions_validate();

-- session_blocks: deriva club_id del padre; bloquea recolgar de otra sesión.
create or replace function public.session_blocks_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select club_id into v_club from public.sessions where id = new.session_id;
  if v_club is null then
    raise exception 'session_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;

  if tg_op = 'UPDATE' and new.session_id is distinct from old.session_id then
    raise exception 'session_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_session_blocks_validate
  before insert or update on public.session_blocks
  for each row execute function public.session_blocks_validate();

-- session_block_exercises: deriva session_id y club_id del bloque; inmutabilidad.
create or replace function public.session_block_exercises_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_club uuid;
begin
  select session_id, club_id into v_session, v_club
    from public.session_blocks where id = new.block_id;
  if v_session is null then
    raise exception 'block_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.session_id := v_session;
  new.club_id := v_club;

  if tg_op = 'UPDATE' and new.block_id is distinct from old.block_id then
    raise exception 'block_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_session_block_exercises_validate
  before insert or update on public.session_block_exercises
  for each row execute function public.session_block_exercises_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers de visibilidad/edición (SECURITY DEFINER → centralizan el predicado y
-- las hijas lo heredan sin recursión de RLS).
-- ─────────────────────────────────────────────────────────────────────────────

-- ¿Puede el user VER esta sesión? Staff del club siempre; jugador/familia solo si
-- la sesión NO es plantilla, visibility='team' y pertenece al team_id (D3).
create or replace function public.user_can_see_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and (
        public.user_role_in_club(s.club_id) in
          ('admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
        or (
          not s.is_template
          and s.visibility = 'team'
          and public.user_is_team_member_account(s.team_id)
        )
      )
  );
$$;
comment on function public.user_can_see_session(uuid) is
  'F12.1 — TRUE si el user puede ver la sesión: cualquier staff del club, o jugador/familia del team_id si visibility=team y no es plantilla. Lo usan las RLS de las hijas.';
grant execute on function public.user_can_see_session(uuid) to authenticated;

-- ¿Puede el user EDITAR esta sesión (y sus hijas)? Owner∪admin con autoridad de
-- creación en el club.
create or replace function public.user_can_edit_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and public.user_can_create_sessions(s.club_id)
      and (s.owner_profile_id = auth.uid()
           or public.user_role_in_club(s.club_id) = 'admin_club')
  );
$$;
comment on function public.user_can_edit_session(uuid) is
  'F12.1 — TRUE si el user puede editar la sesión y sus hijas: owner o admin del club, con autoridad de creación. Lo usan las RLS de las hijas.';
grant execute on function public.user_can_edit_session(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — sessions
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.sessions enable row level security;

-- SELECT: staff del club ve todo (incl. plantillas); jugador/familia solo las
-- sesiones de su team con visibility='team'.
create policy sessions_select on public.sessions
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in
      ('admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
    or (
      not is_template
      and visibility = 'team'
      and public.user_is_team_member_account(team_id)
    )
  );

-- INSERT: para uno mismo, con autoridad de creación en el club.
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_can_create_sessions(club_id)
  );

-- UPDATE: el owner, o el admin del club.
create policy sessions_update on public.sessions
  for update to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
  )
  with check (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
  );

-- DELETE: el owner, o el admin del club.
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — session_blocks (heredan visibilidad/edición del padre)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.session_blocks enable row level security;

create policy session_blocks_select on public.session_blocks
  for select to authenticated
  using (public.user_can_see_session(session_id));

create policy session_blocks_insert on public.session_blocks
  for insert to authenticated
  with check (public.user_can_edit_session(session_id));

create policy session_blocks_update on public.session_blocks
  for update to authenticated
  using (public.user_can_edit_session(session_id))
  with check (public.user_can_edit_session(session_id));

create policy session_blocks_delete on public.session_blocks
  for delete to authenticated
  using (public.user_can_edit_session(session_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — session_block_exercises (heredan del padre vía session_id denorm)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.session_block_exercises enable row level security;

create policy session_block_exercises_select on public.session_block_exercises
  for select to authenticated
  using (public.user_can_see_session(session_id));

create policy session_block_exercises_insert on public.session_block_exercises
  for insert to authenticated
  with check (public.user_can_edit_session(session_id));

create policy session_block_exercises_update on public.session_block_exercises
  for update to authenticated
  using (public.user_can_edit_session(session_id))
  with check (public.user_can_edit_session(session_id));

create policy session_block_exercises_delete on public.session_block_exercises
  for delete to authenticated
  using (public.user_can_edit_session(session_id));
