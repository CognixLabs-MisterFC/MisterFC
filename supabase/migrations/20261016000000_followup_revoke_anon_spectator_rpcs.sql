-- Follow-up de limpieza — retirar el EXECUTE heredado por `anon` en las 3 RPCs de
-- seguidores (F14C): invite_spectator / list_player_spectators / remove_spectator.
-- Es inocuo (anon entra con auth.uid() NULL → no_session/forbidden antes de leer
-- nada), pero sobra: estas RPCs son siempre para usuarios autenticados. No se toca
-- ni la lógica ni los gates internos; solo permisos. `authenticated` conserva
-- execute (grant idempotente para dejarlo explícito). `public` no las tenía
-- concedidas (proacl solo lista postgres/anon/authenticated/service_role).
--
-- Firmas exactas (def viva, pg_get_function_identity_arguments):
--   invite_spectator(p_player_id uuid, p_email text)
--   list_player_spectators(p_player_id uuid)
--   remove_spectator(p_player_id uuid, p_spectator_profile_id uuid)

revoke all on function public.invite_spectator(uuid, text) from anon;
revoke all on function public.list_player_spectators(uuid) from anon;
revoke all on function public.remove_spectator(uuid, uuid) from anon;

grant execute on function public.invite_spectator(uuid, text) to authenticated;
grant execute on function public.list_player_spectators(uuid) to authenticated;
grant execute on function public.remove_spectator(uuid, uuid) to authenticated;
