-- BC-8 · La consola de plataforma tiene que poder ver un club SIN ADMINISTRADOR.
--
-- Una sola funcion, ningun cambio de esquema, ningun dato.
--
-- `platform_club_metrics` contaba TODAS las memberships, incluidas las de baja. O sea
-- que un club cuyo unico admin_club se habia ido —o habia borrado su cuenta con la
-- serie BC— seguia apareciendo en la consola con `admin_club = 1`, y el superadmin no
-- tenia forma de detectarlo. Ese es el sitio duradero del aviso que BC-7 manda a
-- plataforma: el aviso avisa una vez, la consola lo sostiene.
--
-- Medido en produccion antes de tocar nada (2026-09-11): "CD Ejemplo" declaraba 13
-- miembros y tiene 10 activos; "UDFonteta" ya esta HOY sin ningun admin_club.
--
-- Efecto colateral querido: TODOS los contadores por rol y `members_total` pasan a ser
-- de miembros ACTIVOS. Un club que declara 13 miembros cuando 3 estan de baja esta
-- mintiendo en la consola. `pending_invitations` y `players` no se tocan.
--
-- Definicion tomada VERBATIM de produccion (pg_get_functiondef, 2026-09-11) con el
-- unico anadido del `where`. `create or replace`: conserva duenno y ACL.


CREATE OR REPLACE FUNCTION public.platform_club_metrics()
 RETURNS TABLE(club_id uuid, club_name text, admin_club integer, director integer, coordinador integer, entrenador_principal integer, entrenador_ayudante integer, jugador integer, members_total integer, pending_invitations integer, players integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  return query
    select
      c.id, c.name,
      coalesce(mc.admin_club, 0)::int,
      coalesce(mc.director, 0)::int,
      coalesce(mc.coordinador, 0)::int,
      coalesce(mc.entrenador_principal, 0)::int,
      coalesce(mc.entrenador_ayudante, 0)::int,
      coalesce(mc.jugador, 0)::int,
      coalesce(mc.members_total, 0)::int,
      coalesce(inv.pending, 0)::int,
      coalesce(pl.players, 0)::int
    from public.clubs c
    left join (
      select m.club_id,
        count(*) filter (where m.role = 'admin_club')           as admin_club,
        count(*) filter (where m.role = 'director')             as director,
        count(*) filter (where m.role = 'coordinador')          as coordinador,
        count(*) filter (where m.role = 'entrenador_principal') as entrenador_principal,
        count(*) filter (where m.role = 'entrenador_ayudante')  as entrenador_ayudante,
        count(*) filter (where m.role = 'jugador')              as jugador,
        count(*)                                                as members_total
      from public.memberships m
      -- BC-8 — SOLO miembros ACTIVOS. Antes contaba tambien a los dados de baja, asi
      -- que un club cuyo unico admin se habia ido (o habia borrado su cuenta) seguia
      -- apareciendo con admin_club = 1 y la consola no podia verlo. Con esto,
      -- admin_club = 0 significa exactamente "este club no tiene administrador".
      where m.left_at is null
      group by m.club_id
    ) mc on mc.club_id = c.id
    left join (
      select i.club_id, count(*) as pending
      from public.invitations i
      where i.accepted_at is null and i.expires_at > now()
      group by i.club_id
    ) inv on inv.club_id = c.id
    left join (
      select p.club_id, count(*) as players
      from public.players p
      group by p.club_id
    ) pl on pl.club_id = c.id
    order by c.created_at asc;
end;
$function$;

comment on function public.platform_club_metrics() is
  'F14B-7 + BC-8 — metricas por club para la consola de plataforma. Cuenta SOLO miembros ACTIVOS (left_at is null): admin_club = 0 significa que el club no tiene administrador. Solo superadmin.';
