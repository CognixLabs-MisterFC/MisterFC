-- F14B-1 — Fundación del rol SUPERADMIN (operador de plataforma).
--
-- ALCANCE (deliberadamente mínimo, patrón F1B-0): SOLO crea el vocabulario.
-- NADIE gana permisos con esta migración. No se toca user_role_in_club, ni
-- ninguna política RLS, ni ningún RPC, ni ninguna tabla existente. El helper
-- is_superadmin() se crea pero NO lo llama nadie todavía: el cableado del acceso
-- transversal (is_superadmin dentro de user_role_in_club) es F14B-2.
--
-- El superadmin es un operador de PLATAFORMA transversal: NO es un rol de club,
-- NO va en memberships, NO cuenta en el conteo de usuarios de ningún club.
--
-- Contiene:
--   1. Tabla platform_admins (marca transversal, ortogonal a memberships).
--   2. Helper is_superadmin() — chokepoint latente (lo cablea F14B-2).
--   3. Seed de Jose (jovimib@gmail.com) por email, idempotente, con FALLO claro
--      si el email no resuelve a un profile en el remoto.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla platform_admins
-- ─────────────────────────────────────────────────────────────────────────────

create table public.platform_admins (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null
);

comment on table public.platform_admins is
  'Superadmins = operadores de PLATAFORMA transversales. NO es un rol de club: no '
  'va en memberships y no cuenta en el conteo de usuarios de ningún club. Una fila '
  '= un profile con acceso de plataforma. F14B-1 solo crea el vocabulario; el '
  'acceso transversal se cablea en F14B-2 (is_superadmin dentro de user_role_in_club).';
comment on column public.platform_admins.granted_by is
  'Quién marcó a este superadmin. NULL para el seed inicial (por migración).';

alter table public.platform_admins enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper is_superadmin() — chokepoint latente.
--    Se define ANTES de la policy porque la policy de SELECT lo usa.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_admins where profile_id = auth.uid()
  );
$$;

comment on function public.is_superadmin() is
  'F14B-1 — TRUE si el user actual (auth.uid()) es superadmin de plataforma. '
  'Chokepoint transversal: F14B-2 lo cablea dentro de user_role_in_club para '
  'propagar el acceso. En F14B-1 NO lo llama nadie (vocabulario latente).';

revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

-- SELECT solo para superadmins (nadie más necesita leer esta tabla por ahora).
-- Sin policies de INSERT/UPDATE/DELETE de cliente: se gestiona por migración /
-- servicio (más adelante por la consola vía service_role o RPC en F14B-5).
-- Nota: is_superadmin() es SECURITY DEFINER (corre como owner, exento de RLS) →
-- no hay recursión al usarla en la policy de su propia tabla.
create policy platform_admins_select_superadmin on public.platform_admins
  for select to authenticated
  using (public.is_superadmin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed de Jose por EMAIL (idempotente; TOLERANTE si no resuelve).
--    El email vive en auth.users; profiles.id = auth.users.id en este modelo.
--
-- ⚠️ TOLERANTE A PROPÓSITO (F15-B, editado sobre migración YA APLICADA): este seed
-- está acoplado a un email de ENTORNO ('jovimib@gmail.com'). En el remoto ese
-- profile existe → siembra el superadmin. En una BD NUEVA/VACÍA (CI con BD efímera,
-- `supabase db reset`, entorno nuevo, recuperación ante desastre, dev local desde
-- cero) ese email NO existe → antes hacía `raise exception` y ABORTABA la migración,
-- dejando el proyecto imposible de levantar desde cero. Ahora, si no resuelve,
-- simplemente NO siembra y sigue (`return`).
--   · Prod: efecto CERO. La fila ya está sembrada y la migración está registrada como
--     aplicada (no se re-ejecuta en `db push`).
--   · BD nueva: no hay superadmin (nadie lo necesita para bootstrap; los tests que lo
--     requieren crean su propia fila en platform_admins).
-- NO revertir a `raise`: eso vuelve a bloquear el arranque desde cero (era el bug que
-- F15-B destapó al aplicar las 179 migraciones en limpio).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_profile_id uuid;
begin
  select p.id
    into v_profile_id
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = 'jovimib@gmail.com'
  limit 1;

  -- Email de entorno no presente (BD nueva/CI): no se siembra superadmin y se sigue.
  if v_profile_id is null then
    return;
  end if;

  insert into public.platform_admins (profile_id)
  values (v_profile_id)
  on conflict (profile_id) do nothing;
end $$;
