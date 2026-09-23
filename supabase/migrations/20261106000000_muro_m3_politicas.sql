-- MURO M-3 · el candado entra en las politicas. CON EL INTERRUPTOR APAGADO.
--
-- Entra el codigo, no el efecto: `subscription_wall.enabled` sigue en `false`, y con el
-- muro apagado `has_paid_access()` devuelve `true` SIEMPRE. Esta migracion, aplicada, no
-- cambia lo que ve nadie. Lo comprueba el pgTAP midiendo los MISMOS recuentos antes y
-- despues.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- COMO, y por que no reescribiendo las politicas que ya hay.
--
-- La forma obvia seria meter `and has_paid_access()` dentro de cada `using(...)`. Eso
-- obliga a copiar 23 expresiones a mano, algunas de seis lineas con subconsultas. Una
-- coma mal puesta ahi no da error: da una politica que deja ver de mas o de menos.
--
-- En su lugar se anade una politica RESTRICTIVE por tabla. Postgres las combina con AND
-- sobre las permisivas que ya existen, que es exactamente la semantica que hace falta:
--   · ninguna politica existente se toca — imposible mangonearlas;
--   · el diff es auditable de un vistazo: una linea igual por tabla;
--   · la marcha atras es `drop policy`, no reconstruir expresiones de memoria.
--
-- Solo `for select`. Lo que se pidio es que no se puedan LEER los datos saltandose la
-- app. Restringir tambien la escritura tocaria caminos que no he medido —consentimientos,
-- borrado de cuenta, aceptar invitaciones— y no es lo que hay que cerrar.
--
-- `to authenticated`: `service_role` y el dueno no pasan por RLS, y `anon` no llega.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- QUE NO SE CIERRA, y por que cada cosa.
--
--  · profiles, memberships, clubs, player_accounts, invitations — identidad y vinculo.
--    Sin ellas no hay ni pantalla de muro, ni consentimientos, ni borrado de cuenta.
--    Es lo mismo que decidio M-1 al no tocar `user_role_in_club`: cerrar por ahi cierra
--    tambien la salida.
--
--  · consents y legal_documents — decision de Jose, explicita.
--
--  · notifications — MEDIDO, y es una trampa: `notify_subscription_expiring` (SU-6)
--    escribe ahi el aviso `subscription_expiring`. Cerrar esa tabla esconderia
--    precisamente el aviso que le pide a la familia que pague, y una vez vencida no lo
--    veria nunca. Se queda abierta.
--
--  · seasons, categories, teams — estructura. El armazon de la app las necesita para
--    pintar cualquier cosa, incluido el muro.
--
--  · substitution_regimes — catalogo global: lo lee hasta un perfil sin club. No es
--    producto de nadie.
--
--  · expo_push_tokens — registro de push del propio dispositivo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA UNICA DECISION DE PRODUCTO QUE HE TOMADO AQUI, dicha en alto: `players`.
--
-- Una familia sin pagar ve hoy los 45 jugadores del club con nombre y fecha de
-- nacimiento. Eso es plantilla, es producto. Pero cerrar `players` a secas romperia los
-- consentimientos y el borrado, que necesitan saber quienes son TUS hijos.
--
-- Asi que esta tabla —y solo esta— lleva un escape: `has_paid_access() OR
-- user_manages_player(id)`. Sin pagar sigues viendo a los tuyos y dejas de ver a los
-- otros 44. Se usa `user_manages_player` y no `user_is_tutor_of_player` porque el
-- segundo excluye 'self' (MN-1): un chaval con su propia cuenta perderia su ficha.
--
-- Si Jose prefiere que la plantilla se vea sin pagar, esto se deshace con un
-- `drop policy muro_pago_select on public.players;` y nada mas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0 · El agujero de la vista ───────────────────────────────────────────────
--
-- `players_sporting` es la UNICA vista del esquema (barrido completo) y corre SIN
-- `security_invoker`, o sea con los privilegios de su duena: se salta la RLS de
-- `players`. Con `players` cerrada y la vista como estaba, la vista seria la puerta de
-- atras — expone dorsal, posicion y pie de los 45.
--
-- Se pone en `security_invoker`. No se recrea: `pg_get_viewdef` no arrastra las
-- opciones y recrear vistas es como se pierden. `alter view ... set` las conserva, y
-- aqui ademas no habia ninguna (`reloptions` nulo, comprobado).
--
-- Con el muro apagado esto NO cambia lo que se ve: la vista ya filtra por
-- `user_role_in_club`, que es el mismo predicado que la policy de `players`. El pgTAP
-- lo mide: mismas 45 filas antes y despues.
alter view public.players_sporting set (security_invoker = true);

-- ── 1 · El candado, tabla a tabla ────────────────────────────────────────────

-- Calendario y partido
create policy muro_pago_select on public.events
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.match_state
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.match_events
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.match_periods
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.match_starters
  as restrictive for select to authenticated using (public.has_paid_access());

-- Convocatorias
create policy muro_pago_select on public.callup_decisions
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.match_callup_meta
  as restrictive for select to authenticated using (public.has_paid_access());

-- Alineaciones
create policy muro_pago_select on public.lineups
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.lineup_positions
  as restrictive for select to authenticated using (public.has_paid_access());

-- Plantilla y cuerpo tecnico
create policy muro_pago_select on public.team_members
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.team_staff
  as restrictive for select to authenticated using (public.has_paid_access());

-- Comunicacion
create policy muro_pago_select on public.conversations
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.messages
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.announcements
  as restrictive for select to authenticated using (public.has_paid_access());

-- Seguimiento deportivo
create policy muro_pago_select on public.assessment_campaigns
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.development_reports
  as restrictive for select to authenticated using (public.has_paid_access());
create policy muro_pago_select on public.team_development_reports
  as restrictive for select to authenticated using (public.has_paid_access());

-- La excepcion con escape, explicada arriba.
create policy muro_pago_select on public.players
  as restrictive for select to authenticated
  using (public.has_paid_access() or public.user_manages_player(id));
