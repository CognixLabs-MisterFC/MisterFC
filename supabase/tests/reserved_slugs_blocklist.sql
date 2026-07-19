-- F14J-3a — Blocklist de slugs reservados.
--
-- INVARIANTE: platform_create_club RECHAZA slugs que colisionan con rutas de la
-- app (evita que un club quede inalcanzable por `/{slug}`), y platform_propose_slug
-- nunca AUTOGENERA uno reservado. Un slug normal pasa como siempre.
--
-- Convención del repo (igual que categories_seed_on_club_create): psql
-- ON_ERROR_STOP=1; asserts con DO + raise exception; BEGIN/ROLLBACK. El caller se
-- siembra en platform_admins (as postgres) y se simula auth con role authenticated
-- + request.jwt.claims → is_superadmin() true.
--
-- Casos:
--   R1. crear club con slug 'calendario' (ruta authenticated) → FALLA (slug_reserved).
--   R2. crear club con slug 'signin' (ruta estática) → FALLA (slug_reserved).
--   R3. crear club con slug normal 'fonteta' → PASA (devuelve id).
--   R4. is_reserved_slug: 'dashboard' reservado; 'fonteta' no.
--   R5. propose_slug('Calendario') NO devuelve un slug reservado (salta a -2).
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('f14a0001-0000-4000-8000-000000000001', 'f14j3a-super@test.local', '{"full_name":"F14J3a Super"}'::jsonb);
-- El caller es SUPERADMIN de plataforma (insert as postgres, antes del cambio de rol).
insert into public.platform_admins (profile_id) values ('f14a0001-0000-4000-8000-000000000001');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f14a0001-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_club_id  uuid;
  v_proposed text;
begin
  -- R1. slug reservado por ruta (authenticated) → slug_reserved.
  begin
    perform public.platform_create_club('Club Reservado 1', 'calendario', 'es');
    raise exception 'FAIL [R1]: crear club con slug reservado "calendario" debería fallar';
  exception
    when others then
      if sqlerrm <> 'slug_reserved' then
        raise exception 'FAIL [R1]: esperaba slug_reserved, obtuve "%"', sqlerrm;
      end if;
  end;

  -- R2. slug reservado por ruta estática → slug_reserved.
  begin
    perform public.platform_create_club('Club Reservado 2', 'signin', 'es');
    raise exception 'FAIL [R2]: crear club con slug reservado "signin" debería fallar';
  exception
    when others then
      if sqlerrm <> 'slug_reserved' then
        raise exception 'FAIL [R2]: esperaba slug_reserved, obtuve "%"', sqlerrm;
      end if;
  end;

  -- R3. slug normal → pasa.
  v_club_id := public.platform_create_club('Fonteta CF', 'fonteta', 'es');
  if v_club_id is null then
    raise exception 'FAIL [R3]: crear club con slug normal "fonteta" debería devolver id';
  end if;

  -- R4. helper directo.
  if not public.is_reserved_slug('dashboard') then
    raise exception 'FAIL [R4a]: "dashboard" debería ser reservado';
  end if;
  if public.is_reserved_slug('fonteta') then
    raise exception 'FAIL [R4b]: "fonteta" NO debería ser reservado';
  end if;

  -- R5. propose_slug nunca devuelve reservado (el club se llama "Calendario").
  v_proposed := public.platform_propose_slug('Calendario');
  if public.is_reserved_slug(v_proposed) then
    raise exception 'FAIL [R5]: propose_slug devolvió un slug reservado: "%"', v_proposed;
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ F14J-3a: slugs reservados bloqueados en creación y evitados en autoproposición.'
\echo '──────────────────────────────────────────────'
