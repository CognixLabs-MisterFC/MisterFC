-- Web comercial (W1) — slugs reservados nuevos (mig 20261125000000).
--
-- INVARIANTE: ningún club puede crearse con un slug que coincida con una ruta de la web
-- comercial o con una ruta de la app que faltaba en la lista. Un slug normal pasa.
--
-- Casos:
--   W1. crear club con slug 'demo' (web comercial) → FALLA (slug_reserved).
--   W2. crear club con slug 'miembros' (ruta de la app que faltaba) → FALLA.
--   W3. is_reserved_slug: las 19 nuevas reservadas; los slugs de clubes reales, no.
--   W4. crear club con slug normal 'ribera-nord' → PASA.
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('f14a0002-0000-4000-8000-000000000001', 'web-w1-super@test.local', '{"full_name":"Web W1 Super"}'::jsonb);
insert into public.platform_admins (profile_id) values ('f14a0002-0000-4000-8000-000000000001');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f14a0002-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_slug     text;
  v_club_id  uuid;
  v_cuenta   int := 0;
begin
  -- Premisa: el caller es superadmin; si no, todo fallaría con 'forbidden' y W1/W2
  -- pasarían por la razón equivocada.
  if not public.is_superadmin() then
    raise exception 'FAIL [premisa]: el caller no es superadmin';
  end if;

  foreach v_slug in array array['demo', 'miembros'] loop
    begin
      perform public.platform_create_club('Club ' || v_slug, v_slug, 'es');
      raise exception 'FAIL [W1/W2]: crear club con slug reservado "%" debería fallar', v_slug;
    exception
      when others then
        if sqlerrm <> 'slug_reserved' then
          raise exception 'FAIL [W1/W2] "%": esperaba slug_reserved, obtuve "%"', v_slug, sqlerrm;
        end if;
    end;
  end loop;

  foreach v_slug in array array[
    'aplicacion','cuenta-eliminada','miembros','patrocinadores','suscripcion',
    'abrir-invitacion','categorias','monitoring',
    'funciones','seguridad','demo','portada',
    'precios','contacto','soporte','ayuda','blog','empresa','clientes'] loop
    if not public.is_reserved_slug(v_slug) then
      raise exception 'FAIL [W3]: "%" debería estar reservado', v_slug;
    end if;
    v_cuenta := v_cuenta + 1;
  end loop;
  raise notice 'W3: % slugs nuevos reservados', v_cuenta;
  if public.is_reserved_slug('udfonteta') or public.is_reserved_slug('club-beta-test') then
    raise exception 'FAIL [W3]: un slug de club real ha quedado reservado';
  end if;

  v_club_id := public.platform_create_club('Ribera Nord CF', 'ribera-nord', 'es');
  if v_club_id is null then
    raise exception 'FAIL [W4]: un slug normal debería crear el club';
  end if;
end;
$$;

rollback;

\echo '✅ Web W1: slugs de la web comercial y rutas que faltaban, reservados.'
