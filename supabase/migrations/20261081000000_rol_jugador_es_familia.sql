-- `memberships.role = 'jugador'` no quiere decir jugador. Quiere decir FAMILIA.
--
-- Esta migración no cambia ni un dato ni un permiso: solo escribe en el esquema lo
-- que el modelo ya hace, porque el nombre de ese valor lleva engañando desde el
-- principio y el sitio donde hay que enterarse es la tabla.
--
-- ── QUÉ SE MIDIÓ ────────────────────────────────────────────────────────────
--
-- El CHECK de `memberships.role` no contempla ningún rol de familia:
--
--     admin_club · director · coordinador · entrenador_principal ·
--     entrenador_ayudante · jugador
--
-- Así que un tutor entra con el rol del hijo. En producción, de las 7 memberships
-- con `role='jugador'`, **5 son tutores** (`player_accounts.relation` parent) y
-- **2 son el propio menor** (relation self). Ni un seguidor, ni una sin vínculo.
--
-- ── Y POR QUÉ NO ES UN FALLO ────────────────────────────────────────────────
--
-- Porque la relación real NO vive aquí: vive en `player_accounts.relation`
-- (self · parent · guardian), y todo lo que distingue a un tutor de su hijo la mira
-- a ella, no al rol. `user_manages_player_sensitive`, `user_is_player_self` y la
-- serie MN entera se apoyan en `relation`.
--
-- El rol solo responde a otra pregunta: **¿esta persona es cuerpo técnico?**
-- Y para eso el valor es correcto, revisado uno a uno los objetos que lo nombran:
--
--   · `requires_subscription` — lo usa como «familia, luego paga», en un OR junto a
--     player_accounts, player_spectators y team_follows. Un tutor ya entra por el
--     primero; este valor es la red para el familiar sin vínculo.
--   · `platform_club_breakdown` — le da tier 8, que NO cuenta en ningún cubo de
--     cuerpo técnico. Los jugadores los cuenta de `players` + `team_members`, y los
--     familiares de `player_accounts`. Las métricas no mienten.
--   · `accept_pending_invitations` — copia `invitations.role`, y el CHECK
--     `invitations_player_role_consistency` es quien ata role='jugador' con
--     `player_id` + `player_relation`. Ahí sí está la relación.
--   · `player_accounts_insert_invitee`, `admin_update_staff_role`,
--     `invite_player_self`, `player_self_account_status` — lo tratan como el tipo de
--     invitación de familia, nunca como «es un jugador».
--
-- ── POR QUÉ NO SE RENOMBRA ──────────────────────────────────────────────────
--
-- Porque sería un cambio de modelo, no un arreglo: **39 ficheros** de `apps/` y
-- `packages/` y **103** de `supabase/` nombran ese valor, y con él viajan el CHECK de
-- `invitations`, el reparto de `accept_pending_invitations`, el predicado de
-- suscripción de SU-2 y el del corte de la web de W-A. Se cambiaría un nombre malo
-- por un riesgo grande, sin arreglar ni un permiso.
--
-- La decisión, entonces, es dejarlo y que deje de sorprender a quien lo lea.

-- El comentario de la columna YA decia lo esencial desde F1B ("familia" no es un rol).
-- Se conserva entero -incluida la parte de director- y se le anade lo que le faltaba:
-- la medida, y que no renombrarlo es una decision, no un olvido.
comment on column public.memberships.role is
  '6 roles. "director" (F1B) = mismo alcance que admin_club en datos (cableado en F1B-1); NO puede administrar otros directores/admins (F1B-2). "familia" no es un rol: cuenta familia = profile con rol "jugador" vinculado via player_accounts. OJO con eso: "jugador" significa FAMILIA -el tutor o el propio jugador con cuenta-, NO "es un jugador". La relacion real vive en player_accounts.relation (self/parent/guardian) y es la que miran user_manages_player_sensitive, user_is_player_self y la serie MN. Medido 2026-09-17: de 7 memberships con "jugador", 5 eran tutores y 2 el propio menor. No se renombra a proposito: ver la migracion 20261081.';

comment on constraint memberships_role_check on public.memberships is
  'Los seis roles de CLUB. No hay ninguno de familia y no es un olvido: la familia entra con ''jugador'' y su relacion con el jugador la guarda player_accounts.relation. Ver el comentario de la columna.';
