-- ════════════════════════════════════════════════════════════════════════════
-- El tutor puede RETIRAR la cuenta propia de su hijo, igual que puede creársela.
--
-- ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
-- Dos reglas de Jose, de la misma pieza:
--   (1) el tutor no puede borrar su cuenta mientras su hijo tenga cuenta propia;
--   (2) el tutor puede retirar la cuenta propia de su hijo. Hoy no puede nadie.
--
-- Esta es la (2), y va PRIMERA a propósito. BC-2 lo dejó escrito como decisión 1
-- de Jose: «nadie depende de un tercero para poder irse». Si el bloqueo llegara
-- antes que esta RPC, el tutor quedaría atrapado con la única llave en manos del
-- club — que es exactamente el suelo sobre el que se sostiene la serie BC entera
-- y el 5.1.1(v) de Apple. Con esto dentro, el bloqueo siempre lo resuelve él solo.
--
-- ── LO QUE HAY HOY, MEDIDO EN PRODUCCIÓN ────────────────────────────────────
-- Con la sesión real de un tutor, sobre el hijo que ya tiene cuenta:
--
--   lo que VE de player_accounts ....... solo su propia fila ('parent')
--   delete de la fila 'self' ........... 0 filas, SIN error
--   con la sesión del admin del club ... 1 fila
--
-- Las dos mitades importan. La fila se la oculta `player_accounts_select_self_or_staff`
-- y así debe seguir (MN-9: el tutor no tiene por qué ver el perfil que hay detrás de
-- la cuenta de su hijo). Y el borrado le sale MUDO: cero filas y ningún error, que es
-- la forma más cara de que algo no funcione. De ahí una RPC SECURITY DEFINER, y no
-- una policy nueva.
--
-- Y una corrección al enunciado de partida: hoy tampoco puede el CLUB desde la app.
-- La ficha del jugador lista las cuentas vinculadas y no ofrece ninguna acción para
-- quitarlas; el club solo puede por SQL. Esta migración no le añade ni le quita nada:
-- su vía sigue siendo la policy `player_accounts_write_admin`, intacta.
--
-- ── RETIRA LOS DOS ESTADOS, O SE REABRE SOLA ────────────────────────────────
-- MN-9 define tres: 'none', 'invited' y 'linked'. Si «retirar» cubriera solo la
-- cuenta ya creada, el tutor retiraría hoy y el crío entraría mañana con el enlace
-- que sigue vivo. Así que se retiran los dos, y el predicado de «invitación viva»
-- es EL MISMO que el de `player_self_account_status`, letra por letra: si divergieran,
-- la tarjeta diría 'invited' y el botón no encontraría nada que retirar.
--
-- Una invitación CADUCADA no se toca: no puede convertirse en cuenta, y la fila es
-- historia. MN-4 [4] ya se apoya en que caducar es lo que permite volver a invitar.
--
-- ── QUÉ NO SE TOCA: EL NIÑO SIGUE SIENDO JUGADOR DEL CLUB ───────────────────
-- Decisión de Jose, explícita: `players`, `team_members`, la ficha, el equipo y las
-- convocatorias se quedan como están. Esto no da de baja a nadie: la baja del jugador
-- es `players.left_club_at` y tiene su propia acción (`set_player_left_club`).
-- Lo único que cae es el acceso a la app de ESA persona.
--
-- ── POR QUÉ SÍ SE CIERRA LA MEMBRESÍA DEL PERFIL DEL HIJO ───────────────────
-- Es otra fila y otra cosa: no es la pertenencia del JUGADOR al club, es la del
-- PERFIL que nació cuando el niño aceptó su invitación. Es el artefacto del acceso.
-- Medido con la sesión del menor, en producción:
--
--   hoy, con su cuenta propia .................... 45 jugadores · 23 eventos · 6 equipos
--   quitando solo la fila 'self' ................. 45 jugadores · 22 eventos · 6 equipos
--   quitando también su membresía ................  0          ·  0        ·  0
--
-- Sin cerrarla, «retirar la cuenta» no retira nada: el crío sigue abriendo la app y
-- leyendo el club entero. Lo que cambia es solo que deja de RECIBIR avisos, porque
-- todas las listas de destinatarios salen de `player_accounts` (publish-announcement,
-- publish-callup, el cron de recordatorios). Leer, sigue leyendo todo.
--
-- Y es la comparación del propio encargo: «es lo que ya pasa hoy con los jugadores
-- sin cuenta». Un jugador sin cuenta no tiene perfil, y por tanto no tiene membresía
-- ninguna. Cerrarla es lo que lo deja en ese estado, no lo contrario.
--
-- REVERSIBLE, y no de milagro: el `on conflict` de `accept_pending_invitations`
-- reactiva la membresía de baja (`left_at`/`left_reason` → NULL) adoptando el rol de
-- la invitación. Si el tutor vuelve a invitar, el niño vuelve a entrar por su camino.
--
-- NO se cierra si a ese perfil le queda otra razón de estar en este club —otro hijo,
-- o ser seguidor de un hermano—. Hay UNA membresía por (perfil, club), así que
-- cerrarla a ciegas se llevaría por delante un acceso que nadie ha pedido retirar.
--
-- ── LOS 18 ──────────────────────────────────────────────────────────────────
-- Cumplidos los 18 la cuenta es suya y el tutor no la toca: `jugador_mayor_de_edad`.
-- La edad sale de `player_is_minor` (MN-1), que lee `players.date_of_birth` — NOT NULL
-- y al 100%, así que aquí no hay ausencia que interpretar.
--
-- Queda dicho lo que esto NO cubre: si el jugador cumple 18 con una invitación de
-- cuenta propia todavía sin aceptar, el tutor ya no la retira por aquí. Puede seguir
-- cancelándola por donde siempre (la policy `invitations_delete_managers` deja al
-- inviter, y `invite_player_self` graba `created_by = v_uid`), que es donde estaba
-- antes de esta migración. No se le quita nada.
--
-- ── EL GATE ES `user_is_tutor_of_player` ────────────────────────────────────
-- No `user_manages_player`. Retirar es del TUTOR, igual que invitar (MN-2), y desde
-- MN-1 ese helper ya no cuenta 'self': el propio jugador no se retira a sí mismo la
-- cuenta. Para irse del todo tiene su propio derecho y su propio camino, que es el
-- borrado de cuenta (BC), no el botón de su padre.
--
-- ── SIN AVISO AL MENOR ──────────────────────────────────────────────────────
-- Un `notifications` in_app no lo leería nadie: al destinatario se le acaba de
-- retirar el sitio donde se leen. Y sus tokens de push dejan de alcanzarle solos,
-- porque todas las consultas de destinatarios pasan por `player_accounts`. Avisarle
-- es cosa de la pantalla que pulsa el botón, no de la base de datos.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.revoke_player_self_account(p_player_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_club         uuid;
  v_self_profile uuid;
  v_invites      integer := 0;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- El gate va ANTES que nada: quién pregunta manda sobre lo que se responde.
  if not public.user_is_tutor_of_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  if not public.player_is_minor(p_player_id) then
    raise exception 'jugador_mayor_de_edad'
      using hint = 'El jugador ya es mayor de edad: su cuenta es suya y solo él '
                   'puede cerrarla, desde el borrado de cuenta de su perfil.';
  end if;

  select p.club_id into v_club from public.players p where p.id = p_player_id;

  -- ── 1 · La invitación VIVA. Mismo predicado que player_self_account_status. ──
  with retiradas as (
    delete from public.invitations i
     where i.player_id       = p_player_id
       and i.role            = 'jugador'
       and i.player_relation = 'self'
       and i.accepted_at is null
       and i.expires_at > now()
    returning 1
  )
  select count(*) into v_invites from retiradas;

  -- ── 2 · La cuenta ya creada ────────────────────────────────────────────────
  select pa.profile_id into v_self_profile
    from public.player_accounts pa
   where pa.player_id = p_player_id
     and pa.relation  = 'self';

  if v_self_profile is null then
    -- Idempotente: no había cuenta. Se informa de si al menos había invitación.
    return case when v_invites > 0 then 'invitation' else 'none' end;
  end if;

  delete from public.player_accounts pa
   where pa.player_id = p_player_id
     and pa.relation  = 'self';

  -- ── 3 · El acceso a la app de ESE perfil, y solo si no le queda otra razón ──
  if not exists (
    select 1
      from public.player_accounts pa
      join public.players p on p.id = pa.player_id
     where pa.profile_id = v_self_profile
       and p.club_id     = v_club
  ) and not exists (
    select 1
      from public.player_spectators ps
      join public.players p on p.id = ps.player_id
     where ps.spectator_profile_id = v_self_profile
       and p.club_id               = v_club
  ) then
    update public.memberships m
       set left_at     = current_date,
           left_reason = 'Cuenta propia del jugador retirada por su tutor'
     where m.profile_id = v_self_profile
       and m.club_id    = v_club
       and m.left_at is null;
  end if;

  -- El club se entera por donde se entera de todo lo que hace una familia: el
  -- marcador «Sin app» de la ficha vuelve solo, porque sale de player_accounts.
  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'player.self_account_revoked', 'player', p_player_id, v_club,
          'El tutor retiro la cuenta propia del jugador');

  return 'account';
end;
$$;

comment on function public.revoke_player_self_account(uuid) is
  'El TUTOR retira la cuenta propia de su hijo menor: la fila player_accounts.relation=self y, si la hay, la invitacion self todavia viva. Cierra tambien la membresia de ESE perfil en ESE club (el acceso a la app) salvo que le quede otra razon de estar en el; NO toca players, team_members ni la ficha: el nino sigue siendo jugador del club. Cumplidos los 18 no se puede: jugador_mayor_de_edad. Gate user_is_tutor_of_player, igual que invitar (MN-2). Devuelve account | invitation | none.';

-- ACL. Los privilegios por defecto de Supabase se conceden POR NOMBRE a anon y a
-- authenticated: revocar de PUBLIC no basta, hay que nombrarlos. Misma ACL que
-- `invite_player_self`, que es la acción simétrica.
revoke all on function public.revoke_player_self_account(uuid) from public;
revoke all on function public.revoke_player_self_account(uuid) from anon;
revoke all on function public.revoke_player_self_account(uuid) from authenticated;
grant execute on function public.revoke_player_self_account(uuid) to authenticated, service_role;
