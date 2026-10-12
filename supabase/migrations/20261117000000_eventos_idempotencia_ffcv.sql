-- F-2 · La idempotencia del importador: un partido de la FFCV, un evento.
--
-- PARA QUÉ. F-1 (20261116000000) dejó escrito QUIÉN es cada equipo en la federación. Esto
-- deja escrito QUÉ partido federado es cada evento, que es lo que permite volver a pasar
-- el importador sin duplicar nada. Hoy `events` no tiene ninguna referencia externa NI
-- NINGÚN índice único: una segunda pasada crearía otros 26 eventos, y una tercera, 26 más.
--
-- La FFCV regala la clave: `codacta`, uno por partido, estable. Medido el 2026-10-12 en el
-- calendario del Infantil B (codequipo 15140, Grup - 12): la jornada 1 es el acta
-- 26539172 y la 26 es la 26539352, enteros de 8 dígitos.
--
-- Esta migración solo abre el hueco: no marca ningún evento, no toca RLS, no añade código.
--
-- ── POR QUÉ EL ÚNICO ES (CÓDIGO, TEAM_ID) Y NO EL CÓDIGO SOLO ───────────────────────
-- Esta es la decisión de la migración, y se equivoca fácil. El `codacta` identifica EL
-- PARTIDO EN LA FEDERACIÓN, no el evento en MisterFC. El día que se crucen dos equipos
-- del mismo club, ese partido único tiene que producir DOS eventos: uno en el calendario
-- de cada equipo, cada uno con su convocatoria, su asistencia y su acta en vivo.
--
-- Y no es una hipótesis de laboratorio: hoy el Fonteta tiene TRES equipos en «2ª Regional
-- Infantil» —15139 ('A'), 15140 ('B') y 900463025 ('C')—. Esta temporada han caído en
-- grupos distintos, pero nada lo garantiza en la siguiente. Con un único global el segundo
-- evento se rechazaría y un equipo se quedaría sin ese partido en su calendario, en
-- silencio, porque el importador vería una violación de unicidad donde hay un derbi.
--
-- ── EL CHECK DE TEAM_ID ES LO QUE HACE HERMÉTICO AL ÚNICO ───────────────────────────
-- `events.team_id` es NULLABLE (hay eventos de club y de categoría). En un índice único de
-- Postgres los NULL son DISTINTOS entre sí, así que dos eventos con el mismo `codacta` y
-- `team_id` NULL esquivarían el único los dos y el importador duplicaría exactamente lo
-- que esto viene a impedir. El CHECK `ffcv_match_code is null or team_id is not null` lo
-- cierra, y además dice una verdad del dominio: un partido del calendario federado es
-- siempre DE UN EQUIPO, nunca del club ni de una categoría.
--
-- ── POR QUÉ `ffcv_round` Y NO LA COLUMNA `round` QUE YA EXISTE ──────────────────────
-- Porque `round` está ocupada y tiene candado: `events_round_iff_tournament` exige
-- `(tournament_id is null) = (round is null)`, o sea que `round` sin `tournament_id` es un
-- CHECK violado. Un partido de liga NO es un partido de torneo —no hay evento cabecera de
-- 26 jornadas, y `tournament_id` tiene su propia semántica de convocatoria única (F13B)—,
-- así que reutilizar `round` obligaría a inventarse un torneo falso por liga. `ffcv_round`
-- es la jornada tal y como la llama la federación, y vive al lado del acta porque viaja
-- con ella: el endpoint de partidos es por grupo Y JORNADA, no existe la una sin la otra.
--
-- La dependencia se declara en UN solo sentido —`ffcv_round` exige `ffcv_match_code`, no al
-- revés— a propósito: una jornada sin acta no significa nada, pero un acta sin jornada es
-- imaginable el día que entre una eliminatoria de copa sin numerar. Un bicondicional, como
-- el de `round`, lo bloquearía sin necesidad.
--
-- ── LO QUE NO SE RESTRINGE, Y ES DELIBERADO ─────────────────────────────────────────
-- No se exige `type = 'match'`. La federación organiza también Copa Federación y fases
-- autonómicas, y el día que entren puede que encajen mejor como 'friendly' o dentro de un
-- torneo de verdad. Atar el tipo ahora sería adivinar; el CHECK que importa es el de
-- `team_id`, que es el que sostiene la unicidad.
--
-- Decisiones de Jose, 2026-10-12: el resultado NO entra (lo ponen los entrenadores desde
-- el directo, F-5 cancelada) y las sanciones tampoco (su endpoint devuelve nombre,
-- licencia y foto en base64 de menores de todos los clubes del grupo).
--
-- Suite: supabase/tests/eventos_idempotencia_ffcv.sql

alter table public.events
  add column ffcv_match_code text,
  add column ffcv_round       smallint;

alter table public.events
  add constraint events_ffcv_match_code_format check (
    ffcv_match_code is null or ffcv_match_code ~ '^[0-9]{1,20}$'
  ),
  add constraint events_ffcv_match_needs_team check (
    ffcv_match_code is null or team_id is not null
  ),
  add constraint events_ffcv_round_needs_code check (
    ffcv_round is null or ffcv_match_code is not null
  ),
  add constraint events_ffcv_round_positive check (
    ffcv_round is null or ffcv_round between 1 and 200
  );

create unique index events_ffcv_match_code_team_uniq
  on public.events (ffcv_match_code, team_id)
  where ffcv_match_code is not null;

comment on column public.events.ffcv_match_code is
  'Codigo de acta del partido en la FFCV (`codacta`, p.ej. 26539172 = jornada 1 del '
  'Infantil B). NULL = evento que no viene de la federacion. Es la clave de idempotencia '
  'del importador. Unico por (codigo, team_id) y NO por codigo solo: un codacta es UN '
  'partido de la federacion y puede tener que producir DOS eventos cuando se cruzan dos '
  'equipos del mismo club. El CHECK events_ffcv_match_needs_team es lo que hace hermetico '
  'ese unico, porque los NULL de team_id serian distintos entre si y lo esquivarian.';
comment on column public.events.ffcv_round is
  'Jornada de la FFCV (1..26 en liga). NO se usa la columna `round`, que esta atada a '
  'tournament_id por events_round_iff_tournament y un partido de liga no es un partido de '
  'torneo. Exige ffcv_match_code, pero no al contrario: un acta sin jornada numerada es '
  'imaginable en una eliminatoria de copa.';
