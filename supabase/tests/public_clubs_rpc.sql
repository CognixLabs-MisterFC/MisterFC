-- Tests F14J-1 — lectura PÚBLICA de clubes vía RPC.
--
-- Verifica que:
--   T4. Firma de retorno de AMBOS RPC = EXACTAMENTE (id, name, slug, logo_path):
--       ni una columna más (ni owner_profile_id, locale, created_at…).
--   T1. anon puede llamar list_public_clubs() y ve el club de test (y ≥1 fila).
--   T2. get_public_club_by_slug('<slug de test>') como anon devuelve ese club
--       exacto (id, name, slug, logo_path correctos).
--   T3. get_public_club_by_slug('no-existe') devuelve 0 filas (no lanza).
--   T5. La tabla public.clubs SIGUE cerrada a anon: un SELECT directo como anon
--       no devuelve filas (RLS) — o está bloqueado por grant (ambos = "no legible").
\ir helpers/auth_users.sql

begin;

-- Setup: club de test insertado como el rol de la conexión (superuser/owner →
-- bypass RLS). El cambio a anon ocurre DESPUÉS de sembrar.
insert into public.clubs (id, name, slug, logo_path) values
  ('ffff0001-0000-0000-0000-000000000001',
   'Club Publico Test',
   'club-publico-test',
   'ffff0001-0000-0000-0000-000000000001/logo.webp');

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: la proyección de retorno es EXACTAMENTE 4 columnas y las esperadas.
--     (Se comprueba antes de cambiar de rol; pg_get_function_result es neutral.)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  sig text;
  commas int;
begin
  foreach sig in array array[
    pg_get_function_result('public.list_public_clubs()'::regprocedure),
    pg_get_function_result('public.get_public_club_by_slug(text)'::regprocedure)
  ]
  loop
    -- Exactamente 4 columnas → exactamente 3 comas dentro de TABLE(...).
    commas := length(sig) - length(replace(sig, ',', ''));
    if commas <> 3 then
      raise exception 'FAIL [T4]: se esperaban 4 columnas (3 comas), firma=%', sig;
    end if;
    if sig !~ 'id uuid' or sig !~ 'name text'
       or sig !~ 'slug text' or sig !~ 'logo_path text' then
      raise exception 'FAIL [T4]: faltan columnas esperadas, firma=%', sig;
    end if;
    -- Ninguna columna sensible de clubs debe asomar.
    if sig ~ 'owner_profile_id' or sig ~ 'locale' or sig ~ 'created_at' then
      raise exception 'FAIL [T4]: la firma expone columnas extra: %', sig;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cambiamos a anon (rol anon, jwt sin `sub`).
-- ─────────────────────────────────────────────────────────────────────────────
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

-- T1: anon ve el directorio; contiene el club de test y ≥1 fila.
do $$
declare cnt int;
begin
  select count(*) into cnt from public.list_public_clubs()
   where slug = 'club-publico-test';
  if cnt <> 1 then
    raise exception 'FAIL [T1]: anon no ve el club de test en list_public_clubs (cnt=%)', cnt;
  end if;
  select count(*) into cnt from public.list_public_clubs();
  if cnt < 1 then
    raise exception 'FAIL [T1b]: list_public_clubs no devuelve filas (cnt=%)', cnt;
  end if;
end $$;

-- T2: get_public_club_by_slug(test) → exactamente ese club, datos correctos.
do $$
declare r record; n int;
begin
  select count(*) into n from public.get_public_club_by_slug('club-publico-test');
  if n <> 1 then
    raise exception 'FAIL [T2]: get_public_club_by_slug(test) devuelve % filas', n;
  end if;
  select * into r from public.get_public_club_by_slug('club-publico-test');
  if r.id <> 'ffff0001-0000-0000-0000-000000000001'::uuid
     or r.name <> 'Club Publico Test'
     or r.slug <> 'club-publico-test'
     or r.logo_path <> 'ffff0001-0000-0000-0000-000000000001/logo.webp' then
    raise exception 'FAIL [T2b]: datos incorrectos (id=%, name=%, slug=%, logo=%)',
      r.id, r.name, r.slug, r.logo_path;
  end if;
end $$;

-- T3: slug inexistente → 0 filas, sin lanzar.
do $$
declare n int;
begin
  select count(*) into n from public.get_public_club_by_slug('no-existe');
  if n <> 0 then
    raise exception 'FAIL [T3]: get_public_club_by_slug(no-existe) devuelve % filas', n;
  end if;
end $$;

-- T5: la tabla clubs SIGUE cerrada a anon (RLS = 0 filas; o grant la bloquea).
do $$
declare cnt int;
begin
  begin
    select count(*) into cnt from public.clubs;
  exception when insufficient_privilege then
    cnt := 0; -- bloqueada por privilegios también cuenta como "no legible".
  end;
  if cnt <> 0 then
    raise exception 'FAIL [T5]: anon NO debe leer public.clubs directamente (cnt=%)', cnt;
  end if;
end $$;

reset role;
rollback;
