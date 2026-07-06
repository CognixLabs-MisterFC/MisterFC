-- F1B-0 — Fundación del rol "director" + "owner único" por club.
--
-- ALCANCE (deliberadamente mínimo): SOLO crea el vocabulario. NADIE gana
-- permisos con esta migración. Ninguna policy de acceso a datos cambia, ningún
-- gate de gestión cambia. El cableado de permisos del director (idéntico a
-- admin) y el gating de "solo el owner administra directores" llegan en F1B-1 y
-- F1B-2 respectivamente. Aislamiento entre clubs: NO se toca user_role_in_club.
--
-- Contiene:
--   1. 'director' añadido al CHECK de memberships.role (6 valores).
--   2. clubs.owner_profile_id (marca de owner, ortogonal al rol).
--   3. Backfill del owner = admin_club del bootstrap (menor created_at).
--   4. Helper user_is_club_owner(club_id) — definido pero NO usado aún.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. memberships.role: añadir 'director'.
--    Recrea el CHECK inline original (20260527111902) + el valor nuevo. El
--    constraint inline se llamó por defecto `memberships_role_check`; lo
--    reemplazamos preservando ese nombre.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.memberships
  drop constraint if exists memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check check (role in (
    'admin_club',
    'director',
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador'
  ));

comment on column public.memberships.role is
  '6 roles. "director" (F1B) = mismo alcance que admin_club en datos (cableado en '
  'F1B-1); NO puede administrar otros directores/admins (F1B-2). "familia" no es '
  'un rol: cuenta familia = profile con rol "jugador" vinculado vía player_accounts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. clubs.owner_profile_id: marca de "owner único" del club.
--    El owner SIGUE siendo un memberships.role='admin_club'; esta columna es una
--    marca ortogonal (identidad), NO un valor de enum. on delete set null: si se
--    borra el profile del owner no se rompe el club (queda sin owner, a re-marcar).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clubs
  add column if not exists owner_profile_id uuid
    references public.profiles(id) on delete set null;

comment on column public.clubs.owner_profile_id is
  'Owner único del club (marca ortogonal al rol; el owner es un admin_club). Solo '
  'el owner puede administrar directores/admins (gating en F1B-2). NULL = sin owner.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill del owner.
--    Criterio: por cada club, owner = el admin_club del bootstrap, definido como
--    la membership con role='admin_club' de MENOR created_at (el primer admin,
--    típicamente el creador del club vía create_club_with_admin). Si un club no
--    tuviera ningún admin_club (no debería ocurrir), queda NULL y se avisa por
--    NOTICE al aplicar.
-- ─────────────────────────────────────────────────────────────────────────────

update public.clubs c
set owner_profile_id = (
  select m.profile_id
  from public.memberships m
  where m.club_id = c.id
    and m.role = 'admin_club'
  order by m.created_at asc, m.id asc
  limit 1
)
where c.owner_profile_id is null;

do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
  from public.clubs
  where owner_profile_id is null;

  if v_orphans > 0 then
    raise notice 'F1B-0: % club(es) sin admin_club → owner_profile_id NULL (revisar).', v_orphans;
  else
    raise notice 'F1B-0: backfill de owner completo, 0 clubs sin owner.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper user_is_club_owner(club_id) — definido, NO usado todavía.
--    Mismo patrón de aislamiento que user_role_in_club: compara SIEMPRE junto a
--    club_id, filtrando por auth.uid(). STABLE SECURITY DEFINER. Su uso en
--    policies/gates es F1B-2.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_is_club_owner(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clubs c
    where c.id = p_club_id
      and c.owner_profile_id = auth.uid()
  );
$$;

comment on function public.user_is_club_owner(uuid) is
  'True si el user actual (auth.uid()) es el owner del club indicado. Filtra '
  'siempre por club_id (aislamiento, como user_role_in_club). F1B-0: definido '
  'pero aún sin uso en policies (el gating de gestión de directores es F1B-2).';
