-- V-1 — patrocinadores y colaboradores del club (`club_partners`, mig 20261112000000).
--
-- QUÉ SE PROTEGE. Una tabla nueva con cuatro superficies de lectura por delante
-- (familia —que cubre jugador—, staff, dirección y seguidor) y un CRUD de web detrás.
-- Lo que no se puede permitir es que el gate diga una cosa y la pantalla otra, así que
-- lo que se fija aquí es el gate entero, incluido el muro de pago.
--
--   T0.  ESTRUCTURAL: la tabla, sus columnas, el trigger y el índice parcial.
--   T1.  Las policies existen, y el candado del muro es RESTRICTIVE.
--   T2.  Lee CUALQUIER miembro del club: admin, director, coordinador, entrenador,
--        tutor y jugador. Seis lecturas, no una.
--   T3.  NO lee quien es de otro club. Ni `anon`.
--   T4.  `active` lo filtra la POLICY: el miembro no ve el socio retirado; el que
--        gestiona SÍ lo ve.
--   T5.  Escriben admin_club y director: insert, update y delete.
--   T6.  NO escriben coordinador, entrenador_principal ni tutor.
--   T7.  Nada cruza de club: un admin del club A no puede escribir en el club B.
--   T8.  Los CHECK muerden: kind fuera de lista, url sin esquema, url `javascript:`,
--        logo_path que es una URL, nombre vacío.
--   T9.  EL MURO: encendido, la familia SIN suscripción ve 0; la que paga no pierde
--        nada; el entrenador tampoco (staff pasa gratis).
--   T10. El bucket `club-partner-logos` es PRIVADO: anon no ve, el miembro ve, admin y
--        director suben, el coordinador y el tutor no, y el admin de otro club no.
--        (DELETE no se prueba: `storage.protect_delete()` lo bloquea desde SQL puro.)
--   T11. CONTROL NEGATIVO del muro: sin `muro_pago_select`, la familia sin suscripción
--        vuelve a ver. Sin esto, T9 podría estar midiendo un fixture vacío.
--   T12. CONTROL NEGATIVO de la lectura: sin `club_partners_select_club_member`, un
--        miembro ve 0. Sin esto, T2 podría estar midiendo la policy de escritura.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture: dos clubes, los seis roles y un socio de cada tipo ──────────────
insert into public.clubs (id, name, slug) values
  ('cb000000-0000-4000-8000-0000000000a0', 'Club Socios A', 'club-socios-a'),
  ('cb000000-0000-4000-8000-0000000000b0', 'Club Socios B', 'club-socios-b');

insert into public.categories (id, club_id, name) values
  ('cb100000-0000-4000-8000-0000000000a0', 'cb000000-0000-4000-8000-0000000000a0', 'Cat A');
insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('cb200000-0000-4000-8000-0000000000a0', 'cb100000-0000-4000-8000-0000000000a0', 'Equipo A', 'F7', '#10B981', '2026-27', 'cb000000-0000-4000-8000-0000000000a0');

select pg_temp.new_test_user('cba00000-0000-4000-8000-00000000ad00', 'admin-a@socios.test');
select pg_temp.new_test_user('cba00000-0000-4000-8000-00000000d100', 'director-a@socios.test');
select pg_temp.new_test_user('cba00000-0000-4000-8000-00000000c000', 'coord-a@socios.test');
select pg_temp.new_test_user('cba00000-0000-4000-8000-0000000000e0', 'entre-a@socios.test');
-- Dos familias: p1 paga, p0 no tiene nada. Misma forma que el fixture del muro (M-3):
-- membership 'jugador' + vínculo de tutor en player_accounts.
select pg_temp.new_test_user('cba00000-0000-4000-8000-000000000001', 'paga-a@socios.test');
select pg_temp.new_test_user('cba00000-0000-4000-8000-000000000000', 'nopaga-a@socios.test');
select pg_temp.new_test_user('cba00000-0000-4000-8000-0000000000b1', 'admin-b@socios.test');

insert into public.memberships (id, profile_id, club_id, role) values
  ('cbf00000-0000-4000-8000-00000000ad00', 'cba00000-0000-4000-8000-00000000ad00', 'cb000000-0000-4000-8000-0000000000a0', 'admin_club'),
  ('cbf00000-0000-4000-8000-00000000d100', 'cba00000-0000-4000-8000-00000000d100', 'cb000000-0000-4000-8000-0000000000a0', 'director'),
  ('cbf00000-0000-4000-8000-00000000c000', 'cba00000-0000-4000-8000-00000000c000', 'cb000000-0000-4000-8000-0000000000a0', 'coordinador'),
  ('cbf00000-0000-4000-8000-0000000000e0', 'cba00000-0000-4000-8000-0000000000e0', 'cb000000-0000-4000-8000-0000000000a0', 'entrenador_principal'),
  ('cbf00000-0000-4000-8000-000000000001', 'cba00000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-0000000000a0', 'jugador'),
  ('cbf00000-0000-4000-8000-000000000000', 'cba00000-0000-4000-8000-000000000000', 'cb000000-0000-4000-8000-0000000000a0', 'jugador'),
  ('cbf00000-0000-4000-8000-0000000000b1', 'cba00000-0000-4000-8000-0000000000b1', 'cb000000-0000-4000-8000-0000000000b0', 'admin_club');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('cbb00000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-0000000000a0', 'Hijo', 'Paga',   '2013-04-01'),
  ('cbb00000-0000-4000-8000-000000000000', 'cb000000-0000-4000-8000-0000000000a0', 'Hijo', 'NoPaga', '2013-04-01');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('cbb00000-0000-4000-8000-000000000001', 'cba00000-0000-4000-8000-000000000001', 'parent'),
  ('cbb00000-0000-4000-8000-000000000000', 'cba00000-0000-4000-8000-000000000000', 'parent');

-- p1 paga; p0 no tiene fila.
insert into public.subscription_entitlements (profile_id, expires_at) values
  ('cba00000-0000-4000-8000-000000000001', now() + interval '200 days');

-- Dos socios activos en A (uno de cada tipo), uno RETIRADO en A, y uno en B.
insert into public.club_partners (id, club_id, kind, name, tagline, logo_path, url, sort_order, active) values
  ('cb300000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-0000000000a0', 'patrocinador', 'Ferretería Paco', 'Todo para tu casa', 'cb000000-0000-4000-8000-0000000000a0/paco.webp', 'https://ferreteriapaco.test', 1, true),
  ('cb300000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-0000000000a0', 'colaborador',  'Panadería Lola',  null,                'cb000000-0000-4000-8000-0000000000a0/lola.webp', 'https://panaderialola.test', 2, true),
  ('cb300000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-0000000000a0', 'patrocinador', 'Bar Retirado',    null,                'cb000000-0000-4000-8000-0000000000a0/bar.webp',  'https://barretirado.test',   3, false),
  ('cb300000-0000-4000-8000-0000000000b1', 'cb000000-0000-4000-8000-0000000000b0', 'patrocinador', 'Socio del club B', null,               'cb000000-0000-4000-8000-0000000000b0/b1.webp',   'https://sociob.test',        1, true);

-- Seed de logo en el bucket, como postgres (bypass RLS).
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('club-partner-logos', 'cb000000-0000-4000-8000-0000000000a0/paco.webp',
   'cba00000-0000-4000-8000-00000000ad00', '{}'::jsonb);

-- ── T0 · ESTRUCTURAL ────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='club_partners'
     and column_name in ('id','club_id','kind','name','tagline','logo_path','url',
                         'sort_order','active','created_at','updated_at');
  if v_n <> 11 then
    raise exception 'FAIL [T0]: faltan columnas en club_partners (encontradas %)', v_n;
  end if;

  if (select is_nullable from information_schema.columns
       where table_schema='public' and table_name='club_partners' and column_name='logo_path') <> 'NO' then
    raise exception 'FAIL [T0]: logo_path tiene que ser NOT NULL (un socio sin logo no se pinta)';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.club_partners'::regclass
                    and tgname = 'club_partners_set_updated_at') then
    raise exception 'FAIL [T0]: falta el trigger de updated_at';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname='public' and tablename='club_partners'
                    and indexname='club_partners_club_active_sort_idx') then
    raise exception 'FAIL [T0]: falta el indice parcial (club_id, sort_order) where active';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.club_partners'::regclass) then
    raise exception 'FAIL [T0]: la RLS no esta activada';
  end if;
end $$;

-- ── T1 · Las policies, y el candado RESTRICTIVE ─────────────────────────────
do $$
declare v_qual text; v_perm text;
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='club_partners'
                  and policyname='club_partners_select_club_member') then
    raise exception 'FAIL [T1]: falta la policy de lectura';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='club_partners'
                  and policyname='club_partners_write_admin_or_director') then
    raise exception 'FAIL [T1]: falta la policy de escritura';
  end if;

  -- La lectura tiene que llevar el filtro de `active` DENTRO: si vive solo en la
  -- consulta de la app, una de las cuatro superficies puede olvidarlo.
  select qual into v_qual from pg_policies
   where schemaname='public' and tablename='club_partners'
     and policyname='club_partners_select_club_member';
  if v_qual not like '%active%' then
    raise exception 'FAIL [T1]: la policy de lectura no filtra `active`: %', v_qual;
  end if;

  -- El muro: RESTRICTIVE, no permisiva. Una permisiva se SUMA a las otras y no
  -- cerraria nada — seria un candado que no cierra.
  select permissive, qual into v_perm, v_qual from pg_policies
   where schemaname='public' and tablename='club_partners' and policyname='muro_pago_select';
  if v_perm is null then
    raise exception 'FAIL [T1]: falta el candado del muro (muro_pago_select)';
  end if;
  if v_perm <> 'RESTRICTIVE' then
    raise exception 'FAIL [T1]: el candado del muro es % y tiene que ser RESTRICTIVE', v_perm;
  end if;
  if v_qual not like '%has_paid_access%' then
    raise exception 'FAIL [T1]: el candado del muro no llama a has_paid_access(): %', v_qual;
  end if;
end $$;

-- ── T2 · Lee cualquier miembro (muro APAGADO todavia) ───────────────────────
do $$
declare r record; v_n int;
begin
  for r in select * from (values
      ('admin',       'cba00000-0000-4000-8000-00000000ad00'),
      ('director',    'cba00000-0000-4000-8000-00000000d100'),
      ('coordinador', 'cba00000-0000-4000-8000-00000000c000'),
      ('entrenador',  'cba00000-0000-4000-8000-0000000000e0'),
      ('tutor paga',  'cba00000-0000-4000-8000-000000000001'),
      ('tutor no paga','cba00000-0000-4000-8000-000000000000')
    ) as t(quien, uid)
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    select count(*) into v_n from public.club_partners
     where club_id = 'cb000000-0000-4000-8000-0000000000a0' and active;
    perform set_config('role', 'postgres', true);
    if v_n <> 2 then
      raise exception 'FAIL [T2]: % tenia que ver los 2 socios activos y ve %', r.quien, v_n;
    end if;
  end loop;
end $$;

-- ── T3 · Aislamiento: otro club, y anon ─────────────────────────────────────
do $$
declare v_n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners
   where club_id = 'cb000000-0000-4000-8000-0000000000a0';
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    raise exception 'FAIL [T3]: el admin del club B ve % socios del club A', v_n;
  end if;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_n from public.club_partners;
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    raise exception 'FAIL [T3]: anon ve % socios, y no hay nada publico', v_n;
  end if;
end $$;

-- ── T4 · `active` lo filtra la policy ───────────────────────────────────────
do $$
declare v_n int;
begin
  -- El entrenador NO ve el retirado.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-0000000000e0","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners
   where id = 'cb300000-0000-4000-8000-000000000003';
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    raise exception 'FAIL [T4]: un miembro ve el socio RETIRADO: el filtro no esta en la policy';
  end if;

  -- El que gestiona SI lo ve (por su policy de escritura, que tambien es permisiva).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-00000000ad00","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners
   where id = 'cb300000-0000-4000-8000-000000000003';
  perform set_config('role', 'postgres', true);
  if v_n <> 1 then
    raise exception 'FAIL [T4]: el admin NO ve el socio retirado y no podria reactivarlo';
  end if;
end $$;

-- ── T5 · Escriben admin y director ──────────────────────────────────────────
do $$
declare r record;
begin
  for r in select * from (values
      ('admin',    'cba00000-0000-4000-8000-00000000ad00', 'cb300000-0000-4000-8000-00000000ff01'),
      ('director', 'cba00000-0000-4000-8000-00000000d100', 'cb300000-0000-4000-8000-00000000ff02')
    ) as t(quien, uid, nuevo)
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    begin
      insert into public.club_partners (id, club_id, kind, name, logo_path, url)
      values (r.nuevo::uuid, 'cb000000-0000-4000-8000-0000000000a0', 'colaborador',
              'Alta de ' || r.quien,
              'cb000000-0000-4000-8000-0000000000a0/nuevo.webp', 'https://nuevo.test');
      update public.club_partners set tagline = 'editado' where id = r.nuevo::uuid;
      delete from public.club_partners where id = r.nuevo::uuid;
    exception when others then
      perform set_config('role', 'postgres', true);
      raise exception 'FAIL [T5]: % tenia que poder gestionar socios y ha fallado con %', r.quien, sqlerrm;
    end;
    perform set_config('role', 'postgres', true);
  end loop;
end $$;

-- ── T6 · No escribe nadie mas ───────────────────────────────────────────────
do $$
declare r record; v_ok boolean;
begin
  for r in select * from (values
      ('coordinador',  'cba00000-0000-4000-8000-00000000c000'),
      ('entrenador',   'cba00000-0000-4000-8000-0000000000e0'),
      ('tutor',        'cba00000-0000-4000-8000-000000000001')
    ) as t(quien, uid)
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    v_ok := false;
    begin
      insert into public.club_partners (club_id, kind, name, logo_path, url)
      values ('cb000000-0000-4000-8000-0000000000a0', 'patrocinador', 'No deberia',
              'cb000000-0000-4000-8000-0000000000a0/no.webp', 'https://no.test');
      v_ok := true;
    exception when insufficient_privilege then
      null;  -- lo esperado: 42501
    end;
    perform set_config('role', 'postgres', true);
    if v_ok then
      raise exception 'FAIL [T6]: % ha podido crear un socio', r.quien;
    end if;
  end loop;
end $$;

-- ── T7 · Nada cruza de club ─────────────────────────────────────────────────
do $$
declare v_ok boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-00000000ad00","role":"authenticated"}', true);
  begin
    insert into public.club_partners (club_id, kind, name, logo_path, url)
    values ('cb000000-0000-4000-8000-0000000000b0', 'patrocinador', 'Intruso',
            'cb000000-0000-4000-8000-0000000000b0/x.webp', 'https://intruso.test');
    v_ok := true;
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if v_ok then
    raise exception 'FAIL [T7]: el admin del club A ha creado un socio en el club B';
  end if;
end $$;

-- ── T8 · Los CHECK muerden ──────────────────────────────────────────────────
do $$
declare r record; v_ok boolean;
begin
  for r in select * from (values
      ('kind inventado',    'sponsor',      'Nombre', 'cb000000-0000-4000-8000-0000000000a0/x.webp', 'https://x.test'),
      ('url sin esquema',   'patrocinador', 'Nombre', 'cb000000-0000-4000-8000-0000000000a0/x.webp', 'www.x.test'),
      ('url javascript',    'patrocinador', 'Nombre', 'cb000000-0000-4000-8000-0000000000a0/x.webp', 'javascript:alert(1)'),
      ('logo_path que es URL','patrocinador','Nombre', 'https://cdn.test/x.webp',                    'https://x.test'),
      ('nombre en blanco',  'patrocinador', '   ',    'cb000000-0000-4000-8000-0000000000a0/x.webp', 'https://x.test')
    ) as t(caso, kind, name, logo_path, url)
  loop
    v_ok := false;
    begin
      insert into public.club_partners (club_id, kind, name, logo_path, url)
      values ('cb000000-0000-4000-8000-0000000000a0', r.kind, r.name, r.logo_path, r.url);
      v_ok := true;
    exception when check_violation then
      null;
    end;
    if v_ok then
      raise exception 'FAIL [T8]: el esquema ha aceptado «%»', r.caso;
    end if;
  end loop;
end $$;

-- ── T9 · EL MURO ────────────────────────────────────────────────────────────
update public.subscription_wall set enabled = true, enabled_at = now() where id;

do $$
declare v_n int;
begin
  -- La familia que NO paga deja de ver socios.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners;
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    raise exception 'FAIL [T9]: con el muro encendido, quien no paga sigue viendo % socios', v_n;
  end if;

  -- La que paga no pierde nada.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners
   where club_id = 'cb000000-0000-4000-8000-0000000000a0';
  perform set_config('role', 'postgres', true);
  if v_n <> 2 then
    raise exception 'FAIL [T9]: a quien PAGA le quedan % socios (esperaba 2): el muro le recorta producto', v_n;
  end if;

  -- El staff pasa gratis (requires_subscription = false).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-0000000000e0","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners
   where club_id = 'cb000000-0000-4000-8000-0000000000a0';
  perform set_config('role', 'postgres', true);
  if v_n <> 2 then
    raise exception 'FAIL [T9]: al ENTRENADOR el muro le dejo % socios (esperaba 2)', v_n;
  end if;
end $$;

-- ── T10 · El bucket es PRIVADO y tiene su gate ──────────────────────────────
do $$
declare v_pub boolean; v_n int; v_ok boolean;
begin
  select public into v_pub from storage.buckets where id = 'club-partner-logos';
  if v_pub is null then
    raise exception 'FAIL [T10]: no existe el bucket club-partner-logos';
  end if;
  if v_pub then
    raise exception 'FAIL [T10]: el bucket es PUBLICO, y la decision era que nada es publico';
  end if;

  -- anon no ve nada.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into v_n from storage.objects where bucket_id = 'club-partner-logos';
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    raise exception 'FAIL [T10]: anon ve % objetos del bucket privado', v_n;
  end if;

  -- El miembro (entrenador) SI ve el logo: sin esto no se puede firmar la URL.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-0000000000e0","role":"authenticated"}', true);
  select count(*) into v_n from storage.objects
   where bucket_id = 'club-partner-logos'
     and name = 'cb000000-0000-4000-8000-0000000000a0/paco.webp';
  perform set_config('role', 'postgres', true);
  if v_n <> 1 then
    raise exception 'FAIL [T10]: un miembro del club no ve el logo (cnt=%)', v_n;
  end if;

  -- El admin de OTRO club no lo ve.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
  select count(*) into v_n from storage.objects where bucket_id = 'club-partner-logos';
  perform set_config('role', 'postgres', true);
  if v_n <> 0 then
    raise exception 'FAIL [T10]: el admin del club B ve % logos del club A', v_n;
  end if;

  -- Suben admin y director.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-00000000d100","role":"authenticated"}', true);
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values
      ('club-partner-logos', 'cb000000-0000-4000-8000-0000000000a0/del-director.webp',
       'cba00000-0000-4000-8000-00000000d100', '{}'::jsonb);
  exception when others then
    perform set_config('role', 'postgres', true);
    raise exception 'FAIL [T10]: el DIRECTOR no ha podido subir un logo: %', sqlerrm;
  end;
  perform set_config('role', 'postgres', true);

  -- No sube el coordinador.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-00000000c000","role":"authenticated"}', true);
  v_ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values
      ('club-partner-logos', 'cb000000-0000-4000-8000-0000000000a0/del-coord.webp',
       'cba00000-0000-4000-8000-00000000c000', '{}'::jsonb);
    v_ok := true;
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if v_ok then
    raise exception 'FAIL [T10]: el coordinador ha podido subir un logo';
  end if;

  -- Ni el tutor.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  v_ok := false;
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values
      ('club-partner-logos', 'cb000000-0000-4000-8000-0000000000a0/del-tutor.webp',
       'cba00000-0000-4000-8000-000000000001', '{}'::jsonb);
    v_ok := true;
  exception when insufficient_privilege then
    null;
  end;
  perform set_config('role', 'postgres', true);
  if v_ok then
    raise exception 'FAIL [T10]: el TUTOR ha podido subir un logo';
  end if;
end $$;

-- ── T11 · CONTROL NEGATIVO del muro ─────────────────────────────────────────
-- Va al final y aislado: si se quitara antes, las aserciones de arriba medirian otro
-- mundo. El muro sigue ENCENDIDO de T9; lo unico que cambia es el candado.
do $$
declare v_n int;
begin
  drop policy muro_pago_select on public.club_partners;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners;
  perform set_config('role', 'postgres', true);

  if v_n = 0 then
    raise exception 'FAIL [T11]: sin el candado, quien no paga SIGUE sin ver socios — entonces T9 no estaba midiendo el muro, sino un fixture vacio o la policy de club';
  end if;
end $$;

-- ── T12 · CONTROL NEGATIVO de la lectura ────────────────────────────────────
do $$
declare v_n int;
begin
  drop policy club_partners_select_club_member on public.club_partners;

  -- El entrenador ya no tiene NINGUNA policy que le deje leer (no gestiona).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cba00000-0000-4000-8000-0000000000e0","role":"authenticated"}', true);
  select count(*) into v_n from public.club_partners;
  perform set_config('role', 'postgres', true);

  if v_n <> 0 then
    raise exception 'FAIL [T12]: sin la policy de lectura el entrenador aun ve % socios — T2 estaba midiendo otra cosa', v_n;
  end if;
end $$;

rollback;
