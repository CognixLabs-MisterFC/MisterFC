-- EL DESCANSO TAMBIÉN ES DE LA CATEGORÍA.
--
-- En querubines el descanso son CUATRO minutos, no quince. Y con tres tiempos hay
-- DOS descansos: 36 de juego + 8 = 44 minutos. Hoy el descanso es una constante
-- de código —`HALFTIME_BREAK_MINUTES = 15` en packages/core— cuya propia cabecera
-- dice que «NO depende de la categoría». Depende: igual que la duración de cada
-- periodo y que cuántos periodos hay.
--
-- ── LO QUE LLEVA ─────────────────────────────────────────────────────────────
--   1. `categories.break_minutes`: el descanso entre periodos de esa categoría.
--      Nace en 15 en todas, que es lo que la app hace hoy.
--   2. El catálogo (`standard_category_catalog`, mig 20261123000000) gana el
--      campo: querubín 4, el resto 15. UN solo número cambia respecto a lo que
--      la app calcula hoy, y es el de querubines.
--   3. El semillero lo siembra, y el barrido pone las filas de hoy a lo que dice
--      el catálogo.
--
-- ── POR QUÉ UNA COLUMNA Y NO SOLO EL CATÁLOGO ────────────────────────────────
-- Porque quien necesita el descanso es el CLIENTE, para pintar el fin sugerido de
-- un partido, y el diálogo del calendario ya carga la fila de la categoría. Una
-- columna viaja por la tubería que existe; dejarlo solo en el catálogo obligaría a
-- llamarlo por RPC y a meter `kind` en dos selects para poder mapear. Y sus dos
-- hermanos —`half_duration_minutes` y `period_count`— ya son columnas: tres hechos
-- de la misma naturaleza en dos casas distintas es la divergencia que la migración
-- hermana (20261123000000) existe para acabar. Además una categoría custom tiene
-- `kind` a NULL y no cabe en un mapa por kind; una columna con default siempre
-- contesta.
--
-- ── POR QUÉ `default 15` Y NO `default 0` NI NOT NULL SIN DEFAULT ────────────
-- Porque 15 es lo que la app aplica hoy a TODAS las categorías. Con ese default,
-- aplicar esta migración no cambia ni una sugerencia: lo único que se mueve es
-- querubín, y lo mueve el barrido, a la vista, con su cuenta impresa. Un default
-- distinto convertiría una migración de catálogo en un cambio silencioso de lo que
-- ve cada entrenador de cada club.
--
-- ── EL CHECK ─────────────────────────────────────────────────────────────────
-- `between 0 and 30`. El 0 es legítimo (un torneo sin descanso); el techo deja
-- fuera el dedazo que convierte un descanso en una hora. Es el mismo criterio con
-- el que `period_count` se quedó en (2,3): el CHECK no va más ancho que lo que
-- alguien puede querer de verdad.
--
-- ── LO QUE NO LLEVA ──────────────────────────────────────────────────────────
-- El código. `computeEndsAt` sigue sumando `2 × duración + 15` y el cartel del
-- diálogo lo repite a mano, con el «2 tiempos + 15 min descanso» escrito dentro
-- del texto en los tres idiomas. Va en su PR, detrás de este. Hasta que entre,
-- esta columna no cambia NADA de lo que se ve: nadie la lee todavía.
--
-- ── EL RADIO ─────────────────────────────────────────────────────────────────
-- La columna nace y nadie la lee: su radio hoy es el propio catálogo y el
-- semillero. El barrido toca las 2 filas de querubín de producción (las mismas de
-- ayer) y a ninguna otra, porque para el resto el catálogo dice 15, que es el
-- default con el que nacen.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.categories
  add column if not exists break_minutes smallint not null default 15;

alter table public.categories
  drop constraint if exists categories_break_minutes_check;

alter table public.categories
  add constraint categories_break_minutes_check
  check (break_minutes between 0 and 30);

comment on column public.categories.break_minutes is
  'Descanso ENTRE periodos de un partido de esta categoría, en minutos. Con period_count=3 hay DOS descansos (querubines: 12+4+12+4+12 = 44). Hasta la mig 20261124000000 era una constante de código de 15 que decía no depender de la categoría.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El catálogo gana el campo.
--    Va con DROP y no con CREATE OR REPLACE: un `returns table` no se puede
--    ensanchar en sitio («cannot change return type of existing function»).
--    Al recrearla vuelve a nacer con el `=X/postgres` que alcanza a anon, así que
--    la ACL se repone igual que en la migración que la creó.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.standard_category_catalog();

create function public.standard_category_catalog()
returns table (
  kind text,
  name text,
  half_duration_minutes integer,
  period_count integer,
  break_minutes integer
)
language sql
immutable
set search_path to 'public'
as $$
  -- Los casts del select exterior son necesarios: en un VALUES los literales
  -- salen como unknown/int4 y el tipo de retorno declarado no perdona.
  select c.kind::text, c.name::text, c.half::integer, c.periodos::integer, c.descanso::integer
    from (values
      ('querubin',    'Querubín',    12, 3,  4),
      ('prebenjamin', 'Prebenjamín', 20, 2, 15),
      ('benjamin',    'Benjamín',    25, 2, 15),
      ('alevin',      'Alevín',      30, 2, 15),
      ('infantil',    'Infantil',    35, 2, 15),
      ('cadete',      'Cadete',      40, 2, 15),
      ('juvenil',     'Juvenil',     45, 2, 15),
      ('amateur',     'Amateur',     45, 2, 15),
      ('senior',      'Sénior',      45, 2, 15),
      ('veterano',    'Veterano',    45, 2, 15)
    ) as c(kind, name, half, periodos, descanso);
$$;

comment on function public.standard_category_catalog() is
  'Catálogo canónico de las categorías estándar: kind, nombre, duración de CADA periodo regular (minutos), cuántos periodos regulares y el descanso entre ellos. Es la ÚNICA fuente del valor: seed_standard_categories y las migraciones de datos lo leen en vez de copiar la lista. Querubín son 3 × 12 con descansos de 4 en todos los clubes, no por configuración de club.';

revoke all on function public.standard_category_catalog() from public;
grant execute on function public.standard_category_catalog() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El semillero siembra el descanso.
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
      (club_id, name, kind, half_duration_minutes, period_count, break_minutes, is_standard)
      values (p_club_id, v_cat.name, v_cat.kind,
              v_cat.half_duration_minutes, v_cat.period_count, v_cat.break_minutes, true);
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El barrido del descanso, por kind y para todos los kinds del catálogo.
--    Es seguro barrer los diez y no solo querubín: la columna acaba de nacer, así
--    que no hay ningún valor de nadie que respetar — para los otros nueve el
--    catálogo dice 15, que es justo el default con el que han nacido, y el
--    `is distinct from` los deja fuera del UPDATE.
--    Imprime su cuenta: un bloque de reparación que calla no distingue el cero
--    «ya estaba bien» del cero «mi predicado no coge nada».
-- ─────────────────────────────────────────────────────────────────────────────
with cambiadas as (
  update public.categories c
     set break_minutes = k.break_minutes
    from public.standard_category_catalog() k
   where c.kind = k.kind
     and c.break_minutes is distinct from k.break_minutes
  returning c.id
)
select count(*) as descansos_corregidos from cambiadas;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GUARD: ninguna categoría de kind canónico queda fuera del catálogo, en las
--    TRES columnas. Que es más de lo que esta migración toca, a propósito: si el
--    barrido de la 20261123000000 se hubiera deshecho, esto lo caza aquí.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_fuera integer;
  v_total integer;
begin
  select count(*) into v_total
    from public.categories c
    join public.standard_category_catalog() k on k.kind = c.kind;

  select count(*) into v_fuera
    from public.categories c
    join public.standard_category_catalog() k on k.kind = c.kind
   where (c.half_duration_minutes, c.period_count, c.break_minutes)
         is distinct from (k.half_duration_minutes, k.period_count, k.break_minutes);

  if v_fuera > 0 then
    raise exception
      'GUARD: % de % categorías de kind canónico están fuera del catálogo (duración, periodos o descanso)',
      v_fuera, v_total;
  end if;

  raise notice 'GUARD ok: las % categorías de kind canónico coinciden con el catálogo', v_total;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El informe, como resultado: una fila por kind y club.
-- ─────────────────────────────────────────────────────────────────────────────
select cl.name as club,
       c.kind,
       c.period_count as periodos,
       c.half_duration_minutes as min_por_periodo,
       c.break_minutes as descanso,
       c.period_count * c.half_duration_minutes
         + (c.period_count - 1) * c.break_minutes as total_sugerido
  from public.categories c
  join public.clubs cl on cl.id = c.club_id
 where c.kind in ('querubin', 'prebenjamin', 'senior')
 order by cl.name, c.kind;
