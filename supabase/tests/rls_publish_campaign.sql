-- Tests F13.10g-GC — RPC publish_campaign (migración 20260803000000_publish_campaign.sql).
--
-- Cubre: autoridad (admin_club sí; coordinador no → insufficient_privilege); publica
-- SOLO los informes COMPLETOS (visibility→team) dejando los incompletos en staff (D3);
-- marca la campaña status='published'; devuelve los player_id publicados (D5); y no se
-- puede re-publicar una campaña ya publicada (guard launched→published).
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- IDs: prefijo fc (hex; no colisiona con otros tests).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('fc000000-0000-4000-8000-000000000001', 'Club PC', 'club-pc');

insert into public.seasons (id, club_id, label, status) values
  ('fc5ea000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', '2025-26', 'active');

insert into public.categories (id, club_id, name) values
  ('fcca0000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'Cat');

insert into public.teams (id, category_id, name, format, color, season) values
  ('fc700000-0000-4000-8000-000000000001', 'fcca0000-0000-4000-8000-000000000001', 'T', 'F11', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('fc500000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'Comp', 'Leto', '2012-01-01'),
  ('fc500000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000001', 'Incom', 'Pleto', '2012-01-01');

select pg_temp.new_test_user('fca00000-0000-4000-8000-00000000000a', 'pcadmin@pc.test', '{}'::jsonb);
select pg_temp.new_test_user('fca00000-0000-4000-8000-00000000000b', 'pccoord@pc.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('fc550000-0000-4000-8000-00000000000a', 'fca00000-0000-4000-8000-00000000000a', 'fc000000-0000-4000-8000-000000000001', 'admin_club'),
  ('fc550000-0000-4000-8000-00000000000b', 'fca00000-0000-4000-8000-00000000000b', 'fc000000-0000-4000-8000-000000000001', 'coordinador');

-- Campaña LANZADA.
insert into public.assessment_campaigns (club_id, season_id, period, due_date, status, created_by) values
  ('fc000000-0000-4000-8000-000000000001', 'fc5ea000-0000-4000-8000-000000000001', 'inicial', '2025-09-30', 'launched',
   'fca00000-0000-4000-8000-00000000000a');

-- Informe COMPLETO (22 ítems) y otro INCOMPLETO (1 ítem); ambos en 'staff'.
insert into public.development_reports (club_id, team_id, player_id, season_id, period, scores, visibility, created_by) values
  ('fc000000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000001',
   'fc5ea000-0000-4000-8000-000000000001', 'inicial',
   '{"control_orientado":5,"pase":5,"conduccion":5,"regate":5,"finalizacion":5,"primer_toque":5,"comprension_juego":5,"toma_decisiones":5,"ocupacion_espacios":5,"lectura_tactica":5,"juego_sin_balon":5,"coordinacion":5,"agilidad":5,"velocidad":5,"resistencia":5,"explosividad":5,"compromiso":5,"motivacion":5,"concentracion":5,"companerismo":5,"liderazgo":5,"evolucion":5}'::jsonb,
   'staff', 'fca00000-0000-4000-8000-00000000000a'),
  ('fc000000-0000-4000-8000-000000000001', 'fc700000-0000-4000-8000-000000000001', 'fc500000-0000-4000-8000-000000000002',
   'fc5ea000-0000-4000-8000-000000000001', 'inicial',
   '{"pase":5}'::jsonb, 'staff', 'fca00000-0000-4000-8000-00000000000a');

-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- P1: coordinador NO puede publicar (solo admin) → insufficient_privilege.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"fca00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  begin
    perform public.publish_campaign('fc5ea000-0000-4000-8000-000000000001', 'inicial');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [P1]: coordinador pudo publicar la campaña'; end if;
end $$;

-- P2: admin publica → devuelve solo el completo; completo→team, incompleto→staff;
--     campaña→published.
do $$
declare v_pub uuid[]; v1 text; v2 text; v_status text;
begin
  set local "request.jwt.claims" = '{"sub":"fca00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select array_agg(player_id) into v_pub
    from public.publish_campaign('fc5ea000-0000-4000-8000-000000000001', 'inicial');
  if v_pub is null or array_length(v_pub, 1) <> 1 then
    raise exception 'FAIL [P2a]: nº publicados != 1 (%)', v_pub;
  end if;
  if not (v_pub @> array['fc500000-0000-4000-8000-000000000001'::uuid]) then
    raise exception 'FAIL [P2b]: el completo no está en los publicados';
  end if;
  select visibility into v1 from public.development_reports where player_id = 'fc500000-0000-4000-8000-000000000001';
  if v1 <> 'team' then raise exception 'FAIL [P2c]: completo no quedó team (%)', v1; end if;
  select visibility into v2 from public.development_reports where player_id = 'fc500000-0000-4000-8000-000000000002';
  if v2 <> 'staff' then raise exception 'FAIL [P2d]: incompleto se publicó (quedó %)', v2; end if;
  select status into v_status from public.assessment_campaigns where season_id = 'fc5ea000-0000-4000-8000-000000000001';
  if v_status <> 'published' then raise exception 'FAIL [P2e]: campaña no published (%)', v_status; end if;
end $$;

-- P3: re-publicar una campaña ya publicada → rechazado (guard de transición).
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"fca00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    perform public.publish_campaign('fc5ea000-0000-4000-8000-000000000001', 'inicial');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [P3]: se pudo re-publicar una campaña ya publicada'; end if;
end $$;

reset role;

rollback;
