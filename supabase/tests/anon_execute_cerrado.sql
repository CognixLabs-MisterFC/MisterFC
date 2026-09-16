-- El EXECUTE de anon en `public` esta cerrado, y sigue cerrandose solo (mig 20261075000000).
-- Cubre:
--   [1] EXACTAMENTE dos funciones ejecutables por anon, y son las dos de F14J.
--   [2] Las que el mapa encontro SIN portero ya no lo son (comprobacion nominal: si
--       alguien reabre una por su nombre, esto la caza aunque [1] se relajara).
--   [3] El default de Supabase (anon=X) sigue retirado en `public`. La otra via, la de
--       PUBLIC, NO se puede cerrar sin romper la suite (ver la migracion): quien caza
--       una funcion nueva abierta es [1], y por eso [1] es el bloque que importa.
--   [4] NO nos hemos pasado de frenada: `authenticated` conserva EXECUTE en todas las
--       funciones que usan sus policies. Sin eso, quitar de mas rompe lecturas enteras
--       y el sintoma serian tablas vacias, no un error.
--   [5] `service_role` conserva EXECUTE: lo usan los crons y los route handlers.
--   [6] No hemos cerrado `pg_temp`. Suena ajeno a esto y no lo es: la primera version
--       de la migracion revocaba PUBLic de forma GLOBAL, `pg_temp` incluido, y 95
--       ficheros de esta suite crean ahi sus helpers. El sintoma no fue un rojo: fue
--       el backend del CI cayendose a mitad de suite.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- Privilegios con has_function_privilege, NUNCA provocando el 42501.
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ── [1] Solo esas dos ────────────────────────────────────────────────────────
do $$
declare
  v_nuestras text[];
  v_ajenas   text[];
begin
  -- Las NUESTRAS (las que posee postgres): exactamente las dos de F14J.
  select coalesce(array_agg(p.proname order by p.proname), '{}')
    into v_nuestras
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_userbyid(p.proowner) = 'postgres'
    and has_function_privilege('anon', p.oid, 'execute');

  if v_nuestras <> array['get_public_club_by_slug','list_public_clubs'] then
    raise exception '[1] anon puede ejecutar algo que no toca. Abiertas: %', v_nuestras;
  end if;

  -- Las AJENAS: `postgres` no puede revocarles nada (las posee supabase_admin), asi
  -- que se nombran una a una. No es una excepcion en blanco: si aparece una cuarta,
  -- esto se pone rojo y alguien tiene que mirarla.
  select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
    into v_ajenas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_userbyid(p.proowner) <> 'postgres'
    and has_function_privilege('anon', p.oid, 'execute');

  if v_ajenas <> array['unaccent','unaccent_init','unaccent_lexize'] then
    raise exception
      '[1] funcion AJENA nueva ejecutable por anon (no la posee postgres, no podemos revocarla): %', v_ajenas;
  end if;
end $$;

-- ── [2] Las del mapa, por su nombre ──────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as firma, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'seed_standard_categories','seed_club_legal_documents','match_assert_event',
        'match_assert_player_in_team','team_chat_member_profile_ids','active_season_id',
        'club_evaluations_visible','current_legal_version','development_report_shared_for_player',
        'development_report_shared_for_team','is_promotion_target_superior','player_has_other_tutor',
        'player_is_minor','player_photo_visible','player_promoted_to_event','profile_is_club_owner',
        'profile_is_staff_of_club','team_club_id','user_has_medical_consent_read',
        'user_has_medical_consent_write','user_wants_notification')
  loop
    if has_function_privilege('anon', r.firma::regprocedure::oid, 'execute') then
      raise exception '[2] reabierta a anon: %', r.firma;
    end if;
  end loop;
end $$;

-- ── [3] El default de anon sigue retirado ────────────────────────────────────
-- Ojo con lo que este bloque NO dice. Una funcion creada ahora SI nace ejecutable por
-- anon, porque el `=X/postgres` de PostgreSQL solo se quita con un revoke GLOBAL que
-- deja `pg_temp` sin PUBLIC y tumba el backend del CI (esta contado en la migracion).
-- Lo que se fija aqui es la mitad que si se puede fijar sin colateral: que nadie
-- devuelva el default de Supabase. El que una funcion nueva quede abierta lo caza [1].
do $$
declare
  v_acl text;
begin
  select coalesce(d.defaclacl::text, '')
    into v_acl
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  join pg_roles r on r.oid = d.defaclrole
  where d.defaclobjtype = 'f' and n.nspname = 'public' and r.rolname = 'postgres';

  if v_acl is null or v_acl = '' then
    raise exception
      '[3] no hay default privilege de postgres para funciones en public: el ALTER DEFAULT PRIVILEGES de la migracion no esta aplicado';
  end if;

  if v_acl ~ '\manon=' then
    raise exception
      '[3] el default privilege vuelve a conceder EXECUTE a anon: %. Toda funcion nueva nacera abierta por DOS vias en vez de una', v_acl;
  end if;

  -- Y el contraste: authenticated y service_role SI lo heredan, que es lo normal.
  if v_acl !~ '\mauthenticated=' or v_acl !~ '\mservice_role=' then
    raise exception
      '[3] el revoke se llevo por delante a authenticated o service_role: %', v_acl;
  end if;
end $$;

-- ── [4] No nos hemos pasado: authenticated conserva lo que sus policies usan ──
do $$
declare
  v_rotas text;
begin
  select string_agg(distinct p.proname, ', ')
    into v_rotas
  from pg_policies pol
  join pg_proc p on coalesce(pol.qual,'') ~ ('\m' || p.proname || '\M')
                 or coalesce(pol.with_check,'') ~ ('\m' || p.proname || '\M')
  join pg_namespace n on n.oid = p.pronamespace
  where pol.schemaname = 'public' and n.nspname = 'public'
    and 'authenticated' = any(pol.roles)
    and not has_function_privilege('authenticated', p.oid, 'execute');

  if v_rotas is not null then
    raise exception
      '[4] authenticated perdio EXECUTE en funciones que usan sus policies: %. El sintoma en produccion serian tablas VACIAS, no un error.', v_rotas;
  end if;
end $$;

-- ── [5] service_role sigue pudiendo ──────────────────────────────────────────
do $$
declare
  v_sin integer;
begin
  select count(*) into v_sin
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_function_result(p.oid) <> 'trigger'
    and not has_function_privilege('service_role', p.oid, 'execute');

  if v_sin > 0 then
    raise exception '[5] service_role perdio EXECUTE en % funciones; los crons y los route handlers van con ese rol', v_sin;
  end if;
end $$;

-- ── [6] pg_temp sigue siendo de todos ────────────────────────────────────────
-- Un revoke de EXECUTE a PUBLIC sin `IN SCHEMA` alcanza a `pg_temp`. Los ficheros de
-- esta suite crean ahi sus `assert_*` y luego cambian de rol con set_config('role',...,
-- true), que es LOCAL A LA TRANSACCION y sigue puesto cuando psql llama al helper
-- siguiente. Sin PUBLIC eso es un 42501, y un 42501 tumba el backend efimero del CI
-- (BC-1): no sale un fallo legible, sale "server closed the connection unexpectedly".
-- Este bloque lo caza en el fichero que lo causa en vez de en el que lo sufre.
do $$
begin
  execute 'create function pg_temp.zz_guard_pg_temp() returns integer language sql as $f$ select 1 $f$';

  if not has_function_privilege('authenticated',
       (select p.oid from pg_proc p where p.proname = 'zz_guard_pg_temp'), 'execute') then
    raise exception
      '[6] pg_temp ha perdido EXECUTE para PUBLIC: alguien ha puesto un ALTER DEFAULT PRIVILEGES global. La suite pgTAP no sobrevive a eso (el backend se cae, no falla)';
  end if;
end $$;

rollback;
