-- Las tablas de `public` están cerradas a anon, y siguen cerrándose solas.
-- Migración 20261078000000. Hermano del test `anon_execute_cerrado` (mig 75): aquel
-- cubre el EXECUTE de las funciones, este el DML de las tablas.
--
-- Cubre:
--   [1] anon NO tiene NINGÚN privilegio en `public`: ni de tabla, ni de COLUMNA, ni
--       sobre las secuencias. La comprobación por columna no es adorno: `players` y
--       `profiles` conceden por columna, y un privilegio de columna no aparece en
--       `has_table_privilege`.
--   [2] `authenticated` no tiene TRUNCATE, REFERENCES, TRIGGER ni MAINTAIN en ninguna
--       tabla. TRUNCATE es el que importa: no pasa por la RLS.
--   [3] NO nos hemos pasado de frenada: toda tabla con una policy de `authenticated`
--       le conserva el SELECT. Sin eso, quitar de más deja la policy gobernando nada
--       y el síntoma serían tablas vacías, no un error (lección de la mig 75).
--   [4] La cerradura POR COLUMNA sigue en pie: `players.phone` y `profiles.phone` no
--       son legibles por `authenticated` —se leen por RPC SECURITY DEFINER—, y el
--       resto de columnas sí. Un `grant select on players to authenticated` a pelo en
--       una migración futura reabriría el teléfono sin que nadie lo notara: esto lo
--       caza.
--   [5] `service_role` conserva lo suyo: lo usan los crons y los route handlers.
--   [6] El default de Supabase ya no nombra a anon para tablas ni secuencias, y ya no
--       le da TRUNCATE a `authenticated`. Es lo que impide que la próxima tabla nazca
--       abierta, que era la raíz.
--
-- Estilo: aserciones con raise exception. Privilegios con has_*_privilege, NUNCA
-- provocando el 42501. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ── [1] anon no tiene nada en `public` ───────────────────────────────────────
do $$
declare
  v_tablas text[];
  v_cols   text[];
  v_secs   text[];
begin
  -- Con has_table_privilege, no con information_schema: esa vista solo enseña los
  -- roles que el que consulta tiene habilitados, y eso es una condicion del entorno.
  select coalesce(array_agg(c.relname::text || ' (' || p.priv || ')' order by c.relname, p.priv), '{}')
    into v_tablas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and has_table_privilege('anon', c.oid, p.priv);

  if array_length(v_tablas, 1) > 0 then
    raise exception '[1] anon conserva privilegios de TABLA en public: %', v_tablas;
  end if;

  select coalesce(array_agg(distinct table_name::text || '.' || column_name::text || ' (' || privilege_type::text || ')'), '{}')
    into v_cols
  from information_schema.column_privileges
  where table_schema = 'public' and grantee = 'anon';

  if array_length(v_cols, 1) > 0 then
    raise exception '[1] anon conserva privilegios de COLUMNA en public: %', v_cols;
  end if;

  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_secs
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
    and (has_sequence_privilege('anon', c.oid, 'USAGE')
      or has_sequence_privilege('anon', c.oid, 'SELECT')
      or has_sequence_privilege('anon', c.oid, 'UPDATE'));

  if array_length(v_secs, 1) > 0 then
    raise exception '[1] anon conserva privilegios sobre secuencias de public: %', v_secs;
  end if;
end $$;

-- ── [2] authenticated sin TRUNCATE / REFERENCES / TRIGGER / MAINTAIN ─────────
do $$
declare v_malas text[];
begin
  select coalesce(array_agg(c.relname::text || ' (' || p.priv || ')' order by c.relname, p.priv), '{}')
    into v_malas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(priv)
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and has_table_privilege('authenticated', c.oid, p.priv);

  if array_length(v_malas, 1) > 0 then
    raise exception '[2] authenticated conserva privilegios que ninguna policy usa: %', v_malas;
  end if;
end $$;

-- ── [3] No nos hemos pasado: la policy de authenticated tiene su SELECT ──────
do $$
declare v_mudas text[];
begin
  select coalesce(array_agg(distinct c.relname order by c.relname), '{}')
    into v_mudas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and exists (
      select 1 from pg_policies pol
      where pol.schemaname = 'public' and pol.tablename = c.relname
        and pol.roles::text[] && array['authenticated']
    )
    and not exists (
      select 1 from information_schema.column_privileges cp
      where cp.table_schema = 'public' and cp.table_name = c.relname
        and cp.grantee = 'authenticated' and cp.privilege_type = 'SELECT'
    );

  if array_length(v_mudas, 1) > 0 then
    raise exception '[3] tablas con policy de authenticated y SIN select: la policy no gobierna nada: %', v_mudas;
  end if;
end $$;

-- ── [4] El teléfono sigue cerrado POR COLUMNA ────────────────────────────────
do $$
begin
  if has_column_privilege('authenticated', 'public.players'::regclass, 'phone', 'SELECT') then
    raise exception '[4] authenticated puede leer players.phone: la cerradura por columna se ha perdido';
  end if;
  if has_column_privilege('authenticated', 'public.profiles'::regclass, 'phone', 'SELECT') then
    raise exception '[4] authenticated puede leer profiles.phone: la cerradura por columna se ha perdido';
  end if;
  -- Ancla positiva: si el fixture midiera mal, esto lo dice.
  if not has_column_privilege('authenticated', 'public.players'::regclass, 'first_name', 'SELECT') then
    raise exception '[4] authenticated NO puede leer players.first_name: se ha quitado de mas';
  end if;
end $$;

-- ── [5] service_role conserva lo suyo ────────────────────────────────────────
do $$
begin
  if not has_table_privilege('service_role', 'public.consents'::regclass, 'SELECT') then
    raise exception '[5] service_role perdio el SELECT sobre consents';
  end if;
  if not has_table_privilege('service_role', 'public.players'::regclass, 'SELECT') then
    raise exception '[5] service_role perdio el SELECT sobre players';
  end if;
  if not has_table_privilege('service_role', 'public.account_deletion_requests'::regclass, 'UPDATE') then
    raise exception '[5] service_role perdio el UPDATE sobre account_deletion_requests: el cron de borrado';
  end if;
end $$;

-- ── [6] Y las que vengan no nacen abiertas ───────────────────────────────────
do $$
declare
  v_anon  text[];
  v_auth  text[];
begin
  -- Tablas y secuencias: anon no puede aparecer en el default de `postgres`.
  select coalesce(array_agg(d.defaclobjtype::text || ':' || a.privilege_type), '{}')
    into v_anon
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace
    and pg_get_userbyid(d.defaclrole) = 'postgres'
    and d.defaclobjtype in ('r', 'S')
    and a.grantee = 'anon'::regrole;

  if array_length(v_anon, 1) > 0 then
    raise exception '[6] el default de postgres en public vuelve a conceder a anon: %', v_anon;
  end if;

  select coalesce(array_agg(a.privilege_type), '{}')
    into v_auth
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace
    and pg_get_userbyid(d.defaclrole) = 'postgres'
    and d.defaclobjtype = 'r'
    and a.grantee = 'authenticated'::regrole
    and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');

  if array_length(v_auth, 1) > 0 then
    raise exception '[6] el default de postgres sigue dando a authenticated: %', v_auth;
  end if;
end $$;

rollback;
