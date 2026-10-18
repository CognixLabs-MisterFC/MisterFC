-- Slugs reservados también en la TABLA, no solo en las RPC.
--
-- CONTEXTO: `public.is_reserved_slug` (20261030000000, ampliada en 20261125000000) es la
-- lista de segmentos de ruta que un club no puede usar como slug: si lo usara, su login en
-- `misterfc.es/{slug}` quedaría tapado por la ruta (p. ej. `funciones` o `calendario`).
-- Hasta ahora solo la consultaba `platform_create_club`. Cualquier otro camino la saltaba:
-- un UPDATE directo, el SQL Editor, el service role o una RPC futura de «cambiar slug».
-- La tabla solo comprobaba el formato (regex) y que no se repitiera.
--
-- QUÉ HACE: un trigger BEFORE INSERT OR UPDATE OF slug en `clubs` que rechaza con el MISMO
-- error que la RPC (`slug_reserved`, P0001), así que la app ya sabe traducirlo.
--
-- SOLO CUANDO EL SLUG CAMBIA (un INSERT, o un UPDATE con un slug distinto del que había).
-- Es la transición lo que se prohíbe, no el estado: si mañana se reserva una palabra que
-- algún club ya usa, ese club sigue funcionando y se puede editar con normalidad; lo único
-- que no puede es PASAR a un slug reservado. Por eso tampoco se toca ningún club existente.
--
-- Al aplicarla imprime cuántos clubes tienen YA un slug reservado (y cuáles), también
-- cuando son cero.

create or replace function public.clubs_slug_no_reservado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or new.slug is distinct from old.slug)
     and public.is_reserved_slug(new.slug) then
    raise exception 'slug_reserved' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.clubs_slug_no_reservado() from public;

drop trigger if exists clubs_slug_no_reservado on public.clubs;
create trigger clubs_slug_no_reservado
  before insert or update of slug on public.clubs
  for each row execute function public.clubs_slug_no_reservado();

-- Aviso: clubes que YA tienen un slug reservado. No se tocan (el trigger solo mira
-- cambios); se listan para que se sepa que existen.
do $$
declare
  v_n     int;
  v_lista text;
begin
  select count(*), string_agg(slug, ', ' order by slug)
    into v_n, v_lista
    from public.clubs
   where public.is_reserved_slug(slug);
  raise notice 'clubs_slug_no_reservado: % club(es) con un slug ya reservado%',
    v_n, case when v_n > 0 then ': ' || v_lista else '' end;
end;
$$;
