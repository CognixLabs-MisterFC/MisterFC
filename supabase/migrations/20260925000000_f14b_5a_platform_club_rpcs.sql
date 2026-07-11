-- F14B-5a — RPCs de plataforma: crear club, listar, métricas.
--
-- Backend de la consola del superadmin. SOLO create + list + metrics. La
-- invitación del admin y el trigger de owner van en F14B-5b.
--
-- Reglas (Jose):
--   · platform_create_club crea el club INMEDIATAMENTE, vacío, SIN meter al
--     superadmin como miembro; owner_profile_id queda NULL (se asigna al aceptar
--     el admin, F14B-5b). El trigger clubs_seed_legal_documents siembra los 5
--     placeholders; seed_standard_categories siembra el catálogo.
--   · El slug lo confirma la UI; la RPC lo valida igual. Helper platform_propose_slug
--     para proponer uno libre (la UI usa nameToSlug para preview en vivo).
--   · list muestra estado "sin admin"/"sin owner"; metrics cuenta por rol + invitaciones
--     pendientes + jugadores.
--
-- ALCANCE ESTRICTO: no se toca create_club_with_admin (onboarding), ni la policy
-- de invitations, ni accept_pending_invitations. Todas gateadas por is_superadmin().

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. platform_propose_slug(p_name) — normaliza (espejo de nameToSlug, con
--    unaccent) y de-duplica contra clubs.slug (sufijo -2, -3…). SECURITY DEFINER
--    porque lee clubs para comprobar unicidad. Gate is_superadmin().
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.platform_propose_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_slug text;
  v_n    int := 1;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  -- lower + unaccent + no-alfanumérico→'-' + recorte de guiones + máx 63.
  v_base := left(
    btrim(
      regexp_replace(lower(public.unaccent(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'),
      '-'
    ), 63);
  if v_base = '' then v_base := 'club'; end if;

  v_slug := v_base;
  while exists (select 1 from public.clubs where slug = v_slug) loop
    v_n := v_n + 1;
    -- deja sitio al sufijo dentro del límite de 63.
    v_slug := left(v_base, 63 - length('-' || v_n)) || '-' || v_n;
  end loop;

  return v_slug;
end;
$$;

comment on function public.platform_propose_slug(text) is
  'F14B-5a — propone un slug libre a partir del nombre (espejo de nameToSlug con '
  'unaccent + sufijo -N ante colisión). Solo superadmin. La UI lo confirma.';

revoke all on function public.platform_propose_slug(text) from public;
grant execute on function public.platform_propose_slug(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. platform_create_club(p_name, p_slug, p_locale) — crea club vacío, sin
--    membership del superadmin, owner NULL. Devuelve club_id.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.platform_create_club(
  p_name text,
  p_slug text,
  p_locale text default 'es'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club_id uuid;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  -- Validaciones (mismas que create_club_with_admin).
  if p_name is null or char_length(trim(p_name)) = 0 or char_length(p_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_locale not in ('es', 'en', 'va') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;
  if exists (select 1 from public.clubs where slug = p_slug) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  -- Insert del club: dispara clubs_seed_legal_documents (5 placeholders). NO se
  -- inserta membership del superadmin. owner_profile_id queda NULL (F14B-5b lo
  -- asigna al aceptar el admin invitado).
  insert into public.clubs (name, slug, locale)
  values (p_name, p_slug, p_locale)
  returning id into v_club_id;

  -- Catálogo estándar de categorías (idempotente).
  perform public.seed_standard_categories(v_club_id);

  return v_club_id;
end;
$$;

comment on function public.platform_create_club(text, text, text) is
  'F14B-5a — el superadmin crea un club vacío (nombre/slug/locale), sin membership '
  'suya y con owner_profile_id NULL (se asigna al aceptar el admin, F14B-5b). '
  'Dispara el seed de legal_documents y siembra categorías. Solo superadmin.';

revoke all on function public.platform_create_club(text, text, text) from public;
grant execute on function public.platform_create_club(text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. platform_list_clubs() — lista todos los clubs con estado sin-admin/sin-owner
--    y datos del owner cuando existe.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.platform_list_clubs()
returns table (
  id uuid,
  name text,
  slug text,
  locale text,
  created_at timestamptz,
  owner_profile_id uuid,
  owner_name text,
  has_owner boolean,
  has_admin boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  return query
    select
      c.id, c.name, c.slug, c.locale, c.created_at,
      c.owner_profile_id,
      op.full_name as owner_name,
      (c.owner_profile_id is not null) as has_owner,
      exists (
        select 1 from public.memberships m
        where m.club_id = c.id and m.role = 'admin_club'
      ) as has_admin
    from public.clubs c
    left join public.profiles op on op.id = c.owner_profile_id
    order by c.created_at asc;
end;
$$;

comment on function public.platform_list_clubs() is
  'F14B-5a — lista todos los clubs (solo superadmin): datos + owner (nombre) + '
  'flags has_owner / has_admin (existe alguna membership admin_club).';

revoke all on function public.platform_list_clubs() from public;
grant execute on function public.platform_list_clubs() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. platform_club_metrics() — por club: conteo por rol + invitaciones pendientes
--    + jugadores. El superadmin no está en memberships → no contamina.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.platform_club_metrics()
returns table (
  club_id uuid,
  club_name text,
  admin_club integer,
  director integer,
  coordinador integer,
  entrenador_principal integer,
  entrenador_ayudante integer,
  jugador integer,
  members_total integer,
  pending_invitations integer,
  players integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  return query
    select
      c.id, c.name,
      coalesce(mc.admin_club, 0)::int,
      coalesce(mc.director, 0)::int,
      coalesce(mc.coordinador, 0)::int,
      coalesce(mc.entrenador_principal, 0)::int,
      coalesce(mc.entrenador_ayudante, 0)::int,
      coalesce(mc.jugador, 0)::int,
      coalesce(mc.members_total, 0)::int,
      coalesce(inv.pending, 0)::int,
      coalesce(pl.players, 0)::int
    from public.clubs c
    left join (
      select m.club_id,
        count(*) filter (where m.role = 'admin_club')           as admin_club,
        count(*) filter (where m.role = 'director')             as director,
        count(*) filter (where m.role = 'coordinador')          as coordinador,
        count(*) filter (where m.role = 'entrenador_principal') as entrenador_principal,
        count(*) filter (where m.role = 'entrenador_ayudante')  as entrenador_ayudante,
        count(*) filter (where m.role = 'jugador')              as jugador,
        count(*)                                                as members_total
      from public.memberships m
      group by m.club_id
    ) mc on mc.club_id = c.id
    left join (
      select i.club_id, count(*) as pending
      from public.invitations i
      where i.accepted_at is null and i.expires_at > now()
      group by i.club_id
    ) inv on inv.club_id = c.id
    left join (
      select p.club_id, count(*) as players
      from public.players p
      group by p.club_id
    ) pl on pl.club_id = c.id
    order by c.created_at asc;
end;
$$;

comment on function public.platform_club_metrics() is
  'F14B-5a — métricas por club (solo superadmin): conteo de memberships por rol, '
  'total de miembros, invitaciones pendientes y jugadores. El superadmin no es '
  'miembro de ningún club → no contamina los conteos.';

revoke all on function public.platform_club_metrics() from public;
grant execute on function public.platform_club_metrics() to authenticated;
