-- ════════════════════════════════════════════════════════════════════════════
-- RC-B · El remate del borrado retira las cuentas de los menores que se quedarían
--        sin ningún tutor.
--
-- ── LA VENTANA, REPRODUCIDA ENTERA CONTRA PRODUCCIÓN ────────────────────────
-- La 20261101000000 impide PEDIR el borrado dejando a un menor con cuenta propia.
-- Pero mide al PEDIR, y entre medias hay 30 días. Ensayo con ROLLBACK, los cuatro
-- pasos, cada uno comprobado:
--
--   1. el tutor pide el borrado — entra, porque el hijo todavía no tiene cuenta;
--   2. con el borrado EN CURSO, le invita — la invitación se crea: `invite_player_self`
--      no mira si hay un borrado pendiente;
--   3. el hijo acepta — pasa: el candado de BC-6 frena a QUIEN ACEPTA, y ese es el
--      hijo, que no tiene ningún borrado en curso;
--   4. el club rechaza la supresión y vencen los 30 días → se remata.
--
--   RESULTADO: tutores 0 · cuenta_propia 1 · menor_con_acceso 1 · tutor anonimizado.
--
-- Un crío de doce años dentro de la app, con su cuenta y su membresía viva, sin
-- ningún tutor. Con el candado nuevo ya puesto.
--
-- ── LA DECISIÓN (Jose, explícita) ───────────────────────────────────────────
-- Al vencer el plazo, el remate RETIRA esas cuentas: hace lo que el tutor tenía que
-- haber hecho antes de irse. El niño sigue en el club con su ficha, su equipo y sus
-- convocatorias; solo pierde el acceso a la app.
--
-- La alternativa —no completar el borrado mientras haya menores colgando— se descartó
-- y merece quedar dicho: dejaría a alguien sin poder borrarse nunca, que es
-- exactamente lo que el 5.1.1(v) de Apple prohíbe. Es la misma razón por la que toda
-- esta serie puso la llave antes que el candado.
--
-- ── POR QUÉ HACE FALTA PARTIR `revoke_player_self_account` EN DOS ───────────
-- La RPC del tutor se gatea con `auth.uid()` — `user_is_tutor_of_player`—, y el remate
-- corre desde el cron con `service_role` y SIN sesión: `auth.uid()` es NULL, así que
-- no puede llamarla. Copiar el cuerpo habría sido la respuesta barata y la de siempre:
-- dos implementaciones de «retirar» que acaban retirando cosas distintas.
--
-- Así que el EFECTO baja a `revoke_player_self_account_apply`, sin gate, y los dos
-- entran por su propia puerta con su propio permiso:
--
--   · `revoke_player_self_account`  → gate de tutor + menor de edad  (el tutor)
--   · `finalize_account_deletion`   → sin sesión, ya decidido        (el remate)
--
-- El `_apply` NO se concede a nadie: ni anon, ni authenticated. No hace falta y sería
-- un agujero — sin gate, cualquiera retiraría la cuenta de cualquier menor. Funciona
-- igual desde dentro porque las dos llamantes son SECURITY DEFINER de `postgres`, y el
-- EXECUTE se comprueba contra el rol que ejecuta, que ahí es la dueña.
--
-- ── LO QUE NO CAMBIA ────────────────────────────────────────────────────────
-- `revoke_player_self_account` conserva sus gates, su comprobación de los 18 y su fila
-- de auditoría: por fuera hace exactamente lo mismo que hacía, y sus pruebas siguen
-- midiéndolo sin tocar una línea.
--
-- El cuerpo de `finalize_account_deletion` se reproduce desde su definición VIVA
-- (`pg_get_functiondef`): el diff contra ella es el bloque 5.0 y la variable del bucle.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EL EFECTO, sin gate. Lo que hasta ahora vivía dentro de la RPC del tutor.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.revoke_player_self_account_apply(p_player_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club         uuid;
  v_self_profile uuid;
  v_invites      integer := 0;
begin
  select p.club_id into v_club from public.players p where p.id = p_player_id;

  -- 1 · La invitación VIVA. Mismo predicado que player_self_account_status.
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

  -- 2 · La cuenta ya creada
  select pa.profile_id into v_self_profile
    from public.player_accounts pa
   where pa.player_id = p_player_id
     and pa.relation  = 'self';

  if v_self_profile is null then
    return case when v_invites > 0 then 'invitation' else 'none' end;
  end if;

  delete from public.player_accounts pa
   where pa.player_id = p_player_id
     and pa.relation  = 'self';

  -- 3 · El acceso a la app de ESE perfil, y solo si no le queda otra razón de estar
  --     en este club. Hay UNA membresía por (perfil, club).
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

  return 'account';
end;
$$;

comment on function public.revoke_player_self_account_apply(uuid) is
  'RC-B: EL EFECTO de retirar la cuenta propia de un jugador (fila self, invitacion viva y la membresia de ese perfil en ese club), SIN NINGUN GATE. No se concede a nadie: solo se llama desde revoke_player_self_account (gate de tutor y de minoria de edad) y desde finalize_account_deletion (sin sesion, ya decidido). Existe para que "retirar" no tenga dos implementaciones.';

-- SIN GRANTS. Sin gate, ejecutarla es retirar la cuenta de cualquier menor. Las dos
-- llamantes son SECURITY DEFINER de `postgres` y el EXECUTE se comprueba contra el rol
-- que ejecuta, que ahi es la duena: no necesitan que se conceda a nadie mas.
revoke all on function public.revoke_player_self_account_apply(uuid) from public;
revoke all on function public.revoke_player_self_account_apply(uuid) from anon;
revoke all on function public.revoke_player_self_account_apply(uuid) from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La RPC del tutor: los mismos gates, el mismo resultado, el efecto delegado.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.revoke_player_self_account(p_player_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_club uuid;
  v_res  text;
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

  v_res := public.revoke_player_self_account_apply(p_player_id);

  if v_res = 'account' then
    select p.club_id into v_club from public.players p where p.id = p_player_id;
    insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
    values (v_uid, 'player.self_account_revoked', 'player', p_player_id, v_club,
            'El tutor retiro la cuenta propia del jugador');
  end if;

  return v_res;
end;
$$;

comment on function public.revoke_player_self_account(uuid) is
  'El TUTOR retira la cuenta propia de su hijo menor: la fila player_accounts.relation=self y, si la hay, la invitacion self todavia viva. Cierra tambien la membresia de ESE perfil en ESE club (el acceso a la app) salvo que le quede otra razon de estar en el; NO toca players, team_members ni la ficha: el nino sigue siendo jugador del club. Cumplidos los 18 no se puede: jugador_mayor_de_edad. Gate user_is_tutor_of_player, igual que invitar (MN-2). Devuelve account | invitation | none. RC-B: el efecto vive en revoke_player_self_account_apply, compartido con el remate del borrado.';

revoke all on function public.revoke_player_self_account(uuid) from public;
revoke all on function public.revoke_player_self_account(uuid) from anon;
revoke all on function public.revoke_player_self_account(uuid) from authenticated;
grant execute on function public.revoke_player_self_account(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El remate. Reproducido desde su definición VIVA; el diff es el bloque 5.0.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_account_deletion(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_req    public.account_deletion_requests%rowtype;
  v_avatar text;
  v_email  text;
  v_hijo   record;
begin
  perform pg_advisory_xact_lock(hashtext('account_deletion:' || p_profile_id::text));

  select * into v_req
    from public.account_deletion_requests
   where profile_id = p_profile_id and status = 'pending'
   limit 1;

  -- Idempotente para el cron: si ya está completado (o cancelado), no hay nada que hacer.
  if not found then
    return null;
  end if;

  select avatar_url into v_avatar from public.profiles where id = p_profile_id;
  select email       into v_email  from auth.users     where id = p_profile_id;

  -- ── RC-B · 5.0 · RETIRAR LAS CUENTAS DE LOS MENORES QUE SE QUEDARIAN SIN NADIE ──
  -- La 20261101000000 impide PEDIR el borrado dejando a un menor con cuenta propia.
  -- Pero solo mide al pedir, y entre medias hay 30 dias. Reproducido entero contra
  -- produccion: el tutor pide el borrado (el hijo aun no tiene cuenta, asi que entra),
  -- despues le invita —`invite_player_self` no mira si hay un borrado en curso—, el
  -- hijo acepta —el candado de BC-6 solo frena a QUIEN ACEPTA, y ese es el hijo, que no
  -- tiene ningun borrado pendiente— y al vencer el plazo:
  --
  --     tutores: 0 · cuenta_propia: 1 · menor_con_acceso: 1 · tutor_anonimizado: true
  --
  -- Un crio de doce anos dentro de la app, con su cuenta y su membresia viva, sin
  -- ningun tutor. Aqui se hace lo que el tutor tenia que haber hecho antes de irse.
  --
  -- DECISION DE JOSE, explicita: al vencer el plazo el remate RETIRA esas cuentas. El
  -- nino sigue en el club con su ficha, su equipo y sus convocatorias; solo pierde el
  -- acceso a la app. La alternativa —no completar el borrado mientras haya menores
  -- colgando— se descarto: dejaria a alguien sin poder borrarse nunca, que es
  -- exactamente lo que el 5.1.1(v) de Apple prohibe.
  --
  -- POR QUE AQUI Y NO EN OTRO SITIO:
  --   · ANTES de 5.4, que borra `player_accounts` de esta persona: despues ya no se
  --     sabria de que jugadores era tutor. Es la misma razon por la que BC-7 esta donde
  --     esta.
  --   · ANTES del aviso `tutor_unlinked`: ese aviso va a las OTRAS cuentas del jugador,
  --     y la del hijo que estamos cerrando es una de ellas. Escribirle una novedad al
  --     sitio del que le acabamos de sacar seria dejarla sin leer para siempre. Retirado
  --     primero, su fila ya no esta y el aviso no le alcanza; los demas tutores —que son
  --     justo los que NO provocan retirada— lo siguen recibiendo igual.
  --   · NO es best-effort y NO va en savepoint: es parte del borrado. Si esto falla, la
  --     anonimizacion tiene que fallar entera, porque el estado que deja es el que la
  --     regla prohibe. Mismo criterio que el desenganche de la suscripcion.
  --
  -- LA POBLACION ES MAS ANCHA QUE LA DEL CANDADO, a proposito. El candado mira
  -- `preview_account_deletion`, que filtra jugadores activos (`erased_at` y
  -- `left_club_at` nulos). Aqui no se filtra: si el jugador dejo el club durante esos 30
  -- dias, su cuenta sigue abierta y su tutor se va igual. Esto es la limpieza del final,
  -- y en una limpieza pasarse es barato y quedarse corto no.
  for v_hijo in
    select pa.player_id
      from public.player_accounts pa
     where pa.profile_id = p_profile_id
       and pa.relation in ('parent', 'guardian')
       and public.player_is_minor(pa.player_id)
       and not public.player_has_other_tutor(pa.player_id, p_profile_id)
  loop
    if public.revoke_player_self_account_apply(v_hijo.player_id) <> 'none' then
      insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
      select p_profile_id, 'player.self_account_revoked', 'player', v_hijo.player_id, p.club_id,
             'Retirada automatica al completar el borrado de su unico tutor'
        from public.players p where p.id = v_hijo.player_id;
    end if;
  end loop;

  -- 5.1 · El perfil: fuera la PII, queda la fila (la sostienen 52 FK, ADR-0021).
  update public.profiles
     set full_name     = null,
         avatar_url    = null,
         phone         = null,
         date_of_birth = null,
         deleted_at    = now(),
         updated_at    = now()
   where id = p_profile_id;

  -- 5.2 · Contacto que gestiona el club (no es el login).
  update public.memberships
     set phone = null, contact_email = null
   where profile_id = p_profile_id;

  -- 5.3 · Invitaciones DIRIGIDAS a esta persona: el email es suyo. Las que ÉL envió a
  -- otros no se tocan (ese email es de un tercero). Las no aceptadas se invalidan.
  update public.invitations
     set email      = 'deleted-' || id::text || '@deleted.invalid',
         expires_at = least(expires_at, now())
   where accepted_at is null
     and (invited_user_id = p_profile_id
          or (v_email is not null and lower(email) = lower(v_email)));

  update public.invitations
     set email = 'deleted-' || id::text || '@deleted.invalid'
   where accepted_at is not null
     and (invited_user_id = p_profile_id
          or (v_email is not null and lower(email) = lower(v_email)));

  -- ── BC-7 · AVISOS DEL REMATE ───────────────────────────────────────────────
  -- Va ANTES de 5.4 porque `tutor_unlinked` necesita player_accounts INTACTO: despues
  -- del delete ya no se sabe de que jugadores era tutor.
  --
  -- Un SAVEPOINT POR AVISO (BEGIN...EXCEPTION separados), no uno para los dos: si uno
  -- falla, el otro tiene que salir igual. En el ensayo de esta migracion un solo bloque
  -- se llevo por delante los dos avisos de golpe.
  --
  -- Best-effort en cualquier caso: un aviso que falle NO puede revertir una
  -- anonimizacion ya aplicada (5.1 ya vacio el perfil). Mismo criterio que
  -- trg_notify_erasure_requested.
  begin
    -- 1) OTRO TUTOR del mismo jugador. Se avisa al COMPLETAR y no al solicitar: hasta
    --    aqui el borrado era cancelable, y decirle a alguien "el otro tutor se va" por
    --    algo que puede no ocurrir es filtrar una intencion ajena. Ahora es un hecho, y
    --    ademas es accionable: pasa a ser el unico tutor del menor.
    --    Solo salen los jugadores que TIENEN otro tutor; de los que era unico tutor no
    --    hay a quien avisar (esos van por la via de erasure_requests).
    --    El nombre del MENOR si viaja: el destinatario es su propio tutor.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      other.profile_id,
      'tutor_unlinked'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'player_id', p.id,
        'player_first_name', p.first_name,
        'club_id', p.club_id
      ),
      'tutor_unlinked:' || v_req.id::text || ':' || p.id::text
        || ':' || other.profile_id::text || ':in_app'
    from public.player_accounts mine
    join public.players p on p.id = mine.player_id
    join public.player_accounts other
      on other.player_id = mine.player_id and other.profile_id <> p_profile_id
    where mine.profile_id = p_profile_id
      and p.erased_at is null
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: tutor_unlinked fallo para %: %', p_profile_id, sqlerrm;
  end;

  begin
    -- 2) SUPERADMIN, por cada club donde era admin_club. Es el momento en que el club
    --    se queda sin admin de verdad: la membership lleva de baja desde la solicitud y
    --    5.5 esta a punto de soltar clubs.owner_profile_id. El aviso de la SOLICITUD
    --    daba 30 dias de margen; este dice que se acabaron.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      pa.profile_id,
      'account_deletion_completed'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'deletion_id', v_req.id,
        'club_id', m.club_id,
        'club_name', c.name,
        'role', 'admin_club',
        'is_platform', true
      ),
      'account_deletion_completed:' || v_req.id::text || ':' || m.club_id::text
        || ':' || pa.profile_id::text || ':in_app'
    from public.memberships m
    join public.clubs c on c.id = m.club_id
    cross join public.platform_admins pa
    where m.profile_id = p_profile_id
      and m.role = 'admin_club'
      and pa.profile_id <> p_profile_id
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: account_deletion_completed fallo para %: %', p_profile_id, sqlerrm;
  end;

  -- BC-7 · Las asignaciones de equipo se CIERRAN aqui, no al solicitar.
  -- `request_account_deletion` pone left_at en memberships con un UPDATE directo, sin
  -- pasar por `set_membership_left`, que es quien cierra team_staff en una baja normal
  -- — asi que hasta ahora el equipo seguia listando como entrenador ACTIVO a alguien
  -- que se habia ido. Cerrarlo en la SOLICITUD seria peor: el borrado es cancelable y
  -- `set_membership_left` no reabre team_staff al reactivar (migracion
  -- 20261053000000), o sea que arrepentirse dejaria al entrenador sin sus equipos.
  -- Aqui ya no hay vuelta atras. Esto NO es un aviso: va fuera del best-effort, porque
  -- es parte del borrado y tiene que ser atomico con el.
  -- `greatest` protege el CHECK team_staff_check (left_at >= joined_at).
  update public.team_staff ts
     set left_at = greatest(current_date, ts.joined_at)
    from public.memberships m
   where m.id = ts.membership_id
     and m.profile_id = p_profile_id
     and ts.left_at is null;

  -- ── SU-1 · DESENGANCHE DE LA SUSCRIPCIÓN (ADR-0022 §4c) ────────────────────
  -- NO es best-effort y NO va en un savepoint: es parte del borrado. Si esto falla,
  -- la anonimización debe fallar entera, porque una cuenta anonimizada cuyo cliente
  -- de RevenueCat sigue vivo es exactamente el incidente que ADR-0021 evita.
  --
  -- El orden importa: la cola se lee ANTES de vaciar `rc_customer_id`, porque el
  -- servidor necesita el App User ID para llamar a su API de borrado.
  insert into public.revenuecat_deletion_queue (profile_id, app_user_id)
  values (p_profile_id, p_profile_id::text)
  on conflict (profile_id) do nothing;

  -- La fila NO se borra (FK NO ACTION, ADR-0022 §5): queda desenganchada. Con
  -- `unlinked_at` puesto, `apply_subscription_event` ya no vuelve a tocarla nunca.
  update public.subscription_entitlements
     set unlinked_at     = now(),
         rc_customer_id  = null,
         updated_at      = now()
   where profile_id = p_profile_id
     and unlinked_at is null;

  -- 5.4 · Vínculos y canales: se borran de verdad.
  delete from public.player_accounts          where profile_id = p_profile_id;
  delete from public.team_follows             where profile_id = p_profile_id;
  delete from public.player_spectators        where spectator_profile_id = p_profile_id;
  delete from public.team_chat_participation  where profile_id = p_profile_id;
  delete from public.team_conversation_reads  where profile_id = p_profile_id;
  delete from public.staff_conversation_reads where profile_id = p_profile_id;
  delete from public.expo_push_tokens         where user_id = p_profile_id;
  delete from public.push_subscriptions       where user_id = p_profile_id;
  delete from public.notification_preferences where user_id = p_profile_id;
  delete from public.notifications            where user_id = p_profile_id;

  -- 5.5 · Si era el dueño de un club, se libera el hueco. `assign_club_owner_on_admin`
  -- solo escribe cuando owner_profile_id es NULL, así que sin esto el admin_club nuevo
  -- que designe la plataforma nunca pasaría a ser owner.
  update public.clubs set owner_profile_id = null where owner_profile_id = p_profile_id;

  -- 5.6 · Las supresiones de menor que sigan pendientes SE QUEDAN pendientes: el dato
  -- del menor tiene otro responsable (el club) y otro plazo. Solo cambia que quien las
  -- pidió aparecerá ya como "Usuario eliminado".

  -- `entitlement_suspended_at` es el hueco que BC-1 reservó para esto (migración
  -- 20261058000000). Se sella en el MISMO update que cierra la solicitud: una escritura,
  -- no dos.
  update public.account_deletion_requests
     set status = 'completed', completed_at = now(),
         entitlement_suspended_at = now()
   where id = v_req.id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  select p_profile_id, 'account.deleted', 'profile', p_profile_id, m.club_id,
         'Cuenta anonimizada: fin del proceso de borrado'
    from public.memberships m
   where m.profile_id = p_profile_id;

  return v_avatar;  -- ruta del objeto a borrar por Storage API (NULL si no había)
end;
$function$;
