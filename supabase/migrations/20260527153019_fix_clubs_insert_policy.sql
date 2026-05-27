-- Fix — RLS de clubs INSERT y atomicidad del onboarding
--
-- Bug observado en smoke test (2026-05-27 15:16 UTC):
--   El INSERT en clubs durante /onboarding fallaba con
--   "new row violates row-level security policy for table clubs".
--
-- Origen: la policy `clubs_insert_first` de la migración 20260527133957 hacía
-- WITH CHECK con un `not exists (select from public.memberships ...)`. Esa
-- subquery se ejecutaba como `authenticated` y respetaba las propias policies
-- de memberships → en algunos paths la subquery no devolvía las filas que
-- esperábamos (RLS recursiva + MVCC dentro del INSERT), lo que volvía el
-- WITH CHECK a false aunque el usuario realmente no tuviera memberships.
--
-- Decisión (opción B del análisis): canalizar TODO el onboarding por una
-- función SECURITY DEFINER atómica `public.create_club_with_admin(...)`.
--
-- Razones para B sobre A (policy permisiva "auth.uid() IS NOT NULL"):
--   1. Atomicidad: club + membership en una sola transacción. Antes había
--      una ventana donde el club existía sin admin.
--   2. Estricto por defecto: clubs queda con INSERT prohibido a clientes.
--      No se puede crear un club sin que se cree su admin a la vez.
--   3. La validación de "user sin memberships" vive en la función (un único
--      sitio), no en una policy RLS frágil.
--
-- Consecuencias:
--   - apps/web/src/app/[locale]/onboarding/actions.ts debe llamar a esta RPC
--     en vez de hacer dos INSERTs separados (incluido en el mismo PR).
--   - Cualquier futuro flow que cree clubs (multi-club en Fase 2) usará esta
--     función o se ampliará a otra equivalente.

-- ─────────────────────────────────────────────────────────────────────────────
-- Reemplazar la policy de INSERT en clubs por una restrictiva: nadie inserta
-- vía cliente. Solo la función SECURITY DEFINER lo hace.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists clubs_insert_first on public.clubs;

create policy clubs_insert_forbidden on public.clubs
  for insert to authenticated
  with check (false);

comment on policy clubs_insert_forbidden on public.clubs is
  'Bloquea INSERT directo. La creación va por public.create_club_with_admin (SECURITY DEFINER) para garantizar atomicidad con la membership admin_club.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Función create_club_with_admin
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_club_with_admin(
  p_name text,
  p_slug text,
  p_locale text default 'es'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_club_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo un user sin memberships puede crear su primer club por aquí.
  -- En Fase 2, cuando se permita multi-club, esta restricción se relajará en
  -- una función separada (`create_additional_club`) con su propia autorización.
  if exists (select 1 from public.memberships where profile_id = v_user_id) then
    raise exception 'already_in_a_club' using errcode = 'P0001';
  end if;

  -- Validaciones de entrada (también las hace el cliente con Zod, pero la
  -- función es el contrato final de la base de datos).
  if p_name is null or char_length(trim(p_name)) = 0 or char_length(p_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_locale not in ('es', 'en', 'va') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;

  -- Insert atómico de club + membership admin_club.
  insert into public.clubs (name, slug, locale)
  values (p_name, p_slug, p_locale)
  returning id into v_club_id;

  insert into public.memberships (profile_id, club_id, role)
  values (v_user_id, v_club_id, 'admin_club');

  return v_club_id;
end;
$$;

comment on function public.create_club_with_admin(text, text, text) is
  'Crea un club + su membership admin_club para auth.uid() en una sola transacción. Único path autorizado para crear clubs durante onboarding (Fase 1).';

-- Solo `authenticated` puede llamarla (anon no debería).
revoke all on function public.create_club_with_admin(text, text, text) from public;
grant execute on function public.create_club_with_admin(text, text, text) to authenticated;
