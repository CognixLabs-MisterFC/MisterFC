-- ════════════════════════════════════════════════════════════════════════════
-- EL VÍNCULO DE LOS 15 EQUIPOS DE UDFONTETA CON LA FFCV.
--
-- F-1 (20261116000000) abrió las columnas; esto las rellena. Es una migración de
-- DATOS: no toca esquema, ni constraints, ni policies.
--
-- ── DE DÓNDE SALE CADA CÓDIGO ──────────────────────────────────────────────
-- Leídos el 2026-10-12 de `api/clubes/ajax_club_equipos.php?clave=1687&cod_temporada=22`,
-- que devuelve los 15 equipos del club con `en_competicion = 1`. El emparejamiento con
-- los equipos de MisterFC lo confirmó Jose el 2026-10-12.
--
-- ── CÓMO SE EMPAREJÓ, Y POR QUÉ NO ES A OJO ────────────────────────────────
-- Reduciendo cada lado a la pareja (categoría, letra) sale una BIYECCIÓN: 15 parejas
-- distintas en la FFCV, 15 en MisterFC, sin un choque ni un sobrante. Nueve filas
-- tienen además confirmación independiente de la letra, porque `teams.division`
-- coincide con el escalón federado: `primera` ↔ «1ª. Regional Cadete», `segunda` ↔ las
-- «2ª Regional», `tercera` ↔ las «Tercera FFCV». Y Prebenjamín A es el único de su
-- categoría en ambos lados, así que está forzado.
--
-- Las SEIS restantes —los tres Alevín y los tres Benjamín— descansan solo en la letra,
-- porque la FFCV parte esas categorías por año de nacimiento y MisterFC no: en Benjamín
-- su 'A' y 'B' son de 2º año y la 'C' de 1er año; en Alevín su 'A' es de 2º año y la 'B'
-- y 'C' de 1er año. Jose las confirmó mirando los tamaños de plantilla federada, que no
-- se confunden: Alevín B tiene 13 licencias y Alevín C seis; Benjamín B nueve y
-- Benjamín C cinco.
--
-- ── POR QUÉ SE EMPAREJA POR NOMBRE Y NO POR uuid ───────────────────────────
-- Porque el estándar de la casa para una migración de datos es que sea GENÉRICA, no
-- por id ni por club (ver 20261034000000_reconcile_standard_categories_accents, que lo
-- dice con esas palabras). Pero aquí hay una segunda razón, más importante: un uuid
-- copiado a mano de una consulta es un carácter que nadie puede revisar, y un vínculo
-- equivocado NO falla — deja el calendario de un equipo en el equipo de al lado, en
-- silencio. Casando por (slug del club, temporada, categoría, nombre del equipo),
-- cualquier desajuste deja la fila SIN tocar y el guard del final lo caza por el
-- recuento. El error se vuelve ruidoso.
--
-- ── QUÉ PASA EN LA BD EFÍMERA DEL CI ───────────────────────────────────────
-- Nada: no existe el club `udfonteta`, así que los dos UPDATE afectan a CERO filas y el
-- guard sale por su primera puerta. Esto NO lleva pgTAP, y no es un olvido: el CI
-- construye la base desde el ledger y estas filas no están ahí, así que una suite no
-- mediría nada. Lo que cubre una migración de datos es el GUARD, que corre al aplicar.
--
-- ── IDEMPOTENTE ────────────────────────────────────────────────────────────
-- Volver a aplicarla escribe los mismos valores. El único parcial
-- `teams_ffcv_team_code_season_uniq (ffcv_team_code, season)` protege de que dos
-- equipos acaben con el mismo código; si eso pasara, la migración muere aquí y no deja
-- el vínculo a medias.
--
-- ── LO QUE NO RELLENA, A PROPÓSITO ─────────────────────────────────────────
-- `ffcv_competition_code` y `ffcv_group_code` SOLO del Infantil B, que es el único
-- cuyo grupo se barrió (Grup - 12 de «Segona Infantil València», 26 jornadas). Los
-- otros catorce los descubre F-3: no existe búsqueda inversa equipo→grupo y cada uno
-- cuesta recorrer los grupos de su competición. Inventarlos sería peor que dejarlos
-- NULL, porque un grupo equivocado devuelve el calendario de otros.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los 15 códigos de equipo + la temporada de la FFCV (22 = 2026-2027).
-- ─────────────────────────────────────────────────────────────────────────────
update public.teams t
   set ffcv_team_code   = v.codigo,
       ffcv_season_code = '22'
  from (values
          ('Prebenjamín', 'Prebenjamín A', '15144'),
          ('Benjamín',    'Benjamín A',    '15142'),
          ('Benjamín',    'Benjamín B',    '901632238'),
          ('Benjamín',    'Benjamín C',    '29899335'),
          ('Alevín',      'Alevín A',      '15141'),
          ('Alevín',      'Alevín B',      '28334'),
          ('Alevín',      'Alevín C',      '905505267'),
          ('Infantil',    'Infantil A',    '15139'),
          ('Infantil',    'Infantil B',    '15140'),
          ('Infantil',    'Infantil C',    '900463025'),
          ('Cadete',      'Cadete A',      '15136'),
          ('Cadete',      'Cadete B',      '15137'),
          ('Juvenil',     'Juvenil A',     '15135'),
          ('Juvenil',     'Juvenil B',     '24377'),
          ('Sénior',      'Senior A',      '15133')
       ) as v(categoria, equipo, codigo),
       public.categories c,
       public.clubs cl
 where t.category_id = c.id
   and c.club_id     = cl.id
   and cl.slug       = 'udfonteta'
   and t.season      = '2026-27'
   and c.name        = v.categoria
   and t.name        = v.equipo;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Competición y grupo, solo del Infantil B.
-- ─────────────────────────────────────────────────────────────────────────────
update public.teams t
   set ffcv_competition_code = '905431987',   -- Segona Infantil València
       ffcv_group_code       = '905432005'    -- Grup - 12
  from public.categories c, public.clubs cl
 where t.category_id = c.id
   and c.club_id     = cl.id
   and cl.slug       = 'udfonteta'
   and t.season      = '2026-27'
   and t.ffcv_team_code = '15140';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Guard. Corre al APLICAR, y mide el EFECTO y el RESULTADO.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_club uuid;
  n int;
  v_sueltos text;
begin
  select cl.id into v_club from public.clubs cl where cl.slug = 'udfonteta';
  if v_club is null then
    raise notice 'sin club udfonteta (BD efimera del CI): nada que vincular, 0 filas';
    return;
  end if;

  -- RESULTADO · los 15 equipos de la temporada vigente, vinculados.
  select count(*) into n
    from public.teams t join public.categories c on c.id = t.category_id
   where c.club_id = v_club and t.season = '2026-27' and t.ffcv_team_code is not null;
  if n <> 15 then
    raise exception 'el vinculo ha quedado a medias: % de 15 equipos con codigo. Si falta alguno, su nombre o su categoria en MisterFC no es el que se midio el 2026-10-12', n;
  end if;

  -- RESULTADO · la temporada de la FFCV puesta en los 15.
  select count(*) into n
    from public.teams t join public.categories c on c.id = t.category_id
   where c.club_id = v_club and t.season = '2026-27' and t.ffcv_season_code = '22';
  if n <> 15 then
    raise exception 'ffcv_season_code no esta en los 15 equipos (esta en %)', n;
  end if;

  -- RESULTADO · el Infantil B, con competicion y grupo.
  if not exists (
    select 1 from public.teams t join public.categories c on c.id = t.category_id
     where c.club_id = v_club and t.season = '2026-27'
       and t.ffcv_team_code = '15140'
       and t.ffcv_competition_code = '905431987'
       and t.ffcv_group_code = '905432005'
  ) then
    raise exception 'el Infantil B (15140) deberia tener competicion 905431987 y grupo 905432005';
  end if;

  -- EFECTO · y nada mas. Ningun equipo de otra temporada ni de otro club tocado.
  select string_agg(format('%s/%s=%s', cl.slug, t.name, t.ffcv_team_code), ', ' order by cl.slug, t.name)
    into v_sueltos
    from public.teams t
    join public.categories c on c.id = t.category_id
    join public.clubs cl     on cl.id = c.club_id
   where t.ffcv_team_code is not null
     and not (c.club_id = v_club and t.season = '2026-27');
  if v_sueltos is not null then
    raise exception 'hay equipos vinculados fuera de UDFonteta 2026-27: %', v_sueltos;
  end if;
end $$;
