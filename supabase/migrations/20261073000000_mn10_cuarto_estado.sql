-- MN-10 — el cuarto estado: que el botón no aparezca si va a fallar.
--
-- MN-9 quitó el botón muerto de «ya tiene cuenta». Quedaban CUATRO motivos más por
-- los que `invite_player_self` puede negarse con el tutor delante, y la tarjeta no
-- los miraba: jugador suprimido, temporada sin abrir, decisiones de imagen sin
-- responder, y el correo en conflicto de MN-4.
--
-- TRES SE PUEDEN SABER ANTES. EL CUARTO NO, Y NO ES PEREZA: `email_relation_conflict`
-- se mide CONTRA UNA DIRECCIÓN —la que el tutor todavía no ha escrito cuando se pinta
-- la tarjeta—, así que no existe un valor que calcular a priori. Ese se queda donde
-- está: como error bajo el campo, que es donde el tutor lo puede corregir, con la
-- ayuda que MN-5 ya puso encima del cuadro de texto. Los otros tres suben a la
-- tarjeta, y con su motivo, no con un «no se puede» a secas.
--
-- EL PREDICADO NO SE ESCRIBE DOS VECES. Es la regla de MN-9, y aquí obliga a tocar
-- `invite_player_self`: el bloque de temporada + consentimientos SALE de ella y pasa a
-- `player_self_invite_blocker`, que es lo que consulta también la tarjeta. Copiarlo
-- habría sido más barato hoy y habría acabado igual que el predicado duplicado de
-- `preview_account_deletion`: la pantalla y la acción diciendo cosas distintas.
--
-- EL ORDEN DE `invite_player_self` NO SE MUEVE. El cuerpo va reconstruido sobre la
-- definición VIVA (`pg_get_functiondef`), con un solo cambio: donde comprobaba
-- temporada y consentimientos, ahora llama al bloqueador. Se llama EN ESE MISMO
-- PUNTO a propósito: adelantarlo cambiaría qué error reporta la función cuando
-- concurren varios, y hay pruebas de MN-2 y MN-4 que fijan ese orden.
--
-- `erased` SÍ entra en el bloqueador aunque `invite_player_self` lo siga mirando
-- antes por su cuenta: esa comprobación lee `erased_at` del mismo SELECT que ya hace
-- para `club_id`, y las dos leen la misma columna. No hay predicado que derive.

-- ── 1 · El bloqueador compartido ────────────────────────────────────────────
--
-- Devuelve el PRIMER motivo por el que invitar fallaría, o null si no hay ninguno.
-- Texto, no booleano, porque la tarjeta tiene que decir POR QUÉ: al tutor al que le
-- falta el consentimiento de imagen hay que decirle eso, no «no se puede».

create or replace function public.player_self_invite_blocker(p_player_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_club   uuid;
  v_erased timestamptz;
  v_season uuid;
begin
  select p.club_id, p.erased_at into v_club, v_erased
    from public.players p where p.id = p_player_id;

  -- Sin jugador no hay nada que medir. Quien puede preguntar ya pasó su gate.
  if v_club is null then
    return 'forbidden';
  end if;

  if v_erased is not null then
    return 'erased';
  end if;

  -- Temporada activa: es con la que sella el alta, así que es contra la que se mide.
  v_season := public.active_season_id(v_club);
  if v_season is null then
    return 'no_active_season';
  end if;

  -- LA PRECONDICIÓN. Decisión de imagen en regla, las dos, en la temporada activa.
  --
  -- Se comprueba EXISTENCIA, no el valor vigente, y a propósito: `consents` es un ledger
  -- al que solo se añade, así que una fila en esta temporada significa que la decisión se
  -- tomó. Vale `granted = true` y vale `false` — es una decisión, no un permiso. Por eso
  -- aquí NO hace falta el desempate por `accepted_at`/`seq` (#548): ese hace falta para
  -- saber CUÁL es la decisión vigente, y aquí solo importa que la haya.
  if not exists (
    select 1 from public.consents c
     where c.player_id = p_player_id
       and c.consent_type = 'image_internal'
       and c.season_id = v_season
  ) or not exists (
    select 1 from public.consents c
     where c.player_id = p_player_id
       and c.consent_type = 'image_social'
       and c.season_id = v_season
  ) then
    return 'consents_required';
  end if;

  return null;
end;
$function$;

revoke all on function public.player_self_invite_blocker(uuid) from public;
revoke all on function public.player_self_invite_blocker(uuid) from anon;
revoke all on function public.player_self_invite_blocker(uuid) from authenticated;
grant execute on function public.player_self_invite_blocker(uuid) to service_role;

comment on function public.player_self_invite_blocker(uuid) is
  'MN-10. Primer motivo por el que invite_player_self se negaria con el tutor delante (erased | no_active_season | consents_required), o null. Interno: lo consultan invite_player_self y player_self_account_status, no el cliente.';

-- ── 2 · `invite_player_self`, reconstruida sobre la definición viva ─────────
--
-- Un solo cambio respecto de lo que hay aplicado: el bloque de temporada +
-- consentimientos pasa a ser la llamada al bloqueador, en su mismo sitio.

CREATE OR REPLACE FUNCTION public.invite_player_self(p_player_id uuid, p_email text)
 RETURNS TABLE(id uuid, token uuid, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_email  text := lower(btrim(p_email));
  v_erased timestamptz;
  v_block  text;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate: SOLO el tutor (parent/guardian). Ni el club, ni el propio jugador — un menor
  -- no se invita a sí mismo, y ese es justo el sentido de MN-1: aquí `user_is_tutor_of_player`
  -- ya NO incluye 'self'.
  if not public.user_is_tutor_of_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  select p.club_id, p.erased_at into v_club, v_erased
    from public.players p where p.id = p_player_id;
  if v_club is null then
    raise exception 'forbidden';
  end if;
  if v_erased is not null then
    raise exception 'erased';
  end if;

  -- Un jugador tiene UNA cuenta propia. `player_accounts` tiene PK (player_id, profile_id),
  -- así que sin esto dos perfiles distintos podrían ser 'self' del mismo jugador.
  if exists (
    select 1 from public.player_accounts pa
    where pa.player_id = p_player_id and pa.relation = 'self'
  ) then
    raise exception 'already_linked';
  end if;

  -- MN-4 — el correo de un TUTOR del jugador no puede recibir la invitación de cuenta
  -- propia: sería el tutor haciéndose hijo de sí mismo. El predicado ya no se escribe
  -- aquí; vive en `player_email_relation_conflict`, que es también lo que aplica el
  -- trigger de `invitations`. Aquí se consulta ANTES para poder fallar con el tutor
  -- delante, en vez de reventar en el INSERT detrás de los gates que vienen después.
  if public.player_email_relation_conflict(p_player_id, v_email, 'self') then
    raise exception 'email_relation_conflict';
  end if;

  -- MN-10 — temporada activa y decisiones de imagen. El predicado ya NO se escribe
  -- aquí: vive en `player_self_invite_blocker`, que es lo que consulta también la
  -- tarjeta del tutor para no ofrecer un botón que iba a fallar. Mismo motivo que
  -- MN-4 con `player_email_relation_conflict`: un predicado en dos sitios acaba
  -- diciendo dos cosas. Se llama EN ESTE PUNTO, y no antes, para no mover el orden
  -- en que esta función reporta sus errores.
  v_block := public.player_self_invite_blocker(p_player_id);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  -- Reinvitable: supersede las invitaciones de cuenta propia PENDIENTES del mismo
  -- (jugador, email). Mismo criterio que `invite_spectator`.
  delete from public.invitations i
   where i.role = 'jugador'
     and i.player_relation = 'self'
     and i.player_id = p_player_id
     and lower(btrim(i.email)) = v_email
     and i.accepted_at is null;

  return query
  insert into public.invitations (email, club_id, role, player_id, player_relation, created_by)
  values (v_email, v_club, 'jugador', p_player_id, 'self', v_uid)
  returning invitations.id, invitations.token, invitations.email;
end;
$function$;

-- ── 3 · El estado de la tarjeta, ahora con el motivo ───────────────────────
--
-- Los tres estados de MN-9 más los tres motivos de bloqueo. El ORDEN de aquí NO es
-- el de `invite_player_self`, y es deliberado: son preguntas distintas. La RPC
-- responde «¿por qué no te dejo invitar?»; la tarjeta responde «¿qué le enseño al
-- tutor?». A un tutor cuyo hijo YA tiene cuenta no se le dice que falta abrir la
-- temporada: se le dice que ya la tiene. Por eso `linked` e `invited` van primero.

create or replace function public.player_self_account_status(p_player_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_block text;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Tutor del jugador, o el propio jugador. Un tercero —staff incluido— no pregunta
  -- por esto: la tarjeta es de la pantalla de la familia.
  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  -- 1 · YA TIENE CUENTA. Mismo `exists` que el `already_linked` de invite_player_self.
  --     Va PRIMERO: si por lo que sea coexistieran cuenta e invitación viva, la cuenta
  --     es el hecho consumado y es lo que la tarjeta tiene que decir.
  if exists (
    select 1
      from public.player_accounts pa
     where pa.player_id = p_player_id
       and pa.relation = 'self'
  ) then
    return 'linked';
  end if;

  -- 2 · INVITACIÓN VIVA: enviada, sin aceptar y sin caducar. Sin mirar la dirección,
  --     porque la pregunta es del jugador, no de un correo concreto; y una caducada
  --     no cuenta, que es justo lo que permite volver a invitar (MN-4 [4]).
  if exists (
    select 1
      from public.invitations i
     where i.player_id = p_player_id
       and i.role = 'jugador'
       and i.player_relation = 'self'
       and i.accepted_at is null
       and i.expires_at > now()
  ) then
    return 'invited';
  end if;

  -- 3 · MN-10 — lo que haría fallar al botón, con su motivo. Mismo predicado que
  --     ejecuta `invite_player_self`, porque es literalmente la misma función.
  v_block := public.player_self_invite_blocker(p_player_id);
  if v_block is not null then
    return v_block;
  end if;

  return 'none';
end;
$function$;

-- ACL sin cambios respecto de MN-9; se reafirma porque `create or replace` no la
-- toca pero un `drop` + `create` futuro sí la perdería, y en Supabase los privilegios
-- por defecto se conceden POR NOMBRE a anon y authenticated.
revoke all on function public.player_self_account_status(uuid) from public;
revoke all on function public.player_self_account_status(uuid) from anon;
revoke all on function public.player_self_account_status(uuid) from authenticated;
grant execute on function public.player_self_account_status(uuid) to authenticated;
grant execute on function public.player_self_account_status(uuid) to service_role;

comment on function public.player_self_account_status(uuid) is
  'MN-10. Estado de la cuenta propia de un jugador para la tarjeta del tutor: linked | invited | erased | no_active_season | consents_required | none. No revela quien esta detras de la cuenta. Gate user_manages_player; invitar sigue siendo solo del tutor (invite_player_self).';
