-- F14J-5A · paso 1 — El directorio público de clubes se puede filtrar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ RESUELVE
-- ------------
-- El selector de club de la app nativa (5A) pinta los clubes con su escudo
-- ANTES de identificarse, leyendo `list_public_clubs()`. Hoy esa función
-- devuelve TODOS los clubes de la tabla, incluido "Club Beta Test", que es de
-- pruebas y no debe aparecer ante ningún usuario.
--
-- El filtro va en el SERVIDOR y no en la app, a propósito: la misma decisión
-- vale para la web (que ya usa estas RPC en /[locale]/{slug}, F14J-3b) y para
-- cualquier cliente futuro, sin repetir la regla en tres sitios.
--
-- LO QUE NO CAMBIA, Y ES DELIBERADO
-- ---------------------------------
--   · Las RLS de `clubs` NO se tocan. Siguen cerradas a anon: las cuatro
--     policies son de `authenticated`. La única puerta pública siguen siendo
--     estas dos RPC `security definer`, que es justo el diseño de F14J-1.
--   · El bucket `club-logos` NO se toca. Sigue público, como lo dejó su
--     migración. `is_public` gobierna el DIRECTORIO, no el fichero: un escudo
--     cuya URL alguien ya conozca sigue sirviéndose. Si algún día hace falta
--     ocultar también el binario, es otra decisión y otra migración.
--   · La firma, el `security definer`, el `search_path`, los grants a
--     `anon, authenticated` y el orden por nombre se conservan VERBATIM desde
--     `pg_get_functiondef` de la base viva. El único cambio es el `where`.
--
-- POR QUÉ `get_public_club_by_slug` NO FILTRA
-- -------------------------------------------
-- `is_public` significa «sale en el listado», no «es accesible». Son cosas
-- distintas y conviene no fundirlas:
--
--   · La web resuelve misterfc.es/{slug} con esta función. Si filtrara, el
--     club marcado como no público perdería su página de acceso y pasaría a
--     dar «club no encontrado» — romper un acceso existente para ocultar un
--     club de una lista es un cambio mucho mayor del que se ha pedido.
--   · Quien escribe el slug exacto ya sabe a qué club va. La función no
--     revela nada más que nombre, slug y escudo, y no dice absolutamente nada
--     sobre quién pertenece al club.
--   · Es el patrón «no listado»: fuera del directorio, alcanzable por su URL.
--     Para un club de pruebas es exactamente lo que hace falta — que no salga
--     en el selector pero se pueda seguir entrando a probar.
--
-- La puerta de verdad no es esta función: es el login. Esta RPC solo decide
-- qué cara se pinta encima del formulario.
--
-- Si Jose prefiere lo contrario —ocultar también por slug— es UNA línea: el
-- mismo `and c.is_public` en el `where` de abajo. Se deja escrito aquí para
-- que quien lo lea dentro de un año sepa que fue una decisión y no un olvido.
--
-- Ver: apps/web/src/app/[locale]/[slug]/page.tsx (F14J-3b)
--      supabase/migrations/20261029000000_f14j_1_public_clubs_rpc.sql (F14J-1)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) La columna
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFAULT true: un club nuevo entra en el directorio salvo que alguien decida
-- lo contrario. Es lo que hay hoy (todos salen) y evita que dar de alta un club
-- lo deje invisible sin que nadie entienda por qué.
alter table public.clubs
  add column if not exists is_public boolean not null default true;

comment on column public.clubs.is_public is
  'F14J-5A — ¿el club aparece en el DIRECTORIO público (list_public_clubs)? '
  'No gobierna el acceso: get_public_club_by_slug lo ignora a propósito, y el '
  'escudo del bucket club-logos sigue siendo público. Solo listado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) El estado actual, explícito
-- ─────────────────────────────────────────────────────────────────────────────
-- Por SLUG, nunca por id literal: los ids son distintos en cada entorno y una
-- migración con uuids clavados solo funcionaría en producción.
--
-- El UPDATE de 'udfonteta' es redundante con el DEFAULT y va a propósito: deja
-- el estado deseado escrito en la migración en vez de depender de que el
-- default se aplicara. Si mañana alguien cambia el default, esto sigue diciendo
-- la verdad.
update public.clubs set is_public = true  where slug = 'udfonteta';
update public.clubs set is_public = false where slug = 'club-beta-test';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) list_public_clubs() — el ÚNICO cambio es el where
-- ─────────────────────────────────────────────────────────────────────────────
-- Verbatim desde pg_get_functiondef de la base viva, con `where c.is_public`
-- añadido y nada más.
create or replace function public.list_public_clubs()
 returns table(id uuid, name text, slug text, logo_path text)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
    select c.id, c.name, c.slug, c.logo_path
    from public.clubs c
    where c.is_public
    order by c.name;
end;
$function$;

comment on function public.list_public_clubs() is
  'F14J-1 — directorio PÚBLICO de clubes (sin login, base de los logos de 5A). '
  'Proyección MÍNIMA (id, name, slug, logo_path); ningún otro dato de clubs. '
  'La tabla clubs sigue cerrada a anon: esta es la única puerta pública. '
  'F14J-5A: excluye los clubes con is_public = false.';

revoke all on function public.list_public_clubs() from public;
grant execute on function public.list_public_clubs() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) get_public_club_by_slug(text) — NO SE TOCA
-- ─────────────────────────────────────────────────────────────────────────────
-- Se deja tal cual está en la base viva, por lo razonado en la cabecera. No se
-- reescribe ni siquiera de forma idéntica: recrear una función para dejarla
-- igual solo añade una oportunidad de perder una opción por el camino.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard — que la migración compruebe lo que promete
-- ─────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_def       text;
  v_listados  int;
  v_beta      boolean;
  v_por_slug  int;
  v_oculto    text;
begin
  -- 4.1 · La columna existe con el default correcto.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'clubs'
       and column_name = 'is_public' and is_nullable = 'NO'
  ) then
    raise exception '5A: clubs.is_public no existe o admite nulos';
  end if;

  -- 4.2 · list_public_clubs filtra, y conserva lo que no debía cambiar.
  v_def := pg_get_functiondef('public.list_public_clubs()'::regprocedure);
  if v_def not like '%where c.is_public%' then
    raise exception '5A: list_public_clubs no filtra por is_public';
  end if;
  if v_def not like '%order by c.name%' then
    raise exception '5A: list_public_clubs ha perdido el orden por nombre';
  end if;
  if v_def not like '%SECURITY DEFINER%' then
    raise exception '5A: list_public_clubs ha perdido SECURITY DEFINER';
  end if;
  if v_def not like '%search_path%' then
    raise exception '5A: list_public_clubs ha perdido el search_path fijo';
  end if;

  -- 4.3 · El grant a anon sigue en pie. Sin esto la pantalla previa al login
  --       se quedaría vacía, y en silencio.
  if not has_function_privilege('anon', 'public.list_public_clubs()', 'execute') then
    raise exception '5A: anon ha perdido el execute sobre list_public_clubs';
  end if;
  if not has_function_privilege('anon', 'public.get_public_club_by_slug(text)', 'execute') then
    raise exception '5A: anon ha perdido el execute sobre get_public_club_by_slug';
  end if;

  -- 4.4 · El efecto real: Beta fuera del listado, y ni un club de más.
  select count(*) into v_listados from public.list_public_clubs();
  select bool_or(slug = 'club-beta-test') into v_beta
    from public.list_public_clubs();
  if coalesce(v_beta, false) then
    raise exception '5A: club-beta-test sigue apareciendo en el directorio';
  end if;
  if v_listados <> (select count(*) from public.clubs where is_public) then
    raise exception '5A: el listado no coincide con los clubes is_public';
  end if;

  -- 4.5 · Y lo que NO debía cambiar: un club OCULTO sigue alcanzable por slug.
  --       Este assert es el que fallaría si alguien "arregla" la función de
  --       slug para que también filtre.
  --
  --       Se pregunta por CUALQUIER club oculto, no por 'club-beta-test', y
  --       solo si hay alguno: una migración corre también sobre bases recién
  --       creadas —el CI aplica todas las migraciones en limpio— donde `clubs`
  --       está VACÍA y los update de arriba no encuentran ninguna fila. Un
  --       assert que exija datos de producción convierte el guard en un fallo
  --       de entorno, que es exactamente lo que pasó la primera vez.
  select c.slug into v_oculto
    from public.clubs c where not c.is_public order by c.slug limit 1;

  if v_oculto is not null then
    select count(*) into v_por_slug
      from public.get_public_club_by_slug(v_oculto);
    if v_por_slug <> 1 then
      raise exception
        '5A: el club oculto % ya no es alcanzable por slug (esperado 1, hay %)',
        v_oculto, v_por_slug;
    end if;
  end if;
end $guard$;
