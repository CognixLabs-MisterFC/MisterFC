-- Panel superadmin cross-club — DATOS AGREGADOS por club (una fila por club).
--
-- RPC de LECTURA `platform_club_breakdown()`, SOLO superadmin (gate is_superadmin,
-- igual patrón que platform_club_metrics / platform_list_clubs). Devuelve, por
-- club, el desglose de PERSONAS por rol (jerarquía combinada) + familiares +
-- seguidores + jugadores y equipos de la temporada activa.
--
-- REGLAS DE CONTEO (cerradas por Jose):
--  1/2/7. Cada PERSONA (profile) cuenta UNA vez en su rol MÁS ALTO, combinando
--     memberships.role (rol de club) y team_staff.staff_role (rol de equipo). Se
--     cuentan PERSONAS DISTINTAS: memberships es única por (profile_id, club_id) →
--     una fila = una persona; team_staff se agrega a un único tier por persona
--     antes de combinar, así que varios equipos/roles NO multiplican.
--     Jerarquía (nivel; menor = más alto):
--       1 admin_club · 2 director · 3 coordinador · 4 entrenador_principal ·
--       5 segundo entrenador (entrenador_ayudante) · 6 preparador_fisico ·
--       7 delegado · 8 jugador (no se muestra como columna de staff).
--  3. Cuerpo técnico (principal/segundo/preparador/delegado) se clasifica desde
--     team_staff.staff_role ACTIVO (left_at is null): preparador_fisico y delegado
--     NO existen a nivel de club (su membership es 'entrenador_ayudante'), así que
--     clasificar por membership dejaría esas columnas a 0. Si alguien tiene varios
--     roles de equipo, gana el más alto.
--  4. AYUDANTE SIN EQUIPO: membership.role='entrenador_ayudante' y SIN fila activa
--     en team_staff → cuenta como Segundo entrenador (existe en el club, tiene
--     acceso). Es el ÚNICO rol de membership tratado como "contenedor": si tiene
--     team_staff, manda team_staff; si no, vale como segundo entrenador.
--     (admin/director/coordinador/entrenador_principal de membership SÍ son señal
--     fiable y cuentan por sí mismos — regla 2.)
--  5. FAMILIARES y SEGUIDORES: columnas separadas, FUERA de la jerarquía; una
--     persona puede estar en su columna de staff Y en familiares. Solo ACTIVOS:
--       · familiar activo = fila en player_accounts con relation parent/guardian
--         (esa fila solo se crea al ACEPTAR). Pendiente = invitations sin aceptar.
--       · seguidor activo = fila en player_spectators (solo al aceptar; al revocar
--         se BORRA la fila → deja de contar). Pendiente = invitations sin aceptar.
--     Se cuentan PERSONAS distintas (un padre con 2 hijos = 1 familiar; un abuelo
--     que sigue a 2 nietos = 1 seguidor).
--  6. TEMPORADA ACTIVA: Jugadores y Equipos = los de la temporada en curso
--     (seasons.status='active', label = teams.season). Jugadores excluye los
--     SUPRIMIDOS RGPD (players.erased_at not null — F14-7).
--
-- SEGURIDAD: SECURITY DEFINER + search_path fijo + gate is_superadmin(). Sin
-- sesión → no_session; no superadmin → forbidden. revoke public / grant
-- authenticated (el gate interno corta a cualquier authenticated no-superadmin;
-- ningún admin/director de club obtiene datos).

create or replace function public.platform_club_breakdown()
returns table (
  club_id uuid,
  club_name text,
  admin_club integer,
  director integer,
  coordinador integer,
  entrenador_principal integer,
  segundo_entrenador integer,
  preparador_fisico integer,
  delegado integer,
  jugadores integer,
  familiares integer,
  seguidores integer,
  equipos integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  return query
  with
  -- Tier de cuerpo técnico por persona (menor = más alto), agregando TODOS sus
  -- roles de equipo activos → un único valor por (club, profile). Regla 3/7.
  ts_tier as (
    select m2.club_id, m2.profile_id,
      min(case ts.staff_role
            when 'coordinador'          then 3
            when 'entrenador_principal'  then 4
            when 'entrenador_ayudante'   then 5
            when 'preparador_fisico'     then 6
            when 'delegado'              then 7
          end) as tier
    from public.team_staff ts
    join public.memberships m2 on m2.id = ts.membership_id
    where ts.left_at is null
    group by m2.club_id, m2.profile_id
  ),
  -- Tier final por persona: el más alto entre membership.role y team_staff.
  -- entrenador_ayudante es contenedor: si tiene team_staff manda team_staff,
  -- si no vale como segundo entrenador (regla 4).
  person_tier as (
    select m.club_id, m.profile_id,
      least(
        case m.role
          when 'admin_club'           then 1
          when 'director'             then 2
          when 'coordinador'          then 3
          when 'entrenador_principal' then 4
          when 'entrenador_ayudante'  then case when tt.tier is not null then 99 else 5 end
          when 'jugador'              then 8
          else 99
        end,
        coalesce(tt.tier, 99)
      ) as tier
    from public.memberships m
    left join ts_tier tt on tt.club_id = m.club_id and tt.profile_id = m.profile_id
  ),
  staff as (
    select pt.club_id,
      count(*) filter (where pt.tier = 1) as admin_club,
      count(*) filter (where pt.tier = 2) as director,
      count(*) filter (where pt.tier = 3) as coordinador,
      count(*) filter (where pt.tier = 4) as entrenador_principal,
      count(*) filter (where pt.tier = 5) as segundo_entrenador,
      count(*) filter (where pt.tier = 6) as preparador_fisico,
      count(*) filter (where pt.tier = 7) as delegado
    from person_tier pt
    group by pt.club_id
  ),
  -- Temporada activa por club (única): label = teams.season (regla 6).
  active_season as (
    select s.club_id, s.label
    from public.seasons s
    where s.status = 'active'
  ),
  -- Familiares activos distintos (relation parent/guardian; fila = aceptado).
  familia as (
    select p.club_id, count(distinct pa.profile_id) as familiares
    from public.player_accounts pa
    join public.players p on p.id = pa.player_id
    where pa.relation in ('parent', 'guardian')
    group by p.club_id
  ),
  -- Seguidores activos distintos (fila en player_spectators = aceptado; revocado
  -- = fila borrada, no cuenta).
  seguidor as (
    select p.club_id, count(distinct ps.spectator_profile_id) as seguidores
    from public.player_spectators ps
    join public.players p on p.id = ps.player_id
    group by p.club_id
  ),
  -- Jugadores de la temporada activa: pertenencia ACTIVA (team_members.left_at
  -- is null) a un equipo de la temporada activa; excluye suprimidos RGPD.
  jugadores_cte as (
    select p.club_id, count(distinct p.id) as jugadores
    from public.players p
    join public.team_members tm on tm.player_id = p.id and tm.left_at is null
    join public.teams t on t.id = tm.team_id
    join active_season a on a.club_id = p.club_id and t.season = a.label
    where p.erased_at is null
    group by p.club_id
  ),
  -- Equipos de la temporada activa.
  equipos_cte as (
    select t.club_id, count(*) as equipos
    from public.teams t
    join active_season a on a.club_id = t.club_id and t.season = a.label
    group by t.club_id
  )
  select
    c.id, c.name,
    coalesce(st.admin_club, 0)::int,
    coalesce(st.director, 0)::int,
    coalesce(st.coordinador, 0)::int,
    coalesce(st.entrenador_principal, 0)::int,
    coalesce(st.segundo_entrenador, 0)::int,
    coalesce(st.preparador_fisico, 0)::int,
    coalesce(st.delegado, 0)::int,
    coalesce(jc.jugadores, 0)::int,
    coalesce(fa.familiares, 0)::int,
    coalesce(sg.seguidores, 0)::int,
    coalesce(ec.equipos, 0)::int
  from public.clubs c
  left join staff        st on st.club_id = c.id
  left join jugadores_cte jc on jc.club_id = c.id
  left join familia      fa on fa.club_id = c.id
  left join seguidor     sg on sg.club_id = c.id
  left join equipos_cte  ec on ec.club_id = c.id
  order by c.created_at asc;
end;
$$;

comment on function public.platform_club_breakdown() is
  'Panel superadmin — una fila por club: personas por rol (jerarquía combinada '
  'memberships+team_staff, persona en su rol más alto, distinct) + familiares + '
  'seguidores activos + jugadores y equipos de la temporada activa. Solo '
  'superadmin (gate is_superadmin). SECURITY DEFINER.';

revoke all on function public.platform_club_breakdown() from public;
grant execute on function public.platform_club_breakdown() to authenticated;
