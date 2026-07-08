-- F7B-P1 — "Seguir equipos": tabla team_follows + RLS.
--
-- Decisión de producto (Jose): CUALQUIER miembro del club puede SEGUIR CUALQUIER
-- equipo de SU club. Seguir = recibir push de GOLES de ese equipo (fan-out en el
-- momento del gol de NUESTRO equipo, side='own'). NO afecta a lo que ve: la
-- pantalla Directos (F7B-2) es abierta a todo el club.
--
-- Modelo mínimo: una fila por (usuario, equipo). RLS estricta:
--   · cada usuario gestiona SOLO sus propias filas (profile_id = auth.uid());
--   · y SOLO puede seguir equipos de SU club (aislamiento entre clubs).
-- El fan-out del gol lee los seguidores con service_role (cruza usuarios), así
-- que la RLS aquí es solo la superficie de gestión del propio usuario.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper: ¿el user pertenece al club del equipo? (aislamiento por club).
--    teams.club_id está denormalizado (rework A1) → se usa directo. SECURITY
--    DEFINER para no depender de la RLS de teams; el filtro real lo da
--    user_role_in_club(club), que es NULL para un miembro de otro club.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_belongs_to_team_club(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.teams t
     where t.id = p_team_id
       and public.user_role_in_club(t.club_id) is not null
  );
$$;

comment on function public.user_belongs_to_team_club(uuid) is
  'F7B-P1 — TRUE si el user actual es miembro del club del equipo (teams.club_id). '
  'Para restringir team_follows a equipos del propio club. Aislamiento vía '
  'user_role_in_club(club) filtrado por auth.uid().';

grant execute on function public.user_belongs_to_team_club(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. team_follows — una fila por (usuario, equipo) seguido.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.team_follows (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  team_id     uuid not null references public.teams(id)    on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, team_id)
);

comment on table public.team_follows is
  'F7B-P1 — equipos que un usuario SIGUE para recibir push de goles. '
  'PK(profile_id, team_id). RLS: solo filas propias y solo equipos del propio club.';

create index team_follows_team_idx on public.team_follows (team_id);

alter table public.team_follows enable row level security;

-- SELECT: solo las filas propias.
create policy team_follows_select_own on public.team_follows
  for select to authenticated
  using (profile_id = auth.uid());

-- INSERT: fila propia + solo equipos del propio club (aislamiento).
create policy team_follows_insert_own on public.team_follows
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and public.user_belongs_to_team_club(team_id)
  );

-- DELETE: solo las filas propias (dejar de seguir).
create policy team_follows_delete_own on public.team_follows
  for delete to authenticated
  using (profile_id = auth.uid());

-- (Sin UPDATE: seguir/dejar de seguir es insert/delete.)
