-- F14J-1 — Lectura pública del directorio de clubes (base del login por club).
--
-- Decisión de producto CERRADA (Jose): el directorio de clubes es PÚBLICO —
-- nombre, slug y logo visibles SIN login. Sirve a:
--   · 5A (misterfc.es): fila de logos de todos los clubes como atajo.
--   · 5B (misterfc.es/{slug}): logo + datos de un club por su slug.
-- Se acepta la implicación: cualquiera ve qué clubes usan MisterFC.
--
-- La seguridad NO es un gate de rol (son públicos a propósito) sino la
-- PROYECCIÓN MÍNIMA: estos RPC devuelven SOLO (id, name, slug, logo_path).
-- NUNCA owner_profile_id, locale, created_at ni ninguna otra columna de clubs.
-- Por eso el cuerpo ENUMERA las 4 columnas y jamás usa `select *`.
--
-- La tabla `public.clubs` SIGUE cerrada a anon: sus policies SELECT son
-- `TO authenticated` (clubs_select_member / _via_pending_invitation) y NO se
-- abre ninguna policy anon. La única puerta pública son estos dos RPC
-- SECURITY DEFINER con proyección acotada. Mismo patrón estructural que los
-- RPC platform_* (SECURITY DEFINER + search_path fijo) pero SIN gate de rol.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. list_public_clubs() — directorio completo (5A). Todos los clubes, 4 columnas.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.list_public_clubs()
returns table (
  id uuid,
  name text,
  slug text,
  logo_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    select c.id, c.name, c.slug, c.logo_path
    from public.clubs c
    order by c.name;
end;
$$;

comment on function public.list_public_clubs() is
  'F14J-1 — directorio PÚBLICO de clubes (sin login, base de los logos de 5A). '
  'Proyección MÍNIMA (id, name, slug, logo_path); ningún otro dato de clubs. '
  'La tabla clubs sigue cerrada a anon: esta es la única puerta pública.';

revoke all on function public.list_public_clubs() from public;
grant execute on function public.list_public_clubs() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_public_club_by_slug(p_slug) — un club por slug (5B). Misma proyección.
--    0 filas si el slug no existe (nunca lanza, nunca expone más columnas).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_public_club_by_slug(p_slug text)
returns table (
  id uuid,
  name text,
  slug text,
  logo_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    select c.id, c.name, c.slug, c.logo_path
    from public.clubs c
    where c.slug = p_slug;
end;
$$;

comment on function public.get_public_club_by_slug(text) is
  'F14J-1 — un club PÚBLICO por slug (sin login, base de misterfc.es/{slug}). '
  'Misma proyección mínima (id, name, slug, logo_path); 0 filas si no existe.';

revoke all on function public.get_public_club_by_slug(text) from public;
grant execute on function public.get_public_club_by_slug(text) to anon, authenticated;
