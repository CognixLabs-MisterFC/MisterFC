-- F9.5 — Vista jugador/familia del expediente: lectura de SUS estadísticas.
--
-- Contexto (🔒 D9-1, spec 9.0 §10): las estadísticas OBJETIVAS del propio jugador
-- (minutos, goles, asistencias, tarjetas, faltas, penaltis) son SIEMPRE visibles a
-- él y a su familia — NO dependen del flag de visibilidad del club
-- (`club_settings.evaluations_player_visibility`), que gobierna solo las
-- valoraciones SUBJETIVAS (eso ya lo enforca la RLS de F8 en `evaluations` /
-- `team_evaluations`).
--
-- Hoy `match_player_stats` solo lo lee el staff (policy `match_player_stats_select`
-- por `user_can_record_match(event_id)`, migración 20260618000000). Añadimos UNA
-- policy SELECT nueva, player-scoped, SIN el flag. Es una *policy*, no una tabla
-- (D9-B). Las policies permisivas para el mismo comando se combinan con OR, así que
-- el staff sigue leyendo por la suya y el jugador/familia lee la suya:
--
--   using (public.user_is_account_of_player(player_id))   -- self / padre / tutor de ESE jugador (F8.1)
--
-- No se tocan las policies de staff (select/insert/update/delete) ni el resto de F7.

create policy match_player_stats_select_player on public.match_player_stats
  for select to authenticated
  using (public.user_is_account_of_player(player_id));

comment on policy match_player_stats_select_player on public.match_player_stats is
  'F9.5 (🔒 D9-1) — el jugador y su familia leen SUS estadísticas de partido siempre, sin depender del flag de visibilidad del club. Player-scoped vía user_is_account_of_player; se combina por OR con la policy de staff match_player_stats_select.';
