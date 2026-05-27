-- Subfase 1.2 — Profiles y memberships con 5 roles
--
-- Modelo:
--   auth.users (Supabase Auth) ──1:1── profiles (datos visibles, no auth)
--   profiles ──N:M── clubs vía memberships (1 fila = 1 rol del user en 1 club)
--
-- 5 roles: admin_club, coordinador, entrenador_principal, entrenador_ayudante, jugador.
-- El rol "familia" (decisión del plan) está fusionado con "jugador": un jugador puede
-- tener N cuentas vinculadas (self, parent, guardian) — se modela en 1.3 vía player_accounts.
--
-- Trigger handle_new_user: cada fila nueva en auth.users crea automáticamente la
-- fila en public.profiles. Sin esto, el cliente tendría que recordar crearla.

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────────────────────

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text check (full_name is null or char_length(full_name) between 1 and 120),
  avatar_url      text check (avatar_url is null or avatar_url ~ '^https?://'),
  locale          text not null default 'es' check (locale in ('es', 'en', 'va')),
  date_of_birth   date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.profiles is
  'Datos del usuario visibles dentro de la app. PK = auth.users.id. Sin email aquí: lo tiene auth.users.';
comment on column public.profiles.date_of_birth is
  'Necesario para diferenciar menores (RGPD, Fase 14). Opcional en profiles, obligatorio en players.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: al crear un user en auth.users, crear su profile automáticamente
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, locale)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), ''),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    coalesce(new.raw_user_meta_data->>'locale', 'es')
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Crea fila en public.profiles cuando se inserta una en auth.users. Idempotente vía PK.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- memberships
-- ─────────────────────────────────────────────────────────────────────────────

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  club_id     uuid not null references public.clubs(id) on delete cascade,
  role        text not null check (role in (
    'admin_club',
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador'
  )),
  created_at  timestamptz not null default now(),
  unique (profile_id, club_id)
);

comment on table public.memberships is
  'Pertenencia de un profile a un club con un rol concreto. Único por (profile_id, club_id).';
comment on column public.memberships.role is
  '5 roles. "familia" no existe como rol propio: una cuenta familia es un profile con rol "jugador" vinculado vía player_accounts (1.3).';

create index memberships_club_idx on public.memberships (club_id);
create index memberships_profile_idx on public.memberships (profile_id);

alter table public.memberships enable row level security;
