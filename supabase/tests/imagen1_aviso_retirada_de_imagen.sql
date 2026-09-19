-- Aviso al club al RETIRAR el consentimiento de imagen (migs 20261087000000 y
-- 20261088000000). Cubre:
--   [1] La retirada por la RPC avisa a admin, director y al ENTRENADOR del equipo
--       del jugador, y NO al tutor que la pide.
--   [2] El aviso dice CUAL: el payload lleva consent_type. Un aviso generico no
--       valdria (decision de Jose).
--   [3] LA TRAMPA: `granted=false` SIN concesion previa NO avisa. Es el «no» del
--       alta, no una retirada: no hay nada publicado que quitar.
--   [4] El director que ADEMAS entrena ese equipo recibe UNA sola fila.
--   [5] No lo reciben: el staff de OTRO equipo, la membresia DE BAJA, ni el que
--       dejo el equipo (left_at).
--   [6] Retirar un consentimiento que NO es de imagen no avisa (el WHEN).
--   [7] image_social tambien avisa, y lo dice.
--   [8] El payload NO lleva nombres (BC-7a): exactamente player_id, club_id y
--       consent_type.
--   [9] Best-effort: sin nadie a quien avisar, la retirada se registra igual.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('c1000000-0000-4000-8000-000000000001', 'Club IMG', 'club-img'),
  ('c1000000-0000-4000-8000-000000000002', 'Club Vacio', 'club-vacio');

insert into public.seasons (id, club_id, label, status) values
  ('c10c0000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', '2026-27', 'active'),
  ('c10c0000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', '2026-27', 'active');

insert into public.categories (id, club_id, name) values
  ('c10d0000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Cadete');

insert into public.teams (id, club_id, category_id, name, format, season) values
  ('c10e0000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'c10d0000-0000-4000-8000-000000000001', 'Cadete A', 'F11', '2026-27'),
  ('c10e0000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
   'c10d0000-0000-4000-8000-000000000001', 'Cadete B', 'F11', '2026-27');

--  1 tutor      · retira (no debe recibir su propio aviso)
--  2 admin      · direccion
--  3 director   · direccion
--  4 coachA     · entrena el equipo del jugador  → SI
--  5 coachB     · entrena OTRO equipo            → NO
--  6 dirCoach   · director Y entrenador del equipo → UNA fila, no dos
--  7 exCoach    · entrenaba el equipo y lo dejo  → NO
--  8 dirBaja    · director DE BAJA en el club    → NO
--  9 tutor2     · tutor del club vacio           · [9]
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000001', 'tutor@img.test',    '{"full_name": "Tutor"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000002', 'admin@img.test',    '{"full_name": "Admin"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000003', 'director@img.test', '{"full_name": "Director"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000004', 'coacha@img.test',   '{"full_name": "Coach A"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000005', 'coachb@img.test',   '{"full_name": "Coach B"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000006', 'dircoach@img.test', '{"full_name": "Dir Coach"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000007', 'excoach@img.test',  '{"full_name": "Ex Coach"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000008', 'dirbaja@img.test',  '{"full_name": "Dir Baja"}'::jsonb);
select pg_temp.new_test_user('c10a0000-0000-4000-8000-000000000009', 'tutor2@img.test',   '{"full_name": "Tutor 2"}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('c10f0000-0000-4000-8000-000000000001', 'c10a0000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'jugador', null),
  ('c10f0000-0000-4000-8000-000000000002', 'c10a0000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'admin_club', null),
  ('c10f0000-0000-4000-8000-000000000003', 'c10a0000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'director', null),
  ('c10f0000-0000-4000-8000-000000000004', 'c10a0000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'entrenador_principal', null),
  ('c10f0000-0000-4000-8000-000000000005', 'c10a0000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000001', 'entrenador_principal', null),
  ('c10f0000-0000-4000-8000-000000000006', 'c10a0000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000001', 'director', null),
  ('c10f0000-0000-4000-8000-000000000007', 'c10a0000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null),
  ('c10f0000-0000-4000-8000-000000000008', 'c10a0000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000001', 'director', current_date),
  ('c10f0000-0000-4000-8000-000000000009', 'c10a0000-0000-4000-8000-000000000009', 'c1000000-0000-4000-8000-000000000002', 'jugador', null);

-- coachA y dirCoach entrenan el equipo del jugador; coachB el otro; exCoach lo dejo.
insert into public.team_staff (team_id, membership_id, staff_role, left_at) values
  ('c10e0000-0000-4000-8000-000000000001', 'c10f0000-0000-4000-8000-000000000004', 'principal', null),
  ('c10e0000-0000-4000-8000-000000000001', 'c10f0000-0000-4000-8000-000000000006', 'delegado', null),
  ('c10e0000-0000-4000-8000-000000000002', 'c10f0000-0000-4000-8000-000000000005', 'principal', null),
  ('c10e0000-0000-4000-8000-000000000001', 'c10f0000-0000-4000-8000-000000000007', 'ayudante', current_date);

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('c10b0000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Hijo', 'Img', (current_date - interval '13 years')::date),
  ('c10b0000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Solo', 'Img', (current_date - interval '13 years')::date);

insert into public.team_members (player_id, team_id) values
  ('c10b0000-0000-4000-8000-000000000001', 'c10e0000-0000-4000-8000-000000000001');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('c10b0000-0000-4000-8000-000000000001', 'c10a0000-0000-4000-8000-000000000001', 'parent'),
  ('c10b0000-0000-4000-8000-000000000002', 'c10a0000-0000-4000-8000-000000000009', 'parent');

create or replace function pg_temp.doc(p_club uuid, p_type public.legal_document_type) returns uuid
language sql stable as $$
  select id from public.legal_documents
   where club_id = p_club and doc_type = p_type and version = 1
$$;

create or replace function pg_temp.avisos(p_consent uuid) returns bigint
language sql stable as $$
  select count(*) from public.notifications
   where type = 'image_consent_revoked'
     and dedupe_key like 'image_consent_revoked:' || p_consent::text || ':%'
$$;

create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- Concesiones vivas del tutor sobre su hijo.
insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('c10a0000-0000-4000-8000-000000000001', 'c10b0000-0000-4000-8000-000000000001', 'image_internal', true,
   pg_temp.doc('c1000000-0000-4000-8000-000000000001', 'image_internal'), 1, 'c10c0000-0000-4000-8000-000000000001'),
  ('c10a0000-0000-4000-8000-000000000001', 'c10b0000-0000-4000-8000-000000000001', 'image_social', true,
   pg_temp.doc('c1000000-0000-4000-8000-000000000001', 'image_social'), 1, 'c10c0000-0000-4000-8000-000000000001'),
  ('c10a0000-0000-4000-8000-000000000001', 'c10b0000-0000-4000-8000-000000000001', 'medical_data_processing', true,
   pg_temp.doc('c1000000-0000-4000-8000-000000000001', 'medical_informed_consent'), 1, 'c10c0000-0000-4000-8000-000000000001');

-- ── [1][2][4][5][8] La retirada por la RPC ───────────────────────────────────
do $$
declare v_id uuid; v_n bigint; v_claves text[];
begin
  perform pg_temp.como('c10a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent(
    'c10b0000-0000-4000-8000-000000000001', 'image_internal', '10.0.0.1', 'pgTAP');
  reset role;

  select c.id into v_id from public.consents c
   where c.player_id = 'c10b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'image_internal' and c.granted = false
   order by c.accepted_at desc, c.seq desc limit 1;
  if v_id is null then raise exception '[1] la retirada no se registro'; end if;

  -- admin + director + coachA + dirCoach = 4. Ni el tutor, ni coachB, ni exCoach,
  -- ni el director de baja.
  select pg_temp.avisos(v_id) into v_n;
  if v_n <> 4 then raise exception '[1] esperaba 4 avisos, hay %', v_n; end if;

  if exists (select 1 from public.notifications
              where dedupe_key like 'image_consent_revoked:' || v_id::text || ':%'
                and user_id = 'c10a0000-0000-4000-8000-000000000001') then
    raise exception '[1] el tutor que retira recibio su propio aviso';
  end if;

  -- [5] los tres que no deben estar
  if exists (select 1 from public.notifications
              where dedupe_key like 'image_consent_revoked:' || v_id::text || ':%'
                and user_id in ('c10a0000-0000-4000-8000-000000000005',
                                'c10a0000-0000-4000-8000-000000000007',
                                'c10a0000-0000-4000-8000-000000000008')) then
    raise exception '[5] aviso a quien no toca (otro equipo, ex-entrenador o baja)';
  end if;

  -- [4] el director que ademas entrena: UNA fila
  select count(*) into v_n from public.notifications
   where dedupe_key like 'image_consent_revoked:' || v_id::text || ':%'
     and user_id = 'c10a0000-0000-4000-8000-000000000006';
  if v_n <> 1 then raise exception '[4] dirCoach tiene % avisos, esperaba 1', v_n; end if;

  -- [2] dice CUAL
  if not exists (select 1 from public.notifications
                  where dedupe_key like 'image_consent_revoked:' || v_id::text || ':%'
                    and payload->>'consent_type' = 'image_internal') then
    raise exception '[2] el aviso no dice que se retiro image_internal';
  end if;

  -- [8] ids y nada mas
  select array(select jsonb_object_keys(payload) order by 1) into v_claves
    from public.notifications
   where dedupe_key like 'image_consent_revoked:' || v_id::text || ':%' limit 1;
  if v_claves <> array['club_id','consent_type','player_id'] then
    raise exception '[8] el payload lleva claves de mas o de menos: %', v_claves;
  end if;
end $$;

-- ── [7] image_social tambien avisa, y lo dice ────────────────────────────────
do $$
declare v_id uuid; v_n bigint;
begin
  perform pg_temp.como('c10a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent(
    'c10b0000-0000-4000-8000-000000000001', 'image_social', null, 'pgTAP');
  reset role;

  select c.id into v_id from public.consents c
   where c.player_id = 'c10b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'image_social' and c.granted = false
   order by c.accepted_at desc, c.seq desc limit 1;

  select pg_temp.avisos(v_id) into v_n;
  if v_n <> 4 then raise exception '[7] image_social: esperaba 4 avisos, hay %', v_n; end if;

  if not exists (select 1 from public.notifications
                  where dedupe_key like 'image_consent_revoked:' || v_id::text || ':%'
                    and payload->>'consent_type' = 'image_social') then
    raise exception '[7] el aviso no distingue image_social de image_internal';
  end if;
end $$;

-- ── [6] lo que NO es imagen no avisa ─────────────────────────────────────────
do $$
declare v_id uuid; v_n bigint;
begin
  perform pg_temp.como('c10a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent(
    'c10b0000-0000-4000-8000-000000000001', 'medical_data_processing', null, 'pgTAP');
  reset role;

  select c.id into v_id from public.consents c
   where c.player_id = 'c10b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'medical_data_processing' and c.granted = false
   order by c.accepted_at desc, c.seq desc limit 1;

  select pg_temp.avisos(v_id) into v_n;
  if v_n <> 0 then raise exception '[6] la medica genero % avisos', v_n; end if;
end $$;

-- ── [3] LA TRAMPA: un «no» del alta, sin concesion previa, NO avisa ──────────
do $$
declare v_id uuid; v_n bigint;
begin
  insert into public.consents
    (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id)
  values
    ('c10a0000-0000-4000-8000-000000000009', 'c10b0000-0000-4000-8000-000000000002', 'image_internal', false,
     pg_temp.doc('c1000000-0000-4000-8000-000000000002', 'image_internal'), 1, 'c10c0000-0000-4000-8000-000000000002')
  returning id into v_id;

  select pg_temp.avisos(v_id) into v_n;
  if v_n <> 0 then
    raise exception '[3] un «no» de siempre genero % avisos: no hay nada que retirar', v_n;
  end if;

  -- [9] Y la fila queda registrada igual, hubiera o no a quien avisar.
  if not exists (select 1 from public.consents where id = v_id) then
    raise exception '[9] la decision no se registro';
  end if;
end $$;

-- ── [9] retirada de verdad en un club SIN direccion ni staff ─────────────────
do $$
declare v_id uuid; v_n bigint;
begin
  insert into public.consents
    (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id)
  values
    ('c10a0000-0000-4000-8000-000000000009', 'c10b0000-0000-4000-8000-000000000002', 'image_social', true,
     pg_temp.doc('c1000000-0000-4000-8000-000000000002', 'image_social'), 1, 'c10c0000-0000-4000-8000-000000000002');

  insert into public.consents
    (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id)
  values
    ('c10a0000-0000-4000-8000-000000000009', 'c10b0000-0000-4000-8000-000000000002', 'image_social', false,
     pg_temp.doc('c1000000-0000-4000-8000-000000000002', 'image_social'), 1, 'c10c0000-0000-4000-8000-000000000002')
  returning id into v_id;

  select pg_temp.avisos(v_id) into v_n;
  if v_n <> 0 then raise exception '[9] club sin nadie: esperaba 0 avisos, hay %', v_n; end if;
  if not exists (select 1 from public.consents where id = v_id) then
    raise exception '[9] la retirada no se registro cuando no hay a quien avisar';
  end if;
end $$;

select 'imagen1_aviso_retirada_de_imagen OK' as resultado;

rollback;
