-- F7.7c — Penaltis (evento + tanda) y marcador.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.7c.
--
-- Se AMPLÍA el CHECK de match_events.type con dos tipos nuevos (no se editan
-- migraciones aplicadas: se recrea el constraint con DROP/ADD, mismo patrón que
-- 20260615000000_match_events_formation_change.sql):
--
--   'penalty'           — penalti DURANTE el partido (sobre jugador propio o
--                         rival por dorsal). metadata { outcome: 'scored' |
--                         'saved' | 'missed' }. Un 'penalty' con outcome='scored'
--                         CUENTA como gol de su bando en el marcador y en las
--                         stats del jugador (no se registra un 'goal' aparte).
--   'shootout_penalty'  — lanzamiento de la TANDA de penaltis (desempate tras la
--                         prórroga). metadata { outcome: 'scored' | 'missed' }.
--                         NO suma minutos ni cuenta como gol del partido: la
--                         tanda es aparte (su marcador se deriva por separado).
--
-- Ambos encajan con el resto de constraints existentes (actor_by_side: own →
-- player_id, rival → rival_dorsal; related_only_sub; coords_field_only): solo
-- había que ampliar el de type.

alter table public.match_events
  drop constraint match_events_type_check;

alter table public.match_events
  add constraint match_events_type_check check (type in (
    'goal', 'assist', 'yellow_card', 'red_card',
    'substitution', 'corner', 'foul', 'offside', 'shot',
    'formation_change',
    'penalty', 'shootout_penalty'));
