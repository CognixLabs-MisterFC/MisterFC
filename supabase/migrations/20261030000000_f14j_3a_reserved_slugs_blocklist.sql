-- F14J-3a — Blocklist de slugs reservados (login-por-club, /{slug}).
--
-- CONTEXTO: F14J-3 abre la ruta pública `misterfc.es/{slug}` (login del club).
-- `[slug]` es el ÚNICO segmento dinámico directo bajo `[locale]`; Next resuelve
-- estático ANTES que dinámico, así que `/clubes`, `/signin`, `/dashboard`, etc.
-- siguen sirviendo su página. El problema es de DATOS: si un club se crea con un
-- slug que coincide con una de esas rutas estáticas, su login por `/{slug}`
-- quedaría ENSOMBRECIDO (inalcanzable). Los slugs son texto libre del superadmin
-- (validados solo por regex en platform_create_club), sin lista de reservados.
--
-- SOLUCIÓN: una sola fuente de verdad, `public.is_reserved_slug(text)`, con la
-- lista de segmentos de ruta que un slug NO puede ocupar. Dos consumidores:
--   1. platform_create_club → RECHAZA con `slug_reserved` si el slug es reservado.
--   2. platform_propose_slug → SALTA reservados al autogenerar (si el club se
--      llama "Calendario", ya no propone "calendario", propone "calendario-2").
--
-- MANTENIMIENTO: cada ruta NUEVA que se añada bajo `[locale]` (estática o del
-- grupo `(authenticated)`) debe añadirse a esta lista con una migración que
-- recree `is_reserved_slug`. Es la contrapartida de tener la URL limpia `/{slug}`.
--
-- No hay clubes creados aún en prod → esto solo blinda la creación FUTURA; no
-- hace falta migrar/verificar slugs existentes.
--
-- Las dos funciones de plataforma se recrean desde su DEFINICIÓN VIVA
-- (pg_get_functiondef en prod), añadiendo SOLO el gate de reservados; todo lo
-- demás queda idéntico (ver diff de comportamiento en el PR).

-- ── 1. Helper: ¿es un slug reservado? ──────────────────────────────────────────
-- IMMUTABLE + array constante: barato, sin tocar tablas, válido dentro de las
-- funciones SECURITY DEFINER. Normaliza (lower+trim) por defensa en profundidad
-- aunque el regex del slug ya obligue a minúsculas.
create or replace function public.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(btrim(coalesce(p_slug, ''))) = any (array[
    -- Rutas estáticas directas bajo [locale]
    'check-email','clubes','dev-diagram','dev-pitch-editor','forgot-password',
    'invite','onboarding','platform','re-consentimiento','reset-password',
    'signin','spectator',
    -- Rutas del grupo (authenticated) (transparente → /{locale}/{ruta})
    'ajustes','anuncios','asistencia','calendario','convocatorias','cuerpo-tecnico',
    'dashboard','directos','ejercicios','entrenamientos','equipos','estadisticas-equipo',
    'formaciones','invitations','jugadas','jugadores','mensajes','mi-equipo','mi-ficha',
    'mi-informe','mis-equipos','novedades','partidos','perfil','pizarra','plantilla',
    'sesiones','supresiones',
    -- Reservas defensivas (infra, auth, futuro, ficheros de raíz)
    'api','auth','admin','app','www','signup','login','logout','settings','account',
    'help','about','legal','privacy','terms','c','assets','static','public','_next',
    'favicon.ico','robots.txt','sitemap.xml'
  ]);
$$;

revoke all on function public.is_reserved_slug(text) from public;
grant execute on function public.is_reserved_slug(text) to authenticated, service_role;

-- ── 2. platform_create_club — idéntica a la viva + gate slug_reserved ──────────
-- PRESERVADO (sin cambios): gate no_session/forbidden(is_superadmin); validaciones
-- invalid_name / invalid_slug(regex) / invalid_locale / slug_taken; insert del club
-- (dispara clubs_seed_legal_documents), seed_standard_categories, return club_id.
-- AÑADIDO: tras el regex, si is_reserved_slug(p_slug) → raise 'slug_reserved'.
create or replace function public.platform_create_club(p_name text, p_slug text, p_locale text default 'es'::text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  -- F14J-3a — el slug no puede colisionar con una ruta de la app (/{slug}).
  if public.is_reserved_slug(p_slug) then
    raise exception 'slug_reserved' using errcode = 'P0001';
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
$function$;

-- ── 3. platform_propose_slug — idéntica a la viva + salta reservados ───────────
-- PRESERVADO (sin cambios): gate no_session/forbidden; slugify base (lower+unaccent+
-- no-alfanumérico→'-'+trim guiones+left 63); '' → 'club'; dedup con sufijo -n dentro
-- del límite de 63. CAMBIADO: el bucle también salta slugs reservados, para no
-- proponer nunca uno que platform_create_club luego rechazaría.
create or replace function public.platform_propose_slug(p_name text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  -- F14J-3a — salta también los reservados (no solo los ya usados).
  while exists (select 1 from public.clubs where slug = v_slug)
        or public.is_reserved_slug(v_slug) loop
    v_n := v_n + 1;
    -- deja sitio al sufijo dentro del límite de 63.
    v_slug := left(v_base, 63 - length('-' || v_n)) || '-' || v_n;
  end loop;

  return v_slug;
end;
$function$;
