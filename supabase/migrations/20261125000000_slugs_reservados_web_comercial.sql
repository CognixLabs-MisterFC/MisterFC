-- Web comercial (W1) — slugs reservados que faltaban y los de la web comercial.
--
-- CONTEXTO: `public.is_reserved_slug` (F14J-3a, 20261030000000) es la única lista de
-- segmentos de ruta que un club no puede usar como slug: si lo usara, su login en
-- `misterfc.es/{slug}` quedaría tapado por la ruta. La lista se había desfasado: había
-- rutas sin reservar, y la web comercial añade las suyas.
--
-- Esta migración recrea la función con la lista COMPLETA (la de 3a, intacta, más lo
-- nuevo). Desde ahora hay un test en core (`slugs-reservados-censo.test.ts`) que compara
-- esta lista con las carpetas reales de `apps/web/src/app/[locale]`, los `redirects()` de
-- `next.config.ts` y las exclusiones del matcher del middleware, y se pone rojo si falta
-- alguna. Así no vuelve a desfasarse.
--
-- Solo blinda la creación FUTURA de clubes (`platform_create_club`, `platform_propose_slug`);
-- no toca ningún club existente.
--
-- Añadidas (spec docs/spec-web-comercial.md §2.2):
--   · ya faltaban: aplicacion, cuenta-eliminada, miembros, patrocinadores, suscripcion,
--     abrir-invitacion (redirect), categorias (redirect), monitoring (túnel de Sentry,
--     excluido del middleware);
--   · web comercial: funciones, seguridad, demo, portada;
--   · reservas defensivas de la web: precios, contacto, soporte, ayuda, blog, empresa,
--     clientes.

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
    'aplicacion','cuenta-eliminada','suscripcion',
    -- Rutas del grupo (authenticated) (transparente → /{locale}/{ruta})
    'ajustes','anuncios','asistencia','calendario','convocatorias','cuerpo-tecnico',
    'dashboard','directos','ejercicios','entrenamientos','equipos','estadisticas-equipo',
    'formaciones','invitations','jugadas','jugadores','mensajes','mi-equipo','mi-ficha',
    'mi-informe','mis-equipos','novedades','partidos','perfil','pizarra','plantilla',
    'sesiones','supresiones',
    'miembros','patrocinadores',
    -- Redirects de next.config.ts y exclusiones del matcher del middleware
    'abrir-invitacion','categorias','monitoring',
    -- Web comercial: grupo (web)
    'funciones','seguridad','demo','portada',
    -- Web comercial: reservas defensivas
    'precios','contacto','soporte','ayuda','blog','empresa','clientes',
    -- Reservas defensivas (infra, auth, futuro, ficheros de raíz)
    'api','auth','admin','app','www','signup','login','logout','settings','account',
    'help','about','legal','privacy','terms','c','assets','static','public','_next',
    'favicon.ico','robots.txt','sitemap.xml'
  ]);
$$;

revoke all on function public.is_reserved_slug(text) from public;
grant execute on function public.is_reserved_slug(text) to authenticated, service_role;

-- Comprobación al aplicar: las 19 palabras nuevas están reservadas y las de 3a siguen.
-- Imprime la cuenta también cuando pasa.
do $$
declare
  v_nuevas text[] := array[
    'aplicacion','cuenta-eliminada','miembros','patrocinadores','suscripcion',
    'abrir-invitacion','categorias','monitoring',
    'funciones','seguridad','demo','portada',
    'precios','contacto','soporte','ayuda','blog','empresa','clientes'];
  v_reservadas int;
begin
  select count(*) into v_reservadas from unnest(v_nuevas) w where public.is_reserved_slug(w);
  raise notice 'slugs reservados nuevos: % de %', v_reservadas, array_length(v_nuevas, 1);
  if v_reservadas <> array_length(v_nuevas, 1) then
    raise exception 'faltan slugs nuevos por reservar: % de %', v_reservadas, array_length(v_nuevas, 1);
  end if;
  if not (public.is_reserved_slug('calendario') and public.is_reserved_slug('signin')) then
    raise exception 'se ha perdido la lista de F14J-3a';
  end if;
  if public.is_reserved_slug('udfonteta') or public.is_reserved_slug('club-beta-test') then
    raise exception 'un slug de club existente ha quedado reservado';
  end if;
end;
$$;
