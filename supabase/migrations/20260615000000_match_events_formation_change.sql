-- F7.6b (arreglo final) — Cambio de táctica como match_event.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.6b ter.
--
-- El histórico de cambios de formación pasa a ser un match_event de tipo
-- 'formation_change' (metadata {from, to}, clock_seconds/period del reloj), para
-- que la FUENTE ÚNICA del log del partido sea match_events (no una columna
-- aparte que pueda divergir). Esto exige AMPLIAR el CHECK de match_events.type,
-- que en 7.1 no lo contemplaba (no se edita la migración 7.1: se recrea aquí el
-- constraint con DROP/ADD).
--
-- 'formation_change' es un evento de EQUIPO sin jugador: side='own',
-- player_id/related_player_id/rival_dorsal NULL, sin coordenadas. Encaja con el
-- resto de constraints existentes (actor_by_side, related_only_sub,
-- coords_field_only); solo había que ampliar el de type.
--
-- Además se RETIRA match_state.live_formation_log (añadida en 7.6b): queda
-- huérfana al mover el histórico a match_events. live_formation_code y
-- live_positions SIGUEN en uso (formación e posiciones vivas del campo).

alter table public.match_events
  drop constraint match_events_type_check;

alter table public.match_events
  add constraint match_events_type_check check (type in (
    'goal', 'assist', 'yellow_card', 'red_card',
    'substitution', 'corner', 'foul', 'offside', 'shot',
    'formation_change'));

alter table public.match_state
  drop column if exists live_formation_log;
