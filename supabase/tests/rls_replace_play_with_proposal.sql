-- B1 (v2 de propuestas) — RPC replace_play_with_proposal (migración 20260816000001).
--
-- Cubre: gate de aprobador (no-aprobador → 42501); sustitución (vuelca la propuesta
-- sobre la original = MISMO registro published, owner/estado intactos; consume la
-- propuesta); team_plays (vínculo + signal_id) preservado; rechazo si la "propuesta"
-- no tiene source_play_id. Estilo: aserciones con raise exception; transaccional.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('b2c00000-0000-4000-8000-000000000001', 'Club Repl', 'club-repl');

insert into public.categories (id, club_id, name) values
  ('b2ca0000-0000-4000-8000-000000000001', 'b2c00000-0000-4000-8000-000000000001', 'Cat R');

insert into public.teams (id, category_id, name, format, color, season) values
  ('b2700000-0000-4000-8000-000000000001', 'b2ca0000-0000-4000-8000-000000000001', 'Team R', 'F11', '#10B981', '2025-26');

select pg_temp.new_test_user('b2a00000-0000-4000-8000-00000000000a', 'adminR@repl.test', '{}'::jsonb);
select pg_temp.new_test_user('b2a00000-0000-4000-8000-00000000000c', 'principalR@repl.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('b2550000-0000-4000-8000-00000000000a', 'b2a00000-0000-4000-8000-00000000000a', 'b2c00000-0000-4000-8000-000000000001', 'admin_club'),
  ('b2550000-0000-4000-8000-00000000000c', 'b2a00000-0000-4000-8000-00000000000c', 'b2c00000-0000-4000-8000-000000000001', 'entrenador_principal');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('b2700000-0000-4000-8000-000000000001', 'b2550000-0000-4000-8000-00000000000c', 'entrenador_principal');

-- Original PUBLISHED (owner = admin) + propuesta de cambios (owner = principal) +
-- una propuesta SIN source. Plays jsonb mínimos válidos (frames 1..60).
--
-- La ORIGINAL nace 'published': plays_validate exige aprobador para crearla así.
-- Antes colaba sembrándola como superuser (auth.uid() NULL → user_can_approve_plays
-- devolvía NULL → el gate `if not (...)` no lanzaba). Tras el fix NULL-safe
-- (mig 20261026), ese agujero está cerrado, así que la sembramos bajo el contexto
-- de un APROBADOR (admin del club). Rol por defecto = bypass RLS para el resto.
select set_config('request.jwt.claims',
  '{"sub":"b2a00000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
insert into public.plays (id, owner_profile_id, club_id, name, description, play, status, strategy_type, source_play_id) values
  ('b2900000-0000-4000-8000-000000000001', 'b2a00000-0000-4000-8000-00000000000a', 'b2c00000-0000-4000-8000-000000000001',
   'Original', 'desc vieja', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published', 'corner', null);

-- Las PROPUESTAS son status='proposed' (sin gate de aprobador). Limpiamos el claim
-- para que plays_validate NO reescriba su owner (deja el owner = principal escrito).
select set_config('request.jwt.claims', '', true);
insert into public.plays (id, owner_profile_id, club_id, name, description, play, status, strategy_type, source_play_id) values
  ('b2900000-0000-4000-8000-000000000002', 'b2a00000-0000-4000-8000-00000000000c', 'b2c00000-0000-4000-8000-000000000001',
   'Propuesta edit', 'desc nueva', '{"version":1,"field":{},"frames":[{"elements":[]},{"elements":[]}]}'::jsonb, 'proposed', 'falta',
   'b2900000-0000-4000-8000-000000000001'),
  ('b2900000-0000-4000-8000-000000000003', 'b2a00000-0000-4000-8000-00000000000c', 'b2c00000-0000-4000-8000-000000000001',
   'Sin source', null, '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'proposed', 'corner', null);

-- El equipo tiene la ORIGINAL en su playbook con una seña por equipo.
insert into public.team_plays (team_id, play_id, club_id, added_by, shared_with_family, signal_id) values
  ('b2700000-0000-4000-8000-000000000001', 'b2900000-0000-4000-8000-000000000001',
   'b2c00000-0000-4000-8000-000000000001', 'b2a00000-0000-4000-8000-00000000000a', true, 'puno_alto');

set local role authenticated;

-- RP1: NO-aprobador (principal) → 42501 (insufficient_privilege). La propuesta sigue.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b2a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    perform public.replace_play_with_proposal('b2900000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [RP1]: no-aprobador pudo sustituir'; end if;
end $$;

-- RP2: propuesta SIN source_play_id → check_violation (no_source).
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b2a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    perform public.replace_play_with_proposal('b2900000-0000-4000-8000-000000000003');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [RP2]: sustituir sin source no se rechazó'; end if;
end $$;

-- RP3: APROBADOR (admin) sustituye → OK (devuelve la original).
do $$
declare v_orig uuid;
begin
  set local "request.jwt.claims" = '{"sub":"b2a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select original_id into v_orig
    from public.replace_play_with_proposal('b2900000-0000-4000-8000-000000000002');
  if v_orig is distinct from 'b2900000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [RP3]: original_id inesperado: %', v_orig;
  end if;
end $$;

-- RP4: la ORIGINAL queda con los datos de la propuesta, mismo registro published,
--      owner intacto; la propuesta consumida; el team_plays + seña preservados.
set local role postgres;
do $$
declare v_name text; v_desc text; v_status text; v_owner uuid; v_frames int;
        v_prop_cnt int; v_signal text; v_tp_cnt int;
begin
  select name, description, status, owner_profile_id, jsonb_array_length(play->'frames')
    into v_name, v_desc, v_status, v_owner, v_frames
    from public.plays where id = 'b2900000-0000-4000-8000-000000000001';
  if v_name <> 'Propuesta edit' then raise exception 'FAIL [RP4]: name no volcado: %', v_name; end if;
  if v_desc <> 'desc nueva' then raise exception 'FAIL [RP4]: description no volcada: %', v_desc; end if;
  if v_status <> 'published' then raise exception 'FAIL [RP4]: estado cambiado: %', v_status; end if;
  if v_owner <> 'b2a00000-0000-4000-8000-00000000000a' then raise exception 'FAIL [RP4]: owner cambiado'; end if;
  if v_frames <> 2 then raise exception 'FAIL [RP4]: play (frames) no volcado: %', v_frames; end if;

  select count(*) into v_prop_cnt from public.plays where id = 'b2900000-0000-4000-8000-000000000002';
  if v_prop_cnt <> 0 then raise exception 'FAIL [RP4]: propuesta no consumida'; end if;

  select count(*), max(signal_id) into v_tp_cnt, v_signal
    from public.team_plays
   where team_id = 'b2700000-0000-4000-8000-000000000001'
     and play_id = 'b2900000-0000-4000-8000-000000000001';
  if v_tp_cnt <> 1 then raise exception 'FAIL [RP4]: team_plays vínculo perdido'; end if;
  if v_signal <> 'puno_alto' then raise exception 'FAIL [RP4]: signal_id no preservado: %', v_signal; end if;
end $$;

rollback;
