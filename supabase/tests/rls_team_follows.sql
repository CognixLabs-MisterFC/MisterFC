-- F7B-P1 — Tests de team_follows (seguir equipos para el push de goles).
--
-- Cobertura:
--   F1. Un usuario sigue un equipo de SU club → OK y lo VE.
--   F2. No puede insertar una fila con profile_id ajeno (with_check auth.uid()).
--   F3. No puede seguir un equipo de OTRO club (aislamiento, user_belongs_to_team_club).
--   F4. Solo VE sus propias filas (no las de otro usuario del mismo club).
--   F5. Resolución del fan-out: los seguidores de un equipo son el conjunto correcto
--       (query service-role/bypass-RLS, como hace emitGoalPush).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup: dos clubs (A, B) para probar el aislamiento.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('a1110000-1111-4111-8111-0000000000fa', 'Club FA', 'club-fa-follows'),
  ('a1110000-1111-4111-8111-0000000000fb', 'Club FB', 'club-fb-follows');

insert into public.categories (id, club_id, name) values
  ('b1110000-1111-4111-8111-0000000000fa', 'a1110000-1111-4111-8111-0000000000fa', 'Cat FA'),
  ('b1110000-1111-4111-8111-0000000000fb', 'a1110000-1111-4111-8111-0000000000fb', 'Cat FB');

-- Equipos: TA en club A, TB en club B (teams.club_id denormalizado).
insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('ca110000-1111-4111-8111-0000000000fa', 'b1110000-1111-4111-8111-0000000000fa', 'Team FA', 'F7', '#10B981', '2025-26', 'a1110000-1111-4111-8111-0000000000fa'),
  ('ca110000-1111-4111-8111-0000000000fb', 'b1110000-1111-4111-8111-0000000000fb', 'Team FB', 'F7', '#10B981', '2025-26', 'a1110000-1111-4111-8111-0000000000fb');

-- U1, U2 miembros de A; UB miembro de B.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('dd110000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1-f@follows.test', now(), '{}'::jsonb, now(), now()),
  ('dd110000-0000-4000-8000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2-f@follows.test', now(), '{}'::jsonb, now(), now()),
  ('dd110000-0000-4000-8000-0000000000fb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ub-f@follows.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55110000-0000-4000-8000-0000000000f1', 'dd110000-0000-4000-8000-0000000000f1', 'a1110000-1111-4111-8111-0000000000fa', 'jugador'),
  ('55110000-0000-4000-8000-0000000000f2', 'dd110000-0000-4000-8000-0000000000f2', 'a1110000-1111-4111-8111-0000000000fa', 'jugador'),
  ('55110000-0000-4000-8000-0000000000fb', 'dd110000-0000-4000-8000-0000000000fb', 'a1110000-1111-4111-8111-0000000000fb', 'jugador');

-- ─────────────────────────────────────────────────────────────────────────────
-- F1 + F2 + F3: escritura de U1.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean; v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000f1","role":"authenticated"}';

  -- F1: U1 sigue TA (su club) → OK.
  insert into public.team_follows (profile_id, team_id) values
    ('dd110000-0000-4000-8000-0000000000f1', 'ca110000-1111-4111-8111-0000000000fa');

  select count(*) into v_count from public.team_follows
   where profile_id = 'dd110000-0000-4000-8000-0000000000f1';
  if v_count <> 1 then
    raise exception 'FAIL [F1]: U1 no ve su propio follow (count=%)', v_count;
  end if;

  -- F2: U1 intenta insertar un follow con profile_id ajeno (U2) → ❌.
  ok := false;
  begin
    insert into public.team_follows (profile_id, team_id) values
      ('dd110000-0000-4000-8000-0000000000f2', 'ca110000-1111-4111-8111-0000000000fa');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL [F2]: U1 pudo crear un follow con profile_id ajeno';
  end if;

  -- F3: U1 intenta seguir TB (equipo de OTRO club) → ❌ (with_check aislamiento).
  ok := false;
  begin
    insert into public.team_follows (profile_id, team_id) values
      ('dd110000-0000-4000-8000-0000000000f1', 'ca110000-1111-4111-8111-0000000000fb');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then
    raise exception 'FAIL [F3]: U1 pudo seguir un equipo de otro club';
  end if;

  reset role;
end $$;

-- U2 sigue TA (para F4 y F5).
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000f2","role":"authenticated"}';
  insert into public.team_follows (profile_id, team_id) values
    ('dd110000-0000-4000-8000-0000000000f2', 'ca110000-1111-4111-8111-0000000000fa');
  reset role;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F4: U1 solo VE sus propias filas (no la de U2, aunque sea del mismo equipo).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_foreign int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000f1","role":"authenticated"}';
  select count(*) into v_foreign from public.team_follows
   where profile_id = 'dd110000-0000-4000-8000-0000000000f2';
  reset role;
  if v_foreign <> 0 then
    raise exception 'FAIL [F4]: U1 ve follows ajenos (count=%)', v_foreign;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F5: fan-out — seguidores de TA = {U1, U2}; UB (otro club) no aparece.
--     (query bypass-RLS como service_role en emitGoalPush.)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_ta int; v_has_u1 boolean; v_has_u2 boolean; v_has_ub boolean;
begin
  select count(*) into v_ta from public.team_follows
   where team_id = 'ca110000-1111-4111-8111-0000000000fa';
  select exists(select 1 from public.team_follows
    where team_id = 'ca110000-1111-4111-8111-0000000000fa'
      and profile_id = 'dd110000-0000-4000-8000-0000000000f1') into v_has_u1;
  select exists(select 1 from public.team_follows
    where team_id = 'ca110000-1111-4111-8111-0000000000fa'
      and profile_id = 'dd110000-0000-4000-8000-0000000000f2') into v_has_u2;
  select exists(select 1 from public.team_follows
    where team_id = 'ca110000-1111-4111-8111-0000000000fa'
      and profile_id = 'dd110000-0000-4000-8000-0000000000fb') into v_has_ub;

  if v_ta <> 2 or not v_has_u1 or not v_has_u2 or v_has_ub then
    raise exception 'FAIL [F5]: seguidores de TA incorrectos (count=%, u1=%, u2=%, ub=%)',
      v_ta, v_has_u1, v_has_u2, v_has_ub;
  end if;
end $$;

rollback;

select 'OK rls_team_follows' as result;
