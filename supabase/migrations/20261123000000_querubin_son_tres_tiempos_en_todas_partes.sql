-- QUERUBÍN SON TRES TIEMPOS DE DOCE — EN TODOS LOS CLUBES, NO EN UNO.
--
-- Esta migración contradice a su hermana mayor, y conviene que se lea aquí. La de
-- los tres tiempos (20261121000000) dejó escrito esto:
--
--     «El dato: poner la categoría "Querubín" de UDFonteta en 3 periodos de 12
--      minutos es una escritura de datos de un club, no una migración genérica.»
--
-- La premisa era falsa. Tres tiempos de doce no es una preferencia de UDFonteta:
-- es cómo se juega querubines, igual en todos los clubes. Una migración aplicada
-- no se edita, así que la corrección vive aquí: lo que era «dato de un club»
-- pasa a ser valor del catálogo.
--
-- ── LO QUE LLEVA ─────────────────────────────────────────────────────────────
--   1. `standard_category_catalog()`: la lista canónica de categorías estándar
--      —kind, nombre, duración de CADA periodo regular y cuántos periodos— en UN
--      sitio.
--   2. `seed_standard_categories` deja de llevar la lista dentro y la lee de ahí.
--      Y siembra `period_count`, que hasta hoy NO sembraba: se quedaba en el
--      `default 2`, así que todo club nuevo nacía con querubines a dos partes.
--      Eso es lo que de verdad arregla esta migración; el barrido de abajo es el
--      resto.
--   3. El barrido de las filas de hoy, genérico (por kind, sin un solo id de
--      club) e idempotente.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO OTRA COPIA DE LA LISTA ──────────────────────────
-- Porque la lista ya está escrita tres veces en este repo: dentro de
-- `seed_standard_categories` (20260702000000), otra vez en la reconciliación de
-- tildes (20261034000000, que lo dice en su propia cabecera — «se replica aquí
-- literalmente») y una tercera en el backfill por nombre (20260605000003). Una
-- cuarta copia para este barrido es exactamente el mecanismo por el que querubín
-- acabó en 15 en un sitio y en 12 en otro. Promoverla a función no es elegancia:
-- es que el UPDATE de abajo LEE lo mismo que siembra el semillero, así que no
-- pueden divergir.
--
-- ── LO QUE NO LLEVA, Y ES DELIBERADO ─────────────────────────────────────────
-- NO hay trigger ni CHECK que claven querubín en 3 × 12. La RLS ya cierra esa
-- puerta: `categories_write_locked` es `ALL USING false WITH CHECK false`, y en
-- toda la app no hay un solo INSERT/UPDATE/DELETE sobre `categories` (medido, no
-- recordado). Una barrera nueva solo protegería del superuser, es decir de las
-- propias migraciones de datos que se aplican a mano — el mismo argumento con el
-- que el trigger del acta se dejó estrecho. En su lugar hay pgTAP sobre el
-- semillero, que es donde la regresión puede ocurrir de verdad: alguien editando
-- la lista.
--
-- NO se toca la duración de ninguna otra categoría. Medido antes de escribir:
-- las 20 filas de producción coinciden con el catálogo salvo la querubín de
-- UDFonteta (12, puesta a mano en el alta del equipo). En las adultas la
-- duración sí varía por competición: el catálogo dice con qué nacen, no las
-- congela.
--
-- ── EL RADIO, MEDIDO ─────────────────────────────────────────────────────────
-- En producción hay 2 clubes y los dos tienen querubín: UDFonteta ya en 3 × 12
-- (1 equipo, 84 eventos, todos entrenamientos) y CD Ejemplo en 2 × 15 con CERO
-- equipos en esa categoría. `match_periods` de equipos de querubín: 0 filas en
-- los dos clubes. No hay ni un partido de querubines jugado que este cambio
-- pueda reinterpretar, y el barrido mueve UNA fila.
--
-- Lo que este PR NO arregla y queda dicho: `computeEndsAt` sigue sugiriendo el
-- fin de un partido con 2 × duración (39' para querubines, en vez de 36' de
-- juego más los descansos). Es código, no dato, y va en su PR hermano.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El catálogo canónico, en un sitio.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.standard_category_catalog()
returns table (
  kind text,
  name text,
  half_duration_minutes integer,
  period_count integer
)
language sql
immutable
set search_path to 'public'
as $$
  -- Los casts del select exterior son necesarios: en un VALUES los literales
  -- salen como unknown/int4 y el tipo de retorno declarado no perdona.
  select c.kind::text, c.name::text, c.half::integer, c.periodos::integer
    from (values
      ('querubin',    'Querubín',    12, 3),
      ('prebenjamin', 'Prebenjamín', 20, 2),
      ('benjamin',    'Benjamín',    25, 2),
      ('alevin',      'Alevín',      30, 2),
      ('infantil',    'Infantil',    35, 2),
      ('cadete',      'Cadete',      40, 2),
      ('juvenil',     'Juvenil',     45, 2),
      ('amateur',     'Amateur',     45, 2),
      ('senior',      'Sénior',      45, 2),
      ('veterano',    'Veterano',    45, 2)
    ) as c(kind, name, half, periodos);
$$;

comment on function public.standard_category_catalog() is
  'Catálogo canónico de las categorías estándar: kind, nombre, duración de CADA periodo regular (minutos) y cuántos periodos regulares. Es la ÚNICA fuente del valor: seed_standard_categories y las migraciones de datos lo leen en vez de copiar la lista. Querubín son 3 × 12 en todos los clubes, no por configuración de club.';

-- La ACL de sus tres hermanas (is_superadmin, seed_standard_categories,
-- platform_create_club). El `revoke` de PUBLIC no es adorno: una función recién
-- creada nace con `=X/postgres`, que alcanza a `anon`, y el bloque [1] de
-- `anon_execute_cerrado.sql` exige que las ejecutables por anon sean exactamente
-- dos. Y `service_role` no es opcional: el bloque [5] del mismo test exige que
-- conserve EXECUTE en TODAS las funciones no-trigger de `public`.
revoke all on function public.standard_category_catalog() from public;
grant execute on function public.standard_category_catalog() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El semillero lee el catálogo, y siembra también cuántos periodos.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.seed_standard_categories(p_club_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inserted integer := 0;
  v_cat record;
begin
  for v_cat in select * from public.standard_category_catalog()
  loop
    -- No tocar si ya hay una categoría de ese kind o con ese nombre en el club
    -- (idempotencia + respeto a las custom + evita unique(club_id, lower(name))).
    if exists (
      select 1 from public.categories
       where club_id = p_club_id
         and (kind = v_cat.kind or lower(name) = lower(v_cat.name))
    ) then
      continue;
    end if;

    insert into public.categories
      (club_id, name, kind, half_duration_minutes, period_count, is_standard)
      values (p_club_id, v_cat.name, v_cat.kind,
              v_cat.half_duration_minutes, v_cat.period_count, true);
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El barrido: las querubín de hoy, a los valores del catálogo.
--    Imprime su cuenta — un bloque de reparación que calla no distingue el cero
--    «ya estaba bien» del cero «mi predicado no coge nada».
-- ─────────────────────────────────────────────────────────────────────────────
with canon as (
  select k.half_duration_minutes, k.period_count
    from public.standard_category_catalog() k
   where k.kind = 'querubin'
),
cambiadas as (
  update public.categories c
     set half_duration_minutes = canon.half_duration_minutes,
         period_count          = canon.period_count
    from canon
   where c.kind = 'querubin'
     and (c.half_duration_minutes, c.period_count)
         is distinct from (canon.half_duration_minutes, canon.period_count)
  returning c.id
)
select count(*) as querubin_corregidas from cambiadas;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GUARD: tras el barrido no queda ninguna querubín fuera del catálogo.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_fuera integer;
  v_total integer;
begin
  select count(*) into v_total
    from public.categories where kind = 'querubin';

  select count(*) into v_fuera
    from public.categories c
    join public.standard_category_catalog() k on k.kind = c.kind
   where c.kind = 'querubin'
     and (c.half_duration_minutes, c.period_count)
         is distinct from (k.half_duration_minutes, k.period_count);

  if v_fuera > 0 then
    raise exception
      'GUARD: % de % categorías querubín siguen fuera del catálogo tras el barrido',
      v_fuera, v_total;
  end if;

  raise notice 'GUARD ok: las % categorías querubín están en 3 × 12', v_total;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El informe, como resultado: lo que hay que ver después de aplicar.
--    (El `raise notice` de arriba no siempre vuelve; una tabla sí.)
-- ─────────────────────────────────────────────────────────────────────────────
select cl.name as club,
       c.name as categoria,
       c.period_count as periodos,
       c.half_duration_minutes as minutos_por_periodo,
       (select count(*) from public.teams t where t.category_id = c.id) as equipos
  from public.categories c
  join public.clubs cl on cl.id = c.club_id
 where c.kind = 'querubin'
 order by cl.name;
