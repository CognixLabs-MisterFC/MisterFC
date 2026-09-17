-- MN-9 — El estado de la cuenta propia del jugador, para que la tarjeta deje de
-- ofrecer lo que ya está hecho.
--
-- EL FALLO. Después de que el hijo ya entra con su cuenta, la pantalla del tutor
-- sigue ofreciendo «dar acceso al jugador». El gate de la interfaz mira la relación
-- de QUIEN MIRA (`activePlayer.relation !== 'self'`), y la del tutor es 'parent'
-- para siempre, así que la tarjeta no se va nunca. La RPC sí lo sabe —responde
-- `already_linked`—, pero solo cuando ya se ha pulsado: botón muerto.
--
-- POR QUÉ HACE FALTA SQL Y NO BASTA CON ARREGLAR LA CONDICIÓN. El tutor NO PUEDE
-- saberlo desde el cliente. Medido en producción con su sesión, sobre el jugador
-- que ya tiene cuenta propia:
--
--   select ... from player_accounts where player_id = <hijo>
--   → 4725dba4:parent          (solo la suya)
--
-- La fila 'self' del menor se la oculta `player_accounts_select_self_or_staff`, que
-- solo deja ver la propia fila o las del staff del club. Y así debe seguir: el tutor
-- no tiene por qué ver el perfil que hay detrás de la cuenta de su hijo. De ahí una
-- función SECURITY DEFINER que devuelve EL ESTADO y nada más.
--
-- QUÉ DEVUELVE. Tres estados, y solo eso — nunca un profile_id, nunca un correo:
--   'none'    · no hay cuenta propia ni invitación viva  → se ofrece la tarjeta
--   'invited' · hay invitación enviada y aún viva        → «pendiente», sin volver a ofrecer
--   'linked'  · el jugador ya tiene su cuenta            → no se ofrece nada
--
-- LOS PREDICADOS SON LOS DE `invite_player_self`, LETRA POR LETRA. Es el punto del
-- arreglo: si el estado y la acción usaran predicados distintos, la tarjeta diría una
-- cosa y el botón haría otra. 'linked' es el mismo `exists` que levanta su
-- `already_linked`; «viva» es el mismo criterio (`accepted_at is null and
-- expires_at > now()`) que usa `player_email_relation_conflict` en su rama (B).
--
-- EL GATE ES `user_manages_player`, NO `user_is_tutor_of_player`. A propósito, y es
-- lo que permite que la interfaz tenga UNA sola regla en vez de dos:
--   · al TUTOR le contesta el estado real del hijo;
--   · al PROPIO JUGADOR (menor con cuenta, o adulto con la suya) le contesta
--     'linked' por construcción —si pregunta, es que su fila 'self' existe—, así que
--     la tarjeta le desaparece por la MISMA regla, sin comprobar la relación aparte.
-- Invitar sigue siendo solo del tutor: eso lo guarda `invite_player_self` con
-- `user_is_tutor_of_player`, que desde MN-1 ya no cuenta 'self'. Esto solo INFORMA.
--
-- LO QUE NO CIERRA, dicho aquí para que no se lea de más: 'none' no garantiza que
-- invitar vaya a salir bien. `invite_player_self` puede seguir negándose por
-- consentimientos de imagen de la temporada activa, temporada sin abrir, jugador
-- suprimido o dirección en conflicto (MN-4). Esos cuatro los sigue enseñando la
-- pantalla como error después de pulsar, igual que hasta ahora.

create or replace function public.player_self_account_status(p_player_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
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

  return 'none';
end;
$function$;

-- ACL. En Supabase los privilegios por defecto se conceden POR NOMBRE a anon y a
-- authenticated, así que revocar de PUBLIC no basta: hay que nombrarlos. Queda la
-- misma ACL que `invite_player_self` (postgres, authenticated, service_role), sin anon.
revoke all on function public.player_self_account_status(uuid) from public;
revoke all on function public.player_self_account_status(uuid) from anon;
revoke all on function public.player_self_account_status(uuid) from authenticated;
grant execute on function public.player_self_account_status(uuid) to authenticated;
grant execute on function public.player_self_account_status(uuid) to service_role;

comment on function public.player_self_account_status(uuid) is
  'MN-9. Estado de la cuenta propia de un jugador para la tarjeta del tutor: none | invited | linked. No revela quien esta detras de la cuenta. Gate user_manages_player; invitar sigue siendo solo del tutor (invite_player_self).';
