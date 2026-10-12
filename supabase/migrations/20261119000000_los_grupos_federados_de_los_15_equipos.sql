-- ════════════════════════════════════════════════════════════════════════════
-- DÓNDE COMPITE CADA UNO DE LOS 15 EQUIPOS: COMPETICIÓN Y GRUPO.
--
-- #765 (20261118000000) dejó los 15 códigos de equipo y la temporada, y solo UN
-- grupo: el del Infantil B. Esto rellena los catorce que faltaban. Es una migración
-- de DATOS: no toca esquema, ni constraints, ni policies.
--
-- ── DE DÓNDE SALE CADA PAREJA ──────────────────────────────────────────────
-- Medidas el 2026-10-12 ejecutando `resolverUbicacion()` de F-3 (#766) contra la API
-- de la FFCV, equipo por equipo. No hay búsqueda inversa equipo→grupo: la función
-- recorre las competiciones de la categoría del equipo y barre sus grupos mirando la
-- clasificación de cada uno. 397 llamadas de red en total.
--
-- ── EL CONTROL QUE VALIDA LA MEDICIÓN ──────────────────────────────────────
-- El Infantil B (15140) viajó en la medición aunque su grupo ya se conocía por #765,
-- y volvió a dar competición 905431987 y grupo 905432005 — los mismos. El método se
-- comprobó así contra un valor que NO sale de esta medición. Por eso su fila se
-- vuelve a escribir aquí en lugar de excluirla: escribe lo mismo y el guard lo exige.
--
-- ── DOCE COMPETICIONES, QUINCE GRUPOS ──────────────────────────────────────
-- Las competiciones NO son quince: los tres Infantiles comparten la 905431987 y los
-- dos Juveniles la 905431573. Los GRUPOS sí son quince y todos distintos, y de ahí
-- sale el invariante más fuerte del guard: si dos equipos acabaran en el mismo grupo,
-- uno de los dos tiene el calendario del otro. Eso se comprueba, no se supone.
--
-- ── POR QUÉ SE CASA POR CÓDIGO DE EQUIPO Y NO POR uuid ─────────────────────
-- Sigue siendo GENÉRICA, como manda la casa (ver 20261034000000_reconcile_standard_
-- categories_accents): casa por (slug del club, temporada, código FFCV del equipo).
-- El código FFCV es la identidad del equipo EN LA FFCV, que es justo de donde viene
-- la pareja medida, y ya está en la BD verificado por el guard de #765. Se exige
-- además que el nombre del equipo en MisterFC coincida: dos llaves que han de estar
-- de acuerdo, y si discrepan la fila se queda SIN tocar y el recuento del guard lo
-- caza. Un uuid copiado a mano sería un carácter irrevisable, y un grupo equivocado
-- NO falla: devuelve, en silencio, el calendario de otros catorce equipos.
--
-- ── QUÉ PASA EN LA BD EFÍMERA DEL CI ───────────────────────────────────────
-- Nada: no existe el club `udfonteta`, el UPDATE afecta a CERO filas y el guard sale
-- por su primera puerta. Esto NO lleva pgTAP, y no es un olvido: el CI construye la
-- base desde el ledger y estas filas no están ahí, así que una suite no mediría nada.
-- Lo que cubre una migración de datos es el GUARD, que corre al APLICAR.
--
-- ── IDEMPOTENTE ────────────────────────────────────────────────────────────
-- Volver a aplicarla escribe los mismos valores.
--
-- ── LO QUE NO HACE ─────────────────────────────────────────────────────────
-- No crea ni un evento. Estas tres columnas son la caché que le dice al lector de
-- F-3 dónde mirar; dar de alta los partidos es el botón, y lo dispara una persona.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Competición y grupo de los 15.
-- ─────────────────────────────────────────────────────────────────────────────
update public.teams t
   set ffcv_competition_code = v.competicion,
       ffcv_group_code       = v.grupo
  from (values
          -- equipo            código FFCV    competición    grupo          (nombre del grupo)
          ('Prebenjamín A',    '15144',       '905432548',   '905432556'),  -- F.C.-Grup - 8
          ('Benjamín A',       '15142',       '905432293',   '905432296'),  -- Grup.- 3
          ('Benjamín B',       '901632238',   '905432240',   '905432255'),  -- F.C.- Grup 15
          ('Benjamín C',       '29899335',    '905432357',   '905432368'),  -- F.C.- Grup 11
          ('Alevín A',         '15141',       '905432098',   '905432114'),  -- F.C. Grup 16
          ('Alevín B',         '28334',       '905432204',   '905432207'),  -- Grup.- 3
          ('Alevín C',         '905505267',   '905432155',   '905432170'),  -- F.C.- Grup 16
          ('Infantil A',       '15139',       '905431987',   '905432002'),  -- Grup - 10
          ('Infantil B',       '15140',       '905431987',   '905432005'),  -- Grup - 12  (el control)
          ('Infantil C',       '900463025',   '905431987',   '905432007'),  -- Grup - 13
          ('Cadete A',         '15136',       '905431892',   '905431896'),  -- Grup - 4
          ('Cadete B',         '15137',       '905431948',   '905431956'),  -- Grup - 8
          ('Juvenil A',        '15135',       '905431573',   '905431586'),  -- Grup - 13
          ('Juvenil B',        '24377',       '905431573',   '905431585'),  -- Grup - 12
          ('Senior A',         '15133',       '905431620',   '905431625')   -- Grup - 5
       ) as v(equipo, codigo, competicion, grupo),
       public.categories c,
       public.clubs cl
 where t.category_id   = c.id
   and c.club_id       = cl.id
   and cl.slug         = 'udfonteta'
   and t.season        = '2026-27'
   and t.ffcv_team_code = v.codigo
   and t.name          = v.equipo;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guard. Corre al APLICAR, y mide el EFECTO y el RESULTADO.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_club uuid;
  n int;
  v_choques text;
  v_sueltos text;
begin
  select cl.id into v_club from public.clubs cl where cl.slug = 'udfonteta';
  if v_club is null then
    raise notice 'sin club udfonteta (BD efimera del CI): nada que localizar, 0 filas';
    return;
  end if;

  -- RESULTADO · los 15, con competicion Y grupo.
  select count(*) into n
    from public.teams t join public.categories c on c.id = t.category_id
   where c.club_id = v_club and t.season = '2026-27'
     and t.ffcv_competition_code is not null
     and t.ffcv_group_code is not null;
  if n <> 15 then
    raise exception 'quedan equipos sin localizar: % de 15 con competicion y grupo. Si falta alguno, su nombre o su codigo FFCV en MisterFC no es el que se midio el 2026-10-12', n;
  end if;

  -- RESULTADO · 15 grupos DISTINTOS. Dos equipos en el mismo grupo = uno tiene el
  -- calendario del otro, y eso no se ve mirando una fila.
  select count(distinct t.ffcv_group_code) into n
    from public.teams t join public.categories c on c.id = t.category_id
   where c.club_id = v_club and t.season = '2026-27' and t.ffcv_group_code is not null;
  if n <> 15 then
    select string_agg(g || ' x' || c2, ', ' order by g) into v_choques from (
      select t.ffcv_group_code as g, count(*) as c2
        from public.teams t join public.categories c on c.id = t.category_id
       where c.club_id = v_club and t.season = '2026-27' and t.ffcv_group_code is not null
       group by t.ffcv_group_code having count(*) > 1
    ) d;
    raise exception 'hay grupos repetidos entre nuestros equipos (%): el calendario de uno acabaria en el otro', v_choques;
  end if;

  -- RESULTADO · 12 competiciones distintas: los 3 Infantiles comparten una y los 2
  -- Juveniles otra. Si salieran 15, el barrido no es el que se midio.
  select count(distinct t.ffcv_competition_code) into n
    from public.teams t join public.categories c on c.id = t.category_id
   where c.club_id = v_club and t.season = '2026-27' and t.ffcv_competition_code is not null;
  if n <> 12 then
    raise exception 'se esperaban 12 competiciones distintas y hay %', n;
  end if;

  -- RESULTADO · el Infantil B sigue donde #765 lo dejo. Es el control de la medicion.
  if not exists (
    select 1 from public.teams t join public.categories c on c.id = t.category_id
     where c.club_id = v_club and t.season = '2026-27'
       and t.ffcv_team_code = '15140'
       and t.ffcv_competition_code = '905431987'
       and t.ffcv_group_code = '905432005'
  ) then
    raise exception 'el Infantil B (15140) ha cambiado de competicion o de grupo: la medicion no cuadra con #765';
  end if;

  -- RESULTADO · un grupo siempre pertenece a su competicion. Si dos equipos declaran
  -- el mismo grupo bajo competiciones distintas, uno de los dos pares esta mal copiado.
  select string_agg(format('grupo %s en %s', g, comps), ', ' order by g) into v_choques from (
    select t.ffcv_group_code as g, string_agg(distinct t.ffcv_competition_code, '/') as comps
      from public.teams t join public.categories c on c.id = t.category_id
     where c.club_id = v_club and t.season = '2026-27' and t.ffcv_group_code is not null
     group by t.ffcv_group_code having count(distinct t.ffcv_competition_code) > 1
  ) d;
  if v_choques is not null then
    raise exception 'un grupo aparece bajo dos competiciones: %', v_choques;
  end if;

  -- EFECTO · y nada mas. Ningun equipo de otra temporada ni de otro club tocado.
  select string_agg(format('%s/%s=%s', cl.slug, t.name, t.ffcv_group_code), ', ' order by cl.slug, t.name)
    into v_sueltos
    from public.teams t
    join public.categories c on c.id = t.category_id
    join public.clubs cl     on cl.id = c.club_id
   where (t.ffcv_group_code is not null or t.ffcv_competition_code is not null)
     and not (c.club_id = v_club and t.season = '2026-27');
  if v_sueltos is not null then
    raise exception 'hay equipos localizados fuera de UDFonteta 2026-27: %', v_sueltos;
  end if;
end $$;
