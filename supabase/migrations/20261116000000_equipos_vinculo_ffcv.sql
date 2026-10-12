-- F-1 · El vínculo entre un equipo de MisterFC y su equipo en la FFCV.
--
-- PARA QUÉ. La serie FFCV quiere crear los partidos del calendario federado como eventos
-- de MisterFC. Para pedir ese calendario hace falta saber, de cada equipo, QUIÉN es en la
-- federación. Hoy no hay dónde guardarlo: `teams` tiene (category_id, club_id, name,
-- format, color, division, season, created_at) y nada más.
--
-- Esta migración solo abre el hueco. NO vincula a nadie, NO toca RLS, NO añade código y
-- NO lee nada de la FFCV: las cuatro columnas nacen NULL en los 15 equipos y las rellena
-- después un humano (la escritura de `teams` es de admin_club/director, policy
-- `teams_write_admin_coord`, y eso no cambia aquí).
--
-- ── POR QUÉ CUATRO COLUMNAS Y NO UNA ─────────────────────────────────────────────────
-- Medido contra la API de la FFCV el 2026-10-12, con el Infantil B (codequipo 15140):
--
--   · ffcv_team_code        '15140'      ← la identidad. Lo único irreductible.
--   · ffcv_season_code      '22'         ← su temporada 2026-2027
--   · ffcv_competition_code '905431987'  ← «Segona Infantil València»
--   · ffcv_group_code       '905432005'  ← «Grup - 12», 26 jornadas, 14 equipos
--
-- Las tres últimas son CACHÉ, y no son adorno: el endpoint de partidos es
-- `resultados_por_grupo_jornada_data.php?cod_temporada&cod_competicion&cod_grupo&cod_jornada`,
-- o sea que sin el grupo no hay calendario. Y NO existe búsqueda inversa equipo→grupo:
-- descubrirlo costó recorrer temporadas → competiciones → grupos y BARRER los 23 grupos
-- de la competición mirando en cada uno la jornada 1. Se puede re-derivar siempre desde
-- `ffcv_team_code` (ficha del equipo → `codigo_categoria` → elegir entre las competiciones
-- de esa categoría → barrer grupos), pero no se quiere pagar ese barrido en cada
-- sincronización, y menos contra un origen que se degrada (ver más abajo).
--
-- ── POR QUÉ EL ÚNICO ES (CÓDIGO, SEASON) Y NO EL CÓDIGO SOLO ─────────────────────────
-- `teams` tiene una fila por equipo Y TEMPORADA (`season` es NOT NULL, formato YYYY-YY,
-- y ya existe `teams_club_name_season_uniq (club_id, name, season)`). No sé —y no lo
-- puedo saber hasta que pase una temporada— si la FFCV conserva el `codequipo` de un año
-- al siguiente o reparte uno nuevo. Los códigos observados apuntan a que SÍ persisten:
-- los del Fonteta van del 15133 al 15144, correlativos y claramente asignados una vez
-- hace años, junto a otros modernos (900463025, 905505267, 29899335).
--
-- Si persisten y el índice fuera global, al crear la temporada 2027-28 el alta del nuevo
-- «Infantil B» con el mismo código sería RECHAZADA, y el fallo saldría en junio, al
-- preparar la temporada, no hoy. Con (código, season) el índice aguanta las dos
-- hipótesis: dentro de una temporada dos equipos no pueden reclamar el mismo código
-- —que es el error real que se quiere cazar, un mapeo cruzado— y entre temporadas se
-- repite sin estorbar.
--
-- Es PARCIAL (`where ffcv_team_code is not null`) porque el estado normal durante el
-- vínculo manual es que casi todos los equipos estén sin código, y NULL no colisiona en
-- un único de todas formas: el parcial lo deja escrito y ahorra el índice.
--
-- ── EL CHECK DE FORMATO ──────────────────────────────────────────────────────────────
-- Los cuatro códigos observados son enteros en texto, de 2 a 9 dígitos. El CHECK pide
-- dígitos y entre 1 y 20 caracteres. No está ahí por elegancia: la equivocación realista
-- al vincular a mano es pegar el NOMBRE del equipo («U.D. Fonteta 'B'») o el nombre del
-- grupo («Grup - 12») en la columna del código, y eso lo para el CHECK en el momento en
-- vez de descubrirse como un calendario vacío tres semanas después. Si algún día la FFCV
-- pasa a códigos alfanuméricos, relajar un CHECK es una migración de una línea.
--
-- Se guardan como `text` y no como entero a propósito: son identificadores ajenos, no
-- números con los que se cuente, y un cero por delante no se debe perder.
--
-- ── LO QUE ESTA MIGRACIÓN NO ARREGLA, Y CONVIENE QUE ESTÉ ESCRITO ────────────────────
-- El origen de la FFCV (`appwebffcv.novanet.es/pnfg/NPcd/NSMApi_*`, detrás del proxy
-- `ffcv.es/competiciones/api/`) se degrada a ratos, y el proxy lo TAPA: devuelve
-- HTTP 200 con `{"jornadas": [], "_source": "degraded_empty"}`. Además hay filtros que
-- acepta y NO aplica (`cod_grupo` en `equipos.php` devolvió los 7.238 equipos de la
-- federación; `nombre` en `campos.php` devuelve lo mismo con filtro y sin él). Eso es
-- problema del lector (F-3), no del esquema, pero es la razón por la que el grupo se
-- cachea aquí en vez de re-descubrirse: menos llamadas a un sitio que miente al caerse.
--
-- Decisiones de Jose, 2026-10-12: los cuatro códigos (no solo el del equipo); las
-- sanciones quedan fuera de la serie; el resultado lo siguen poniendo los entrenadores
-- desde el directo.
--
-- Suite: supabase/tests/equipos_vinculo_ffcv.sql

alter table public.teams
  add column ffcv_team_code        text,
  add column ffcv_season_code      text,
  add column ffcv_competition_code text,
  add column ffcv_group_code       text;

alter table public.teams
  add constraint teams_ffcv_team_code_format check (
    ffcv_team_code is null or ffcv_team_code ~ '^[0-9]{1,20}$'
  ),
  add constraint teams_ffcv_season_code_format check (
    ffcv_season_code is null or ffcv_season_code ~ '^[0-9]{1,20}$'
  ),
  add constraint teams_ffcv_competition_code_format check (
    ffcv_competition_code is null or ffcv_competition_code ~ '^[0-9]{1,20}$'
  ),
  add constraint teams_ffcv_group_code_format check (
    ffcv_group_code is null or ffcv_group_code ~ '^[0-9]{1,20}$'
  );

create unique index teams_ffcv_team_code_season_uniq
  on public.teams (ffcv_team_code, season)
  where ffcv_team_code is not null;

comment on column public.teams.ffcv_team_code is
  'Codigo del equipo en la FFCV (`codequipo`, p.ej. 15140 = Infantil B). NULL = sin '
  'vincular. Unico por (codigo, season) via teams_ffcv_team_code_season_uniq: dentro de '
  'una temporada dos equipos no pueden reclamar el mismo, y entre temporadas se repite '
  'porque la FFCV parece conservarlo. Es la unica de las cuatro columnas irreductible: '
  'las otras tres se re-derivan de esta.';
comment on column public.teams.ffcv_season_code is
  'Temporada de la FFCV (`cod_temporada`, p.ej. 22 = 2026-2027). CACHE: espejo del '
  '`season` propio en el vocabulario de ellos, necesario como parametro de su API.';
comment on column public.teams.ffcv_competition_code is
  'Competicion de la FFCV (`cod_competicion`, p.ej. 905431987 = Segona Infantil Valencia). '
  'CACHE. Ojo: hay varias competiciones por categoria (Alacant/Castello/Valencia '
  'comparten codigo_categoria 7818), asi que la categoria NO la determina.';
comment on column public.teams.ffcv_group_code is
  'Grupo de la FFCV (`cod_grupo`, p.ej. 905432005 = Grup - 12). CACHE, y la mas costosa '
  'de obtener: no existe busqueda equipo->grupo, hay que barrer los grupos de la '
  'competicion. Sin ella no se puede pedir el calendario.';
