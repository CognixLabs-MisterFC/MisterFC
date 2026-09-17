-- ════════════════════════════════════════════════════════════════════════════
-- RV-1 · RETIRAR un consentimiento.
--
-- El ledger se diseñó para esto desde el primer día. Su propio comment lo dice:
--
--     «Retirar = insertar fila nueva con granted=false; NUNCA UPDATE/DELETE
--      (trigger lo bloquea, incluso service_role).»
--
-- Y #548 arregló el desempate por `seq` precisamente porque, con una concesión y una
-- revocación selladas en la misma transacción, el sistema podía responder
-- `granted = true` DESPUÉS de que la persona hubiera revocado. Ese arreglo solo tiene
-- sentido si las revocaciones existen. Nunca llegaron a tener puerta: hasta hoy las
-- ÚNICAS dos funciones que escriben en `consents` son `accept_pending_invitations` (el
-- alta) y `record_season_reconsent` (el formulario anual). Esta es la tercera.
--
-- ── POR QUÉ UNA RPC SI LA POLICY YA LO PERMITE ──────────────────────────────
-- `consents_insert_own` ya deja a un tutor insertar sus propias filas
-- (`tutor_profile_id = auth.uid() AND (player_id IS NULL OR
-- user_manages_player_sensitive(player_id))`). O sea que la AUTORIZACIÓN no es lo que
-- falta, y esta función no la inventa: la vuelve a comprobar y ya está.
--
-- Lo que falta es SELLAR LA FILA BIEN, y eso el cliente no puede hacerlo:
--
--   · `season_id` es NOT NULL, y NO todos los lectores lo miran igual. Inventario de
--     la base VIVA (`pg_get_functiondef`, no las migraciones — hay filtros de
--     temporada en migraciones viejas que después se sustituyeron):
--
--         sin temporada (latest-wins global) ...  get_tutor_consents
--                                                 player_photo_visible
--                                                 user_has_medical_consent_READ
--         con temporada activa ................   user_has_medical_consent_WRITE
--                                                 tutor_needs_reconsent
--                                                 player_self_invite_blocker
--
--     Sellar con otra temporada deja la retirada MEDIO INVISIBLE, y del lado peor:
--     medido contra producción dentro de un BEGIN…ROLLBACK, `_read` baja a false
--     (no mira la temporada) pero **`_write` se queda en true**. O sea que el dato
--     se esconde y, aun así, el club puede SEGUIR ESCRIBIENDO la ficha médica de un
--     menor cuya familia acaba de retirar el consentimiento. No da ningún error.
--     Tiene control negativo propio en el pgTAP, y por eso [2] comprueba las DOS.
--   · `legal_document_id` es NOT NULL con FK a `legal_documents`, y la fila de la
--     retirada tiene que apuntar AL MISMO TEXTO que se consintió: el ledger es prueba
--     de qué se retiró, no solo de que se retiró algo.
--   · la regla de qué se puede retirar y la idempotencia no se pueden imponer desde
--     el cliente.
--
-- ── LO QUE NO SE PUEDE RETIRAR, Y POR QUÉ ───────────────────────────────────
-- `terms_conditions` y `privacy_policy` fallan con `not_revocable`. Retirarlos no es
-- revocar un tratamiento: es dejar de poder usar la plataforma, y para eso ya existe
-- el borrado de cuenta (serie BC). Una fila `granted=false` sobre ellos no cerraría
-- nada —`tutor_needs_reconsent` resuelve con `exists(... granted ...)`— y dejaría en
-- el ledger una retirada que no retira. Quedan los TRES opcionales:
-- `image_internal`, `image_social` y `medical_data_processing`.
--
-- ── EL ESTADO VIGENTE SE RESUELVE COMO LO PINTA LA PANTALLA ─────────────────
-- Mismo criterio, literalmente, que `get_tutor_consents`: última fila por
-- (tutor, jugador, tipo) con `order by accepted_at desc, seq desc`, SIN filtrar por
-- temporada. Tenía que ser el mismo o no cuadraría: la persona pulsa sobre una fila
-- que está viendo, y si la función mirase otra cosa recibiría un error sobre algo que
-- no tiene delante.
--
-- Nótese la asimetría, que es deliberada: se LEE sin temporada (lo que la pantalla
-- enseña) y se ESCRIBE con la temporada activa (lo que los lectores consultan). Un
-- consentimiento concedido en una temporada anterior se puede retirar hoy, y la
-- retirada se sella donde surte efecto.
--
-- ── QUÉ PASA AL RETIRAR, MEDIDO ─────────────────────────────────────────────
--   · `image_internal` → `player_photo_visible` devuelve false al instante, y esa
--     función GATEA LA RLS DE STORAGE (`player_photos_select_member`). La foto deja
--     de poder leerse del bucket. No es cosa de la interfaz: lo hace la base.
--   · `medical_data_processing` → `user_has_medical_consent_read` devuelve false (por
--     latest-wins) y `user_has_medical_consent_write` también, porque la fila se sella
--     en la temporada activa. El dato deja de verse y de poder escribirse; no se borra.
--   · `image_social` → NO tiene ningún lector automático. Queda registrado y se ve en
--     pantalla, pero no apaga nada por sí solo, porque no hay nada automatizado que
--     publique en redes: lo hace una persona. El texto legal de W-C lo dice con esas
--     palabras y no promete un efecto técnico que no existe.
--
-- Nada de esto BORRA lo ya tratado, y así debe ser: la retirada no afecta a la
-- licitud de lo anterior (art. 7.3 RGPD).
--
-- SIN `commit`: las migraciones de este repo no lo llevan.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.revoke_player_consent(
  p_player_id    uuid,
  p_consent_type public.consent_type,
  p_ip           text default null,
  p_user_agent   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tutor   uuid := auth.uid();
  v_club    uuid;
  v_season  uuid;
  v_granted boolean;
  v_doc_id  uuid;
  v_doc_ver integer;
begin
  if v_tutor is null then
    raise exception 'no_session' using errcode = '42501';
  end if;

  -- Antes que el gate: es una regla del producto, no de autorización, y su mensaje
  -- debe ser el mismo para quien tiene permiso y para quien no.
  if p_consent_type in ('terms_conditions', 'privacy_policy') then
    raise exception 'not_revocable' using errcode = '22023';
  end if;

  if p_player_id is null or not public.user_manages_player_sensitive(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Estado vigente, EXACTAMENTE como lo resuelve `get_tutor_consents`.
  select c.granted, c.legal_document_id, c.legal_document_version
    into v_granted, v_doc_id, v_doc_ver
  from public.consents c
  where c.tutor_profile_id = v_tutor
    and c.player_id = p_player_id
    and c.consent_type = p_consent_type
  order by c.accepted_at desc, c.seq desc
  limit 1;

  -- Sin fila previa no hay nada que retirar. NO se inventa una: una retirada sin
  -- concesión no es prueba de nada, y además no sabríamos a qué texto apuntar.
  if v_doc_id is null then
    raise exception 'nothing_to_revoke' using errcode = '22023';
  end if;

  -- Idempotente. Un ledger append-only no necesita tres filas diciendo lo mismo, y
  -- un doble toque en un móvil con mala red es lo más normal del mundo.
  if v_granted is false then
    return;
  end if;

  select p.club_id into v_club from public.players p where p.id = p_player_id;
  v_season := public.active_season_id(v_club);

  -- Sin temporada activa la fila no se puede sellar donde surte efecto sobre
  -- `user_has_medical_consent_write`. Fallar es mejor que escribir una retirada a
  -- medias, que es la que esconde el dato pero deja al club seguir escribiéndolo.
  if v_season is null then
    raise exception 'no_active_season' using errcode = '22023';
  end if;

  insert into public.consents (
    tutor_profile_id, player_id, consent_type, granted,
    legal_document_id, legal_document_version, season_id, ip, user_agent
  )
  values (
    v_tutor, p_player_id, p_consent_type, false,
    v_doc_id, v_doc_ver, v_season,
    nullif(p_ip, '')::inet, nullif(p_user_agent, '')
  );
end;
$$;

-- Privilegios: el patrón de la migración 20261075000000. Nombrar `anon`
-- EXPLÍCITAMENTE — un `revoke ... from public` a secas NO le cierra, porque el
-- default privilege de Supabase le concede EXECUTE por su nombre y esa concesión es
-- otra entrada de la ACL que el revoke a PUBLIC no toca.
revoke all on function public.revoke_player_consent(uuid, public.consent_type, text, text) from public;
revoke all on function public.revoke_player_consent(uuid, public.consent_type, text, text) from anon;
grant execute on function public.revoke_player_consent(uuid, public.consent_type, text, text) to authenticated;
grant execute on function public.revoke_player_consent(uuid, public.consent_type, text, text) to service_role;

comment on function public.revoke_player_consent(uuid, public.consent_type, text, text) is
  'RV-1 — retira un consentimiento OPCIONAL (imagen interna, imagen en redes, datos de salud) insertando una fila granted=false. Lee el estado vigente como get_tutor_consents (sin temporada) y sella la retirada con la temporada ACTIVA, que es la que mira user_has_medical_consent_WRITE (el _read es latest-wins global). Idempotente. terms_conditions y privacy_policy no se retiran aquí: eso es el borrado de cuenta.';
