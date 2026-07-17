-- F15-C0 — FIX DE SEGURIDAD: consentimientos forjables (RGPD art. 9, menores).
--
-- Bug (destapado en el alcance de F15-C1, demostrado en prod con ROLLBACK):
-- la policy de INSERT de consents solo validaba `tutor_profile_id = auth.uid()`,
-- NO que auth.uid() sea tutor DEL player_id. Y user_has_medical_consent_read
-- toma el ÚLTIMO consentimiento del jugador sin mirar quién lo otorgó.
-- Composición: un staff del equipo del menor (que ya pasa
-- user_can_access_player_medical) podía FORJAR su propio consentimiento médico
-- sobre ese menor e ir por get_player_medical a leer alergias/medicación/
-- condiciones que el tutor nunca autorizó — o que RETIRÓ (forjar re-expone lo
-- retirado). La misma raíz permitía forjar image_internal y re-exponer una foto
-- retirada (player_photo_visible es latest-wins global igual).
--
-- FIX (raíz, no síntomas): exigir en el WITH CHECK que, si el consentimiento va
-- sobre un jugador, el que inserta sea TUTOR de ESE jugador. Reutiliza el helper
-- existente user_is_tutor_of_player (el mismo que gatea set_player_medical).
--   · player_id IS NULL  = consentimiento de CUENTA (terms/privacy sobre uno
--     mismo) → sigue permitido; no va sobre ningún menor.
--   · player_id NOT NULL = exige ser tutor (player_accounts relation
--     parent/guardian) de ese jugador.
--
-- Ámbito: SOLO se recrea consents_insert_own desde su definición VIVA. NO se
-- tocan consents_select_own, consents_select_platform, ni los triggers
-- append-only (consents_block_update/delete). NO se toca
-- user_has_medical_consent_read ni ningún gate de médica: el fix ataca el forjado
-- (la raíz), no la lectura (el síntoma).
--
-- Inserts LEGÍTIMOS: NO pasan por esta policy. accept_pending_invitations y
-- record_season_reconsent son SECURITY DEFINER, propiedad de postgres, y consents
-- no tiene FORCE ROW LEVEL SECURITY → corren como owner y bypassan la RLS. El
-- único acceso del cliente a consents es un SELECT (invite/.../consent-data.ts).
-- Además, en accept_pending_invitations el vínculo player_accounts se crea ANTES
-- del INSERT del consentimiento del hijo, así que user_is_tutor_of_player ya sería
-- true aunque la policy aplicara (que no aplica).
--
-- Sin CHECK constraint: el WITH CHECK de una policy solo aplica a INSERTs nuevos;
-- las filas existentes NO se re-validan (prod: 1 player_medical, 0 consents
-- médicos; nada que invalidar).

drop policy consents_insert_own on public.consents;

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (
    tutor_profile_id = auth.uid()
    and (
      player_id is null
      or public.user_is_tutor_of_player(player_id)
    )
  );
