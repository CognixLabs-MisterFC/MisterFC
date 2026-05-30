-- F2.9 hotfix 2026-05-30 — players.last_name NULLABLE.
--
-- Verifica que la migración 20260603000002:
--   1. Permite INSERT con last_name=NULL.
--   2. Permite INSERT con last_name string válido (1-120 chars).
--   3. Sigue rechazando last_name > 120 chars vía el nuevo CHECK.
--   4. NO permite string vacío "" — debería normalizarse a NULL en el cliente
--      antes de llegar a BD; si llega vacío, el CHECK lo rechaza
--      (char_length(NULL ó between 1 and 120)).

begin;

insert into public.clubs (id, name, slug) values
  ('99dd0000-0000-0000-0000-000000000001', 'Club LN Test', 'club-ln-test');

-- Caso 1: last_name=NULL → OK
insert into public.players (
  club_id, first_name, last_name, date_of_birth
) values (
  '99dd0000-0000-0000-0000-000000000001',
  'Solo',
  null,
  '2010-05-15'
);

do $$
declare v_id uuid;
begin
  select id into v_id from public.players
   where club_id = '99dd0000-0000-0000-0000-000000000001'
     and first_name = 'Solo'
   limit 1;
  if v_id is null then
    raise exception 'FAIL [LN1]: INSERT con last_name NULL debería persistir';
  end if;
end $$;

-- Caso 2: last_name='Gomez' → OK
insert into public.players (
  club_id, first_name, last_name, date_of_birth
) values (
  '99dd0000-0000-0000-0000-000000000001',
  'Pepe',
  'Gomez',
  '2010-05-15'
);

-- Caso 3: last_name = 121 chars → debería fallar por el nuevo CHECK
do $$
declare ok boolean := false;
begin
  begin
    insert into public.players (
      club_id, first_name, last_name, date_of_birth
    ) values (
      '99dd0000-0000-0000-0000-000000000001',
      'TooLong',
      repeat('X', 121),
      '2010-05-15'
    );
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [LN3]: last_name de 121 chars debería violar CHECK';
  end if;
end $$;

-- Caso 4: last_name = '' (vacío) → falla por el CHECK (char_length 0 < 1)
do $$
declare ok boolean := false;
begin
  begin
    insert into public.players (
      club_id, first_name, last_name, date_of_birth
    ) values (
      '99dd0000-0000-0000-0000-000000000001',
      'Empty',
      '',
      '2010-05-15'
    );
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [LN4]: last_name vacío debería violar CHECK (debe normalizarse a NULL)';
  end if;
end $$;

rollback;

select 'OK rls_players_last_name_nullable' as result;
