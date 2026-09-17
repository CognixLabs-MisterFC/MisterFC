-- Una foto sin decisión registrada NO se ve (migración 20261079000000).
--
-- Lo que se prueba:
--   [1] Sin ninguna fila de `image_internal` → player_photo_visible = false.
--       Antes de la migración esto era TRUE: el silencio contaba como permiso.
--   [2] Con una concesión explícita → true.
--   [3] Concesión y luego retirada → false. La regla de #548 (manda la última fila)
--       sigue en pie: esto no la sustituye, convive con ella.
--   [4] Jugador suprimido con concesión vigente → false. El erased_at manda.
--   [5] Y lo que de verdad importa: el END-TO-END por la RLS de storage. Un miembro
--       del club NO puede leer el objeto del bucket mientras no haya decisión, y SÍ
--       en cuanto la hay. Es el único consumidor de la función, así que es el único
--       sitio donde se nota.
--   [6] Nadie ha reabierto la función: anon no puede ejecutarla, PUBLIC tampoco.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('fa000000-0000-4000-8000-000000000001', 'Club Foto', 'club-foto');

insert into public.seasons (id, club_id, label, status) values
  ('fa0c0000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', '2026-27', 'active');

select pg_temp.new_test_user('fa0a0000-0000-4000-8000-000000000001', 'tutor@foto.test', '{"full_name": "Tutor Foto"}'::jsonb);
select pg_temp.new_test_user('fa0a0000-0000-4000-8000-000000000002', 'admin@foto.test', '{"full_name": "Admin Foto"}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('fa0a0000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'jugador'),
  ('fa0a0000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000001', 'admin_club');

--  sin      = jugador SIN ninguna fila de image_internal (el caso del default)
--  con      = jugador con concesión explícita
--  borrado  = jugador con concesión explícita pero suprimido
insert into public.players (id, club_id, first_name, last_name, date_of_birth, erased_at) values
  ('fa0b0000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000001', 'Sin', 'Decision', (current_date - interval '12 years')::date, null),
  ('fa0b0000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000001', 'Con', 'Decision', (current_date - interval '12 years')::date, null),
  ('fa0b0000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000001', 'Borrado', 'Decision', (current_date - interval '12 years')::date, now());

insert into public.player_accounts (player_id, profile_id, relation) values
  ('fa0b0000-0000-4000-8000-000000000001', 'fa0a0000-0000-4000-8000-000000000001', 'parent'),
  ('fa0b0000-0000-4000-8000-000000000002', 'fa0a0000-0000-4000-8000-000000000001', 'parent'),
  ('fa0b0000-0000-4000-8000-000000000003', 'fa0a0000-0000-4000-8000-000000000001', 'parent');

-- Los textos: el trigger `clubs_seed_legal_documents` ya los sembró al crear el club.
create or replace function pg_temp.doc(p_type public.legal_document_type) returns uuid
language sql stable as $$
  select id from public.legal_documents
   where club_id = 'fa000000-0000-4000-8000-000000000001' and doc_type = p_type and version = 1
$$;

insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('fa0a0000-0000-4000-8000-000000000001', 'fa0b0000-0000-4000-8000-000000000002', 'image_internal', true,
   pg_temp.doc('image_internal'), 1, 'fa0c0000-0000-4000-8000-000000000001'),
  ('fa0a0000-0000-4000-8000-000000000001', 'fa0b0000-0000-4000-8000-000000000003', 'image_internal', true,
   pg_temp.doc('image_internal'), 1, 'fa0c0000-0000-4000-8000-000000000001');

-- Un objeto en la carpeta de cada jugador (como postgres, saltándose la RLS).
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('player-photos', 'fa0b0000-0000-4000-8000-000000000001/seed.webp', 'fa0a0000-0000-4000-8000-000000000001', '{}'::jsonb),
  ('player-photos', 'fa0b0000-0000-4000-8000-000000000002/seed.webp', 'fa0a0000-0000-4000-8000-000000000001', '{}'::jsonb);

-- ── [1] Sin decisión registrada NO se ve ─────────────────────────────────────
do $$
begin
  if public.player_photo_visible('fa0b0000-0000-4000-8000-000000000001') is not false then
    raise exception '[1] una foto SIN decision registrada se sigue viendo: el silencio cuenta como permiso';
  end if;
end $$;

-- ── [2] Con concesión explícita SÍ ───────────────────────────────────────────
do $$
begin
  if public.player_photo_visible('fa0b0000-0000-4000-8000-000000000002') is not true then
    raise exception '[2] una concesion explicita NO hace visible la foto';
  end if;
end $$;

-- ── [3] Y la retirada sigue mandando (regla de #548: gana la ultima fila) ────
do $$
begin
  insert into public.consents
    (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
    ('fa0a0000-0000-4000-8000-000000000001', 'fa0b0000-0000-4000-8000-000000000002', 'image_internal', false,
     pg_temp.doc('image_internal'), 1, 'fa0c0000-0000-4000-8000-000000000001');

  if public.player_photo_visible('fa0b0000-0000-4000-8000-000000000002') is not false then
    raise exception '[3] tras retirar, la foto sigue visible';
  end if;

  -- y se vuelve a conceder: no es "gana la restrictiva", es "gana la ultima".
  insert into public.consents
    (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
    ('fa0a0000-0000-4000-8000-000000000001', 'fa0b0000-0000-4000-8000-000000000002', 'image_internal', true,
     pg_temp.doc('image_internal'), 1, 'fa0c0000-0000-4000-8000-000000000001');

  if public.player_photo_visible('fa0b0000-0000-4000-8000-000000000002') is not true then
    raise exception '[3] una concesion posterior no vuelve a hacer visible la foto';
  end if;
end $$;

-- ── [4] Suprimido manda sobre la concesion ───────────────────────────────────
do $$
begin
  if public.player_photo_visible('fa0b0000-0000-4000-8000-000000000003') is not false then
    raise exception '[4] un jugador suprimido con concesion vigente sigue enseñando la foto';
  end if;
end $$;

-- ── [5] END-TO-END: la RLS de storage, que es el unico consumidor ────────────
--
-- El admin del club pasa `user_can_see_player` en los dos casos. Lo unico que los
-- separa es `player_photo_visible`. Ancla positiva primero: si el bloque solo
-- comprobara la ausencia, un fixture roto lo daria por bueno.
do $$
declare v_con integer; v_sin integer;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"fa0a0000-0000-4000-8000-000000000002","role":"authenticated"}';

  select count(*) into v_con from storage.objects
   where bucket_id = 'player-photos'
     and name = 'fa0b0000-0000-4000-8000-000000000002/seed.webp';

  select count(*) into v_sin from storage.objects
   where bucket_id = 'player-photos'
     and name = 'fa0b0000-0000-4000-8000-000000000001/seed.webp';

  reset role;

  if v_con <> 1 then
    raise exception '[5] el miembro del club NO lee la foto CON consentimiento (cnt=%): el fixture no prueba nada', v_con;
  end if;
  if v_sin <> 0 then
    raise exception '[5] el miembro del club LEE la foto SIN decision registrada (cnt=%)', v_sin;
  end if;
end $$;

-- ── [6] La funcion sigue cerrada a anon y a PUBLIC ───────────────────────────
do $$
declare v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'player_photo_visible';

  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception '[6] anon puede ejecutar player_photo_visible';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '[6] authenticated NO puede ejecutarla: la policy de storage dejaria de evaluarse';
  end if;
  if (select count(*) from aclexplode((select proacl from pg_proc where oid = v_oid))
       where grantee = 0) > 0 then
    raise exception '[6] la ACL sigue concediendo a PUBLIC';
  end if;
end $$;

rollback;
