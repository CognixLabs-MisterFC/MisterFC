-- ─────────────────────────────────────────────────────────────────────────────
-- F14E-6 (Opción A) — RLS "compañero de equipo" en match_player_stats.
--
-- Hoy un jugador solo lee SUS propias stats (match_player_stats_select_player =
-- user_is_account_of_player). Para la pantalla "Plantilla" del jugador (roster de
-- su equipo con stats de cada compañero) necesita leer las stats de los players
-- de UN equipo del que él también es miembro.
--
-- Se AÑADE una policy SELECT ADITIVA (se combina por OR con las existentes). Usa
-- PERTENENCIA DE EQUIPO (user_is_team_member_account sobre team_members +
-- player_accounts), NO el rol de club (patrón roto conocido). El gate es el
-- team_id de la fila: si el jugador es cuenta de un miembro activo de ese equipo,
-- puede leer las stats del equipo.
--
-- NO se toca ninguna policy existente:
--   · match_player_stats_select          (staff: user_can_record_match)
--   · match_player_stats_select_player   (jugador/familia: sus propias stats)
--   · match_player_stats_select_spectator(seguidor del club)
-- ni las de INSERT/UPDATE/DELETE. Solo se crea la nueva.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists match_player_stats_select_teammate on public.match_player_stats;
create policy match_player_stats_select_teammate on public.match_player_stats
  for select to authenticated
  using (public.user_is_team_member_account(team_id));

comment on policy match_player_stats_select_teammate on public.match_player_stats is
  'F14E-6 — un jugador (cuenta) lee las stats de match de un equipo del que es '
  'miembro activo (user_is_team_member_account sobre team_id). Habilita la '
  'plantilla deportiva del jugador con stats de sus compañeros. ADITIVA: se combina '
  'por OR con las policies de staff, propio-jugador y seguidor (todas intactas).';
