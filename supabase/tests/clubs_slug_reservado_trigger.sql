-- Slugs reservados en la TABLA clubs (mig 20261129000000, trigger clubs_slug_no_reservado).
--
-- INVARIANTE: un club no puede PASAR a tener un slug reservado, por ningún camino (no solo
-- por platform_create_club). Lo prohibido es la transición, no el estado: un club que ya
-- tuviera un slug reservado sigue pudiendo editarse.
--
-- Casos (escribiendo en la tabla directamente, sin RPC):
--   S1. INSERT con slug reservado ('demo')                        → slug_reserved.
--   S2. INSERT con slug normal                                    → pasa.
--   S3. UPDATE de un slug normal a uno reservado ('calendario')   → slug_reserved.
--   S4. UPDATE de un slug normal a otro normal                    → pasa.
--   Club que YA tiene un slug reservado ('precios', puesto con el trigger desactivado):
--   S5. UPDATE de otra columna (name)                             → pasa.
--   S6. UPDATE que deja el MISMO slug (slug = slug)               → pasa.
--   S7. UPDATE a otro slug reservado ('blog')                     → slug_reserved.
--   S8. UPDATE a un slug normal (salir del reservado)             → pasa.

begin;

do $$
declare
  c_normal  constant uuid := 'f14a0003-0000-4000-8000-000000000001';
  c_legado  constant uuid := 'f14a0003-0000-4000-8000-000000000002';
begin
  -- Premisa: el trigger existe y las palabras de prueba están de verdad reservadas (si no,
  -- S1/S3/S7 pasarían por la razón equivocada).
  if not exists (select 1 from pg_trigger where tgname = 'clubs_slug_no_reservado'
                   and tgrelid = 'public.clubs'::regclass and not tgisinternal) then
    raise exception 'FAIL [premisa]: no existe el trigger clubs_slug_no_reservado';
  end if;
  if not (public.is_reserved_slug('demo') and public.is_reserved_slug('calendario')
          and public.is_reserved_slug('precios') and public.is_reserved_slug('blog')) then
    raise exception 'FAIL [premisa]: alguna palabra de prueba no está reservada';
  end if;
  if public.is_reserved_slug('slug-test-normal') or public.is_reserved_slug('slug-test-otro') then
    raise exception 'FAIL [premisa]: un slug de prueba "normal" está reservado';
  end if;

  -- S1
  begin
    insert into public.clubs (id, name, slug) values (gen_random_uuid(), 'Club Demo', 'demo');
    raise exception 'FAIL [S1]: INSERT con slug reservado debería fallar';
  exception when others then
    if sqlerrm <> 'slug_reserved' then raise exception 'FAIL [S1]: esperaba slug_reserved, obtuve "%"', sqlerrm; end if;
  end;

  -- S2
  insert into public.clubs (id, name, slug) values (c_normal, 'Club Normal', 'slug-test-normal');

  -- S3
  begin
    update public.clubs set slug = 'calendario' where id = c_normal;
    raise exception 'FAIL [S3]: UPDATE a slug reservado debería fallar';
  exception when others then
    if sqlerrm <> 'slug_reserved' then raise exception 'FAIL [S3]: esperaba slug_reserved, obtuve "%"', sqlerrm; end if;
  end;

  -- S4
  update public.clubs set slug = 'slug-test-otro' where id = c_normal;
  if (select slug from public.clubs where id = c_normal) <> 'slug-test-otro' then
    raise exception 'FAIL [S4]: el cambio a un slug normal no se aplicó';
  end if;

  -- Club «heredado» con un slug ya reservado: se crea con el trigger desactivado, que es
  -- como quedaría un club si mañana se reservara la palabra que ya usa.
  alter table public.clubs disable trigger clubs_slug_no_reservado;
  insert into public.clubs (id, name, slug) values (c_legado, 'Club Legado', 'precios');
  alter table public.clubs enable trigger clubs_slug_no_reservado;

  -- S5
  update public.clubs set name = 'Club Legado Renombrado' where id = c_legado;
  -- S6
  update public.clubs set slug = slug where id = c_legado;
  if (select name from public.clubs where id = c_legado) <> 'Club Legado Renombrado' then
    raise exception 'FAIL [S5]: el cambio de nombre no se aplicó';
  end if;

  -- S7
  begin
    update public.clubs set slug = 'blog' where id = c_legado;
    raise exception 'FAIL [S7]: pasar de un reservado a otro reservado debería fallar';
  exception when others then
    if sqlerrm <> 'slug_reserved' then raise exception 'FAIL [S7]: esperaba slug_reserved, obtuve "%"', sqlerrm; end if;
  end;

  -- S8
  update public.clubs set slug = 'slug-test-legado-ok' where id = c_legado;
  if (select slug from public.clubs where id = c_legado) <> 'slug-test-legado-ok' then
    raise exception 'FAIL [S8]: salir de un slug reservado a uno normal no se aplicó';
  end if;
end;
$$;

rollback;

\echo '✅ Slugs reservados: el trigger de clubs rechaza pasar a un reservado y deja editar el resto.'
