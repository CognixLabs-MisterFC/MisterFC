-- ════════════════════════════════════════════════════════════════════════════
-- El GOL avisa venga de donde venga: el aviso nace en la BASE, no en la web.
--
-- QUÉ PASABA. El aviso de gol lo emitía `emitGoalPush` (apps/web/src/lib/
-- goal-notify.ts), y se llama en CUATRO sitios, los cuatro acciones de servidor del
-- directo de web: gol de jugada, gol del rival, penalti propio marcado y penalti del
-- rival. La app NATIVA no pasa por ninguno: sube el evento con un `upsert` directo a
-- `match_events` por PostgREST (es el diseño del directo — «editar no dispara
-- fan-out, así que no hay route handler»), y el único trigger que tenía esa tabla era
-- de validación. Resultado medido: un gol apuntado desde el móvil del entrenador NO
-- generaba ni una fila de aviso. Ni push, ni campana.
--
-- POR QUÉ UN TRIGGER, y no «que la app llame a un endpoint». Es la misma figura que
-- ya resolvió `notify_erasure_requested` (mig 20261045000000), y su cabecera lo dice
-- con estas palabras: «la solicitud nace en DOS orígenes que solo comparten esta
-- tabla — la web y la app NATIVA […] Emitir en el TS de la web dejaría sin aviso la
-- vía principal». Aquí igual: lo único que comparten los dos clientes es la fila de
-- `match_events`. El trigger cubre a los dos, y a cualquier escritor futuro.
--
-- LO QUE ESTE TRIGGER NO HACE: enviar. En este proyecto la base no habla por HTTP
-- (cero referencias a `pg_net` o a webhooks en las migraciones, comprobado), así que
-- el trigger solo CREA las filas de `notifications` y el envío lo sigue haciendo el
-- lado TS — el envío eager (route handler, pieza siguiente) o el drenador.
--
-- ── LA REGLA DE FRESCURA, Y POR QUÉ ES LA MITAD DE ARRIBA ────────────────────
-- La cola offline del directo puede subir un gol MUCHO después de que ocurriera. Un
-- «GOL» que llega cuando el partido ya va 3-1 confunde, y la pantalla del directo ya
-- enseña el marcador bueno. Así que la fila de PUSH solo se crea si el gol es fresco.
--
-- Y el dato NO puede ser `created_at`: la fila encolada no lleva la hora del toque
-- (`buildMatchEventRow` en core no escribe `created_at`), así que `created_at` es la
-- hora de la SUBIDA, no la del gol. El dato que sí sirve es el RELOJ del partido, que
-- el cliente congela en el toque y guarda en `clock_seconds`. El reloj de AHORA se
-- deriva de `match_periods` con la fórmula que esa tabla lleva escrita en su
-- comentario: `base_offset + accumulated + (running ? now()-last_started_at : 0)`.
--
--   frescura = reloj_de_ahora − new.clock_seconds   (en segundos JUGADOS)
--
-- Umbral: 120 segundos de juego. Una subida normal tarda menos de un segundo y un
-- bache de cobertura se resuelve en segundos; dos minutos de juego dan margen de
-- sobra a una conexión mala que funciona, y acotan cuánto puede haberse movido el
-- marcador. Es UNA constante (`c_umbral_segundos`): cambiarla es una línea.
--
-- Un delta NEGATIVO cuenta como fresco: significa que el reloj del servidor va por
-- detrás de la posición del gol, que es lo que pasa si el operador ajusta el reloj
-- hacia atrás (`adjustClock`) o si se pausó justo después del gol.
--
-- Y la mitad de ABAJO no está aquí, está en el TS y tiene que estar: una fila de push
-- creada fresca puede quedarse en la cola y enviarse MUCHO después (hoy el único
-- drenador vive al final de /api/cron/reminders, programado `0 8 * * *`: una vez al
-- día). Esta migración NO debe aplicarse antes de que el lado TS compruebe la
-- antigüedad DE LA FILA al enviar; ahí sí vale `notifications.created_at`, porque la
-- pregunta es otra: «¿cuánto lleva este aviso esperando?».
--
-- ── LA CAMPANA SE ESCRIBE SIEMPRE, Y HAY QUE SABER QUÉ SIGNIFICA ─────────────
-- La fila `in_app` se crea aunque el push no salga. Pero que nadie espere verla: el
-- feed de novedades EXCLUYE el tipo `goal` a propósito y por decisión tomada tras QA
-- en dispositivo — `FEED_HIDDEN_TYPES = ['goal', 'new_announcement']` en
-- packages/core/src/notifications/feed.ts, «el gol pertenece al DIRECTO, no al
-- feed», y se excluye del listado Y del contador para que cuadren. Así que la fila
-- in_app es el REGISTRO del aviso (y la paridad con lo que ya escribe la web), no
-- algo que la familia vea. Cuesta un INSERT y no cuesta nada más.
--
-- ── EL DEDUPE, QUE ES LO QUE PERMITE DOS CAMINOS ─────────────────────────────
-- La clave es EXACTAMENTE la que compone `emitNotificationFanOut`:
--
--     goal:<match_events.id>:<profile_id>:<in_app|push>
--
-- (en notify-bus.ts: `${dedupe_base_prefix}:${user_id}` y luego `:${channel}`, con
-- `dedupe_base_prefix = 'goal:' + goalRowId`). Tiene que coincidir CARÁCTER a
-- CARÁCTER: con `notifications_dedupe_unique` encima, eso es lo que hace que el
-- trigger y el envío eager puedan coexistir sin notificar dos veces. Si alguien
-- cambia el formato en un lado, se duplican los avisos — por eso está escrito aquí.
--
-- ── BEST-EFFORT DE VERDAD ────────────────────────────────────────────────────
-- Un trigger AFTER INSERT corre en la MISMA transacción que el gol: si lanzara, el
-- gol se perdería. Todo el cuerpo va en un `BEGIN ... EXCEPTION WHEN OTHERS`, que en
-- PL/pgSQL abre un savepoint, así que un fallo al avisar revierte SOLO el aviso y
-- deja el gol. Un aviso perdido es leve; un gol perdido en pleno partido, no.
--
-- No toca ninguna función ni trigger existente: CREATE FUNCTION + CREATE TRIGGER
-- nuevos sobre `match_events`. No cambia el esquema, así que no requiere db:types.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_goal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Segundos JUGADOS de margen entre el gol y el reloj de ahora para que el push
  -- salga. Ver la cabecera de la migración.
  c_umbral_segundos constant integer := 120;

  v_team      uuid;
  v_team_name text;
  v_opponent  text;
  v_status    text;
  v_clock_now integer;
  v_own       integer;
  v_rival     integer;
  v_fresco    boolean;
  v_payload   jsonb;
  v_deep_link text;
begin
  begin
    -- El equipo y el rival del partido. Sin equipo no hay a quién seguir.
    select e.team_id, t.name, e.opponent_name
      into v_team, v_team_name, v_opponent
      from public.events e
      join public.teams t on t.id = e.team_id
     where e.id = new.event_id;
    if v_team is null then
      return null;
    end if;

    -- Marcador DESPUÉS de este gol: el trigger es AFTER INSERT, así que la fila nueva
    -- ya es visible en esta transacción. El predicado es el gemelo SQL de `isMatchGoal`
    -- (packages/core/src/match/score.ts): gol de jugada o penalti MARCADO; la tanda
    -- (`shootout_penalty`) no cuenta. El TEXTO no se arma aquí — se arma en TS con
    -- `formatGoalPush` a partir de estos números, para que la frase viva en un sitio.
    select count(*) filter (where e.side = 'own'),
           count(*) filter (where e.side = 'rival')
      into v_own, v_rival
      from public.match_events e
     where e.event_id = new.event_id
       and (e.type = 'goal'
            or (e.type = 'penalty' and e.metadata->>'outcome' = 'scored'));

    -- ¿Está el directo en marcha? Un gol insertado sobre un partido cerrado o sin
    -- empezar es una reparación a mano, no una noticia.
    select ms.status into v_status
      from public.match_state ms
     where ms.event_id = new.event_id;

    -- Reloj de AHORA (la fórmula del comentario de match_periods). El max() da el
    -- reloj vivo si hay periodo corriendo y el congelado si estamos en el descanso.
    select max(p.base_offset_seconds + p.accumulated_seconds +
               case when p.running
                 then greatest(0, floor(extract(epoch from (now() - p.last_started_at))))::integer
                 else 0 end)
      into v_clock_now
      from public.match_periods p
     where p.event_id = new.event_id;

    v_fresco := v_status = 'live'
                and v_clock_now is not null
                and (v_clock_now - new.clock_seconds) <= c_umbral_segundos;

    v_deep_link := '/es/directos/' || new.event_id::text;
    -- Payload ACOTADO: los ingredientes, no la frase. `pushPayloadFromNotificationRow`
    -- (core) arma título y cuerpo con `formatGoalPush` a partir de esto.
    v_payload := jsonb_build_object(
      'event_id',      new.event_id,
      'team_id',       v_team,
      'deep_link',     v_deep_link,
      'own',           v_own,
      'rival',         v_rival,
      'team_name',     v_team_name,
      'opponent_name', v_opponent
    );

    -- CAMPANA: siempre, salga el push o no. Los seguidores del equipo menos el que
    -- graba (`resolveGoalRecipients` hace lo mismo en TS). No hace falta deduplicar
    -- seguidores: `team_follows` tiene PK (profile_id, team_id).
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select f.profile_id,
           'goal'::public.notification_type,
           'in_app'::public.notification_channel,
           v_payload,
           'goal:' || new.id::text || ':' || f.profile_id::text || ':in_app'
      from public.team_follows f
     where f.team_id = v_team
       and f.profile_id is distinct from new.created_by
    on conflict (dedupe_key) do nothing;

    -- PUSH: solo si el gol es fresco. Si no, no se crea la fila — y no crearla es la
    -- forma de que no se envíe nunca, porque el drenador solo mira filas push.
    if v_fresco then
      insert into public.notifications (user_id, type, channel, payload, dedupe_key)
      select f.profile_id,
             'goal'::public.notification_type,
             'push'::public.notification_channel,
             v_payload,
             'goal:' || new.id::text || ':' || f.profile_id::text || ':push'
        from public.team_follows f
       where f.team_id = v_team
         and f.profile_id is distinct from new.created_by
      on conflict (dedupe_key) do nothing;
    end if;
  exception
    when others then
      -- El aviso NUNCA puede tumbar el registro del gol.
      raise warning 'notify_goal falló para match_events.id=%: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.notify_goal() is
  'F7B-P1 bis — crea las filas de aviso de GOL (campana siempre; push solo si el gol '
  'es fresco: directo en live y reloj a <=120 s del gol) para los seguidores del '
  'equipo, menos quien lo graba. Cubre los goles vengan de la web o de la app nativa, '
  'que escribe match_events directo. Best-effort: los fallos se capturan y NO '
  'revierten el gol. No envía: el envío es del lado TS (eager o drenador).';

-- ACL: una funcion nueva en `public` nace con EXECUTE para PUBLIC, y PUBLIC incluye a
-- `anon`. El guard `anon_execute_cerrado` [1] afirma que solo DOS funciones nuestras
-- son ejecutables por anon, asi que sin este revoke se pone rojo — y con razon: nadie
-- de fuera tiene que poder llamar a esto. Misma linea que
-- `notify_image_consent_revoked` (mig 20261088000000). No hace falta grant a
-- service_role: el bloque [5] de ese guard exime a las funciones que devuelven trigger,
-- y a esta la invoca el trigger, no un rol.
revoke all on function public.notify_goal() from public;

-- El WHEN filtra en la base: ni las tarjetas ni los cambios ni los penaltis fallados
-- llaman a la función. La tanda (`shootout_penalty`) tampoco: no es gol del partido.
create trigger trg_notify_goal
  after insert on public.match_events
  for each row
  when (new.type = 'goal'
        or (new.type = 'penalty' and new.metadata->>'outcome' = 'scored'))
  execute function public.notify_goal();

-- ── Último vistazo (corre UNA vez, en el push) ───────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_trigger
   where tgname = 'trg_notify_goal'
     and tgrelid = 'public.match_events'::regclass
     and not tgisinternal;
  if v_n <> 1 then
    raise exception 'GUARD: esperaba 1 trigger trg_notify_goal sobre match_events, hay %', v_n;
  end if;
  raise notice 'trg_notify_goal instalado sobre match_events (1 trigger). Umbral de frescura: 120 s de juego.';
end $$;
