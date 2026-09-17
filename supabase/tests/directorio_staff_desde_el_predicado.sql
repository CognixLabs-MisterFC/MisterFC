-- El directorio de staff sale del mismo predicado que su policy (mig 20261083).
--
-- Lo que se prueba:
--   [1] LA INVARIANTE: el conjunto que devuelve `staff_conversation_directory` es
--       EXACTAMENTE el que `profile_is_staff_of_club` deja pasar, menos quien
--       pregunta. Es el bloque que importa: si alguien vuelve a derivar la lista
--       aparte, aquí se ve.
--   [2] El EX-MIEMBRO no sale — y el portero tampoco lo deja. Es el fallo real que
--       cierra esta migración: tres entrenadores fuera del club desde agosto seguían
--       ofreciéndose, y devolvían forbidden al pulsarlos. Con ancla positiva: el
--       activo del mismo rol SÍ sale.
--   [3] La etiqueta es el rol de MÁS prioridad, y una asignación de equipo CERRADA no
--       da etiqueta.
--   [4] El `delegado` que solo es staff POR EL EQUIPO entra (su membresía es
--       'jugador'): es la rama que el TypeScript llamaba «capta delegado/pf».
--   [5] La puerta: un tutor (membresía 'jugador', sin equipo) no puede ni pedirla, y
--       sin sesión tampoco.
--   [6] El orden: por nombre, y con DESEMPATE — en el club real hay cuatro personas
--       con el mismo nombre y sin desempate el orden cambiaba entre llamadas.
--   [7] ACL: anon no ejecuta, authenticated sí, PUBLIC no.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('ea000000-0000-4000-8000-000000000001', 'Club Dir', 'club-dir');

insert into public.categories (id, club_id, name) values
  ('ea0d0000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'Cadete');

insert into public.teams (id, category_id, name, format, color, season) values
  ('ea0e0000-0000-4000-8000-000000000001', 'ea0d0000-0000-4000-8000-000000000001', 'Equipo A', 'F7', '#10B981', '2025-26');

--  1 admin        · admin_club, es quien pregunta en casi todos los bloques
--  2 ayudante     · ayudante de club Y principal del equipo A → etiqueta = principal
--  3 exdirector   · director, PERO con la membresía cerrada → fuera
--  4 delegado     · membresía 'jugador' + team_staff activo 'delegado' → dentro
--  5 tutor        · membresía 'jugador' a secas → fuera, y no puede ni preguntar
--  6 excerrado    · ayudante de club + team_staff CERRADO 'delegado' → etiqueta ayudante
--  7 tocayo       · mismo nombre que el 2, para el desempate de [6]
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000001', 'admin@dir.test',   '{"full_name": "Aurora Admin"}'::jsonb);
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000002', 'ayud@dir.test',    '{"full_name": "Jose Coach"}'::jsonb);
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000003', 'exdir@dir.test',    '{"full_name": "Bruno Exdir"}'::jsonb);
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000004', 'delegado@dir.test', '{"full_name": "Celia Delegada"}'::jsonb);
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000005', 'tutor@dir.test',    '{"full_name": "Diego Tutor"}'::jsonb);
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000006', 'excerr@dir.test',   '{"full_name": "Elena Excerrado"}'::jsonb);
select pg_temp.new_test_user('ea0a0000-0000-4000-8000-000000000007', 'tocayo@dir.test',   '{"full_name": "Jose Coach"}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('ea0f0000-0000-4000-8000-000000000001', 'ea0a0000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'admin_club',          null),
  ('ea0f0000-0000-4000-8000-000000000002', 'ea0a0000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null),
  ('ea0f0000-0000-4000-8000-000000000003', 'ea0a0000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000001', 'director',            now()),
  ('ea0f0000-0000-4000-8000-000000000004', 'ea0a0000-0000-4000-8000-000000000004', 'ea000000-0000-4000-8000-000000000001', 'jugador',             null),
  ('ea0f0000-0000-4000-8000-000000000005', 'ea0a0000-0000-4000-8000-000000000005', 'ea000000-0000-4000-8000-000000000001', 'jugador',             null),
  ('ea0f0000-0000-4000-8000-000000000006', 'ea0a0000-0000-4000-8000-000000000006', 'ea000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null),
  ('ea0f0000-0000-4000-8000-000000000007', 'ea0a0000-0000-4000-8000-000000000007', 'ea000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null);

insert into public.team_staff (team_id, membership_id, staff_role, left_at) values
  ('ea0e0000-0000-4000-8000-000000000001', 'ea0f0000-0000-4000-8000-000000000002', 'entrenador_principal', null),
  ('ea0e0000-0000-4000-8000-000000000001', 'ea0f0000-0000-4000-8000-000000000004', 'delegado',             null),
  ('ea0e0000-0000-4000-8000-000000000001', 'ea0f0000-0000-4000-8000-000000000006', 'delegado',             now());

create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- `reset role` NO borra las claims (son locales a la transacción y sobreviven), así
-- que el caso "sin sesión" necesita limpiarlas a mano. Lección del test hermano.
create or replace function pg_temp.sin_sesion() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ── [1] La invariante: directorio ⟺ predicado ────────────────────────────────
do $$
declare
  u record; v_dir uuid[]; v_pred uuid[]; v_disc text := '';
begin
  for u in select profile_id from public.memberships
            where club_id = 'ea000000-0000-4000-8000-000000000001'
              and profile_id in ('ea0a0000-0000-4000-8000-000000000001',
                                 'ea0a0000-0000-4000-8000-000000000002',
                                 'ea0a0000-0000-4000-8000-000000000004')
            order by profile_id
  loop
    perform pg_temp.como(u.profile_id::text);
    select coalesce(array_agg(d.profile_id order by d.profile_id), '{}')
      into v_dir
      from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d;
    select coalesce(array_agg(pr.id order by pr.id), '{}')
      into v_pred
      from public.profiles pr
     where pr.id <> u.profile_id
       and public.profile_is_staff_of_club(pr.id, 'ea000000-0000-4000-8000-000000000001');
    reset role;

    if v_dir <> v_pred then
      v_disc := v_disc || format('quien_pregunta=%s directorio=%s predicado=%s; ',
                                 u.profile_id, v_dir, v_pred);
    end if;
  end loop;

  if v_disc <> '' then
    raise exception '[1] el directorio y el portero NO dicen lo mismo: %', v_disc;
  end if;
end $$;

-- ── [2] El ex-miembro no sale, y el activo sí ────────────────────────────────
do $$
declare v_ex boolean; v_activo boolean; v_portero_ex boolean;
begin
  perform pg_temp.como('ea0a0000-0000-4000-8000-000000000001');
  select exists (select 1 from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d
                  where d.profile_id = 'ea0a0000-0000-4000-8000-000000000003') into v_ex;
  select exists (select 1 from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d
                  where d.profile_id = 'ea0a0000-0000-4000-8000-000000000002') into v_activo;
  reset role;
  select public.profile_is_staff_of_club('ea0a0000-0000-4000-8000-000000000003',
                                         'ea000000-0000-4000-8000-000000000001') into v_portero_ex;

  if not v_activo then
    raise exception '[2] el staff ACTIVO no sale en el directorio: se ha cerrado de mas';
  end if;
  if v_portero_ex then
    raise exception '[2] el portero deja escribir a quien dejo el club: el fixture no prueba nada';
  end if;
  if v_ex then
    raise exception '[2] el directorio ofrece a quien dejo el club (daria forbidden al pulsarlo)';
  end if;
end $$;

-- ── [3] La etiqueta: la de mas prioridad, y lo cerrado no cuenta ─────────────
do $$
declare v_rol_ayud text; v_rol_excerr text;
begin
  perform pg_temp.como('ea0a0000-0000-4000-8000-000000000001');
  select d.role into v_rol_ayud
    from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d
   where d.profile_id = 'ea0a0000-0000-4000-8000-000000000002';
  select d.role into v_rol_excerr
    from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d
   where d.profile_id = 'ea0a0000-0000-4000-8000-000000000006';
  reset role;

  if v_rol_ayud <> 'entrenador_principal' then
    raise exception '[3] ayudante de club + principal de equipo deberia etiquetar principal, y dice %', v_rol_ayud;
  end if;
  if v_rol_excerr <> 'entrenador_ayudante' then
    raise exception '[3] una asignacion de equipo CERRADA sigue dando etiqueta: dice % en vez de entrenador_ayudante', v_rol_excerr;
  end if;
end $$;

-- ── [4] El delegado que solo es staff por el equipo ──────────────────────────
do $$
declare v_rol text;
begin
  perform pg_temp.como('ea0a0000-0000-4000-8000-000000000001');
  select d.role into v_rol
    from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d
   where d.profile_id = 'ea0a0000-0000-4000-8000-000000000004';
  reset role;

  if v_rol is null then
    raise exception '[4] el delegado con membresia de jugador no entra: se perdio la rama del equipo';
  end if;
  if v_rol <> 'delegado' then
    raise exception '[4] el delegado sale etiquetado como %', v_rol;
  end if;
end $$;

-- ── [5] La puerta ────────────────────────────────────────────────────────────
do $$
declare ok_tutor boolean := false; ok_sin boolean := false; v_esta boolean;
begin
  -- El tutor no puede pedirla...
  perform pg_temp.como('ea0a0000-0000-4000-8000-000000000005');
  begin
    perform * from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm like '%forbidden%' then ok_tutor := true; else reset role; raise; end if;
  end;
  reset role;
  if not ok_tutor then raise exception '[5] un tutor puede pedir el directorio de staff'; end if;

  -- ...ni aparece en ella.
  perform pg_temp.como('ea0a0000-0000-4000-8000-000000000001');
  select exists (select 1 from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d
                  where d.profile_id = 'ea0a0000-0000-4000-8000-000000000005') into v_esta;
  reset role;
  if v_esta then raise exception '[5] el tutor aparece en el directorio de staff'; end if;

  -- Sin sesion.
  perform pg_temp.sin_sesion();
  if auth.uid() is not null then
    raise exception '[5] el fixture no consiguio quedarse sin sesion';
  end if;
  begin
    perform * from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm like '%no_session%' then ok_sin := true; else raise; end if;
  end;
  if not ok_sin then raise exception '[5] sin sesion la RPC contesta igual'; end if;
end $$;

-- ── [6] El orden, y el desempate ─────────────────────────────────────────────
do $$
declare v_nombres text[]; v_tocayos uuid[]; v_otra uuid[];
begin
  perform pg_temp.como('ea0a0000-0000-4000-8000-000000000001');
  select array_agg(d.full_name order by o)
    into v_nombres
    from (select d.*, row_number() over () as o
            from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d) d;

  -- Los dos «Jose Coach», en el orden en que salen.
  select array_agg(d.profile_id order by o) into v_tocayos
    from (select d.*, row_number() over () as o
            from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d) d
   where d.full_name = 'Jose Coach';
  select array_agg(d.profile_id order by o) into v_otra
    from (select d.*, row_number() over () as o
            from public.staff_conversation_directory('ea000000-0000-4000-8000-000000000001') d) d
   where d.full_name = 'Jose Coach';
  reset role;

  -- Alfabetico: Celia < Elena < Jose = Jose (Aurora es quien pregunta y no sale).
  if v_nombres <> array['Celia Delegada','Elena Excerrado','Jose Coach','Jose Coach'] then
    raise exception '[6] el directorio no viene ordenado por nombre: %', v_nombres;
  end if;
  if array_length(v_tocayos, 1) <> 2 then
    raise exception '[6] esperaba dos tocayos y hay %', array_length(v_tocayos, 1);
  end if;
  if v_tocayos <> v_otra then
    raise exception '[6] dos nombres iguales salen en orden distinto entre llamadas: falta el desempate';
  end if;
  if v_tocayos[1] > v_tocayos[2] then
    raise exception '[6] el desempate no es por id ascendente: %', v_tocayos;
  end if;
end $$;

-- ── [7] ACL ──────────────────────────────────────────────────────────────────
do $$
declare v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'staff_conversation_directory';

  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception '[7] anon puede ejecutar staff_conversation_directory';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '[7] authenticated NO puede ejecutarla: el selector se queda mudo';
  end if;
  if (select count(*) from aclexplode((select proacl from pg_proc where oid = v_oid))
       where grantee = 0) > 0 then
    raise exception '[7] la ACL sigue concediendo a PUBLIC';
  end if;
end $$;

rollback;
