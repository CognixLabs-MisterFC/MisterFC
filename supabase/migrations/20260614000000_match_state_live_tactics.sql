-- F7.6b — Táctica en directo: mover jugadores + cambiar formación.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.6b.
--
-- El estado táctico VIVO (formación actual + posiciones por jugador en el campo)
-- se persiste para que sobreviva a una recarga (F5), SIN tocar el once inicial
-- (match_starters, quién empezó) ni la alineación oficial de F6. Cuelga de la
-- cabecera de sesión match_state (1:1 con el partido):
--
--   - live_formation_code: formación en juego ahora (null → la oficial de F6).
--   - live_positions: { <player_id>: { position_code, x_pct, y_pct } } con las
--       posiciones movidas / recolocadas (override sobre el slot oficial). Solo
--       aplica a quien esté en el campo; el motor puro deriveSquad sigue
--       decidiendo QUIÉN está en el campo (subs/expulsiones/ausencias).
--   - live_formation_log: marcador para la línea de tiempo (7.9) de cada cambio
--       de formación [{ code, clock_seconds, period }]. NO se construye la
--       timeline aquí; solo se deja el rastro.
--
-- Sin columnas nuevas en otras tablas, sin tocar triggers/RLS (las policies de
-- match_state ya cubren el UPDATE por user_can_record_match).

alter table public.match_state
  add column live_formation_code text,
  add column live_positions      jsonb not null default '{}'::jsonb,
  add column live_formation_log  jsonb not null default '[]'::jsonb;

comment on column public.match_state.live_formation_code is
  'F7.6b — formación EN JUEGO ahora (catálogo F6). null = la oficial de F6. No sobrescribe match_starters.';
comment on column public.match_state.live_positions is
  'F7.6b — posiciones vivas por jugador en el campo: { player_id: { position_code, x_pct, y_pct } }. Override sobre el slot oficial; deriveSquad decide quién está en campo.';
comment on column public.match_state.live_formation_log is
  'F7.6b — rastro de cambios de formación para la línea de tiempo (7.9): [{ code, clock_seconds, period }]. La timeline se construye en 7.9.';
