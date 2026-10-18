-- ════════════════════════════════════════════════════════════════════════════
-- Slugs reservados en la tabla clubs: migración 20261129000000_clubs_slug_reservado_trigger,
-- para aplicarla en el SQL Editor de Supabase (copiando el `cat` de este fichero).
--
-- DEFINITIVO: aplica la migración y la registra en el ledger de migraciones. El ensayo es
-- `clubs-slug-reservado.ensayo.sql`: el MISMO fichero con v_ensayo = true y ROLLBACK.
--
-- Un test (packages/core/src/marketing-site/__tests__/clubs-slug-reservado-scripts.test.ts)
-- comprueba que el bloque entre las marcas es copia EXACTA de la migración y que ensayo y
-- definitivo solo se diferencian en v_ensayo y en el verbo final.
--
-- Las comprobaciones del final se hacen sobre un club real DENTRO de bloques que se
-- deshacen siempre: ni el ensayo ni el definitivo cambian ningún club.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ═══ MIGRACIÓN (copia literal de supabase/migrations/20261129000000_clubs_slug_reservado_trigger.sql) ═══
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
-- ═══ FIN DE LA MIGRACIÓN ═══

-- Ledger de migraciones: así un `db push` posterior no intenta aplicarla otra vez.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261129000000', 'clubs_slug_reservado_trigger')
on conflict (version) do nothing;

do $$
declare
  v_ensayo constant boolean := false;

  v_club    uuid;
  v_slug    text;
  v_clubes  int;
  v_ya      int;
  v_txt     text := '';
begin
  -- 1 · El trigger existe y está activo.
  if not exists (select 1 from pg_trigger where tgname = 'clubs_slug_no_reservado'
                   and tgrelid = 'public.clubs'::regclass and tgenabled = 'O') then
    raise exception 'Paso 1: el trigger clubs_slug_no_reservado no existe o no está activo.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261129000000') then
    raise exception 'Paso 1: la migración no ha quedado registrada en el ledger.';
  end if;
  select count(*) into v_clubes from public.clubs;
  select count(*) into v_ya from public.clubs where public.is_reserved_slug(slug);
  v_txt := v_txt || format(E'1 · trigger activo y migración registrada; %s clubes, %s con slug ya reservado\n', v_clubes, v_ya);

  -- 2 · Sobre un club real con slug normal (todo se deshace dentro de cada bloque).
  select id, slug into v_club, v_slug from public.clubs
   where not public.is_reserved_slug(slug) order by created_at limit 1;
  if v_club is null then
    v_txt := v_txt || E'2 · sin clubes con slug normal: comprobaciones sobre club real omitidas\n';
  else
    -- 2a · pasar a un slug reservado se rechaza
    begin
      update public.clubs set slug = 'funciones' where id = v_club;
      raise exception 'NO_RECHAZA';
    exception when others then
      if sqlerrm = 'NO_RECHAZA' then
        raise exception 'Paso 2a: el trigger NO rechaza pasar a un slug reservado.';
      elsif sqlerrm <> 'slug_reserved' then
        raise exception 'Paso 2a: esperaba slug_reserved y salió: %', sqlerrm;
      end if;
    end;
    -- 2b · dejar el mismo slug pasa (y se deshace)
    begin
      update public.clubs set slug = slug where id = v_club;
      raise exception 'DESHACER';
    exception when others then
      if sqlerrm <> 'DESHACER' then
        raise exception 'Paso 2b: rechaza un UPDATE que no cambia el slug: %', sqlerrm;
      end if;
    end;
    -- 2c · un INSERT con slug reservado se rechaza
    begin
      insert into public.clubs (id, name, slug) values (gen_random_uuid(), 'Prueba trigger', 'demo');
      raise exception 'NO_RECHAZA';
    exception when others then
      if sqlerrm = 'NO_RECHAZA' then
        raise exception 'Paso 2c: el trigger NO rechaza un INSERT con slug reservado.';
      elsif sqlerrm <> 'slug_reserved' then
        raise exception 'Paso 2c: esperaba slug_reserved y salió: %', sqlerrm;
      end if;
    end;
    if (select slug from public.clubs where id = v_club) is distinct from v_slug then
      raise exception 'Paso 2: el club de prueba ha cambiado de slug.';
    end if;
    v_txt := v_txt || format(E'2 · club «%s»: pasar a reservado RECHAZADO, mismo slug PERMITIDO, insert reservado RECHAZADO; sin cambios\n', v_slug);
  end if;

  if v_ensayo then
    raise exception E'ENSAYO CORRECTO, NADA APLICADO.\n%', v_txt;
  end if;
  raise notice E'APLICADO.\n%', v_txt;
end;
$$;

commit;
