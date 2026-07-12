-- F14C-1 — BASE del SEGUIDOR / ESPECTADOR (tabla player_spectators).
--
-- ALCANCE (deliberadamente mínimo, patrón F14B-1 / F1B-0): SOLO crea el
-- vocabulario del seguidor. NADIE gana acceso a nada con esta migración. No se
-- toca player_accounts (ni su relation), ni ninguna política RLS de datos
-- deportivos/sensibles, ni ningún RPC de invitación. Los dos helpers se crean
-- pero NO los llama nadie todavía (latentes): F14C-3 los cableará en la RLS de
-- acceso deportivo, F14C-4 usará is_spectator() para la vista reducida del shell.
--
-- DECISIÓN DE ARQUITECTURA (cerrada por Jose): el seguidor vive en tabla APARTE,
-- NO en player_accounts. Estar en player_accounts es lo que hoy concede caminos a
-- datos sensibles (médica F14-6, contacto, consentimientos) porque múltiples
-- helpers (user_is_account_of_player, user_owns_player_account,
-- user_is_team_member_account) y la RLS de chat matchean CUALQUIER fila de
-- player_accounts sin mirar relation. Tabla separada = el seguidor arranca con
-- acceso CERO y solo verá lo que una policy nueva y explícita le conceda (F14C-3).
--
-- MODELO (Jose): un seguidor (una persona/cuenta) puede seguir a VARIOS jugadores
-- (abuelo con 2 nietos = una cuenta, varias filas). Relación muchos-a-muchos
-- (spectator_profile_id, player_id); una fila liga a UN jugador; solo lectura.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla player_spectators
-- ─────────────────────────────────────────────────────────────────────────────

create table public.player_spectators (
  id                    uuid primary key default gen_random_uuid(),
  spectator_profile_id  uuid not null references public.profiles(id) on delete cascade,
  player_id             uuid not null references public.players(id) on delete cascade,
  invited_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (spectator_profile_id, player_id)
);

comment on table public.player_spectators is
  'F14C — Seguidores/espectadores privados (abuelos, familiares). Rol de SOLO '
  'LECTURA ligado a un jugador: ve lo deportivo-PÚBLICO (agenda, directos, stats, '
  'como un jugador) y NADA privado (médica, contacto, consentimientos, chats). '
  'Vive en tabla APARTE por diseño: NO es player_accounts, así que NO hereda '
  'ninguno de los caminos de acceso de la familia. Muchos-a-muchos: una persona '
  'puede seguir a varios jugadores (una fila por jugador). Vocabulario latente en '
  'F14C-1; el acceso deportivo lo concede la RLS de F14C-3.';
comment on column public.player_spectators.invited_by_profile_id is
  'Quién invitó al seguidor (tutor del jugador o el propio jugador). NULL si el '
  'perfil que invitó se borra.';

alter table public.player_spectators enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper is_spectator_of_player(player) — latente (lo cablea F14C-3).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_spectator_of_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.player_spectators ps
    where ps.player_id = p_player_id
      and ps.spectator_profile_id = auth.uid()
  );
$$;

comment on function public.is_spectator_of_player(uuid) is
  'F14C-1 — TRUE si el user actual (auth.uid()) es seguidor/espectador del jugador '
  'indicado (existe fila en player_spectators). LATENTE en F14C-1: no lo llama '
  'nadie; F14C-3 lo usará en la RLS de acceso deportivo. SECURITY DEFINER para '
  'evitar recursión de RLS al leer su propia tabla.';

revoke all on function public.is_spectator_of_player(uuid) from public;
grant execute on function public.is_spectator_of_player(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper is_spectator() — ¿el user actual sigue a ALGÚN jugador? (shell F14C-4)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_spectator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.player_spectators ps
    where ps.spectator_profile_id = auth.uid()
  );
$$;

comment on function public.is_spectator() is
  'F14C-1 — TRUE si el user actual es seguidor/espectador de algún jugador. '
  'LATENTE en F14C-1; F14C-4 (shell) lo usará para dar la vista reducida del '
  'espectador. SECURITY DEFINER (corre como owner, exento de RLS).';

revoke all on function public.is_spectator() from public;
grant execute on function public.is_spectator() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS de player_spectators (mínima y conservadora).
--    SELECT: el propio seguidor ve sus filas; y quien GESTIONA al jugador (tutor
--    parent/guardian, el propio jugador 'self', y admin/director del club —
--    superadmin incluido por la cascada de user_role_in_club) ve los seguidores
--    de ESE jugador. NADA más.
--    Sin policies de INSERT/UPDATE/DELETE de cliente: la escritura se gestiona por
--    RPC/invitación (SECURITY DEFINER, F14C-2 / F14C-5). RLS activa sin policy de
--    escritura = ningún cliente escribe.
--    IMPORTANTE: esta policy NO concede, por sí sola, acceso a players,
--    player_medical, consents, events, etc. Es solo la visibilidad del vínculo.
-- ─────────────────────────────────────────────────────────────────────────────

create policy player_spectators_select on public.player_spectators
  for select to authenticated
  using (
    spectator_profile_id = auth.uid()
    or public.user_is_tutor_of_player(player_id)
    or exists (
      select 1 from public.player_accounts pa
      where pa.player_id = player_spectators.player_id
        and pa.profile_id = auth.uid()
        and pa.relation = 'self'
    )
    or public.user_is_admin_or_director(
      (select p.club_id from public.players p where p.id = player_spectators.player_id)
    )
  );
