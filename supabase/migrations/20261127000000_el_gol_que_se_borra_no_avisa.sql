-- ════════════════════════════════════════════════════════════════════════════
-- El gol que se BORRA no avisa: la fila de push se va con él.
--
-- QUÉ PASA HOY. El aviso de gol nace en la base (`notify_goal`, mig
-- 20261126000000) y lo envía el lado TS: el empujón eager (#811) o el drenador de
-- cada minuto (#810). Entre que la fila se crea y se envía hay una ventana. Si en
-- esa ventana el entrenador BORRA el gol —se lo apuntó al jugador equivocado, o
-- nunca fue gol— la fila de push sigue ahí, `pending`, y el drenador la manda: un
-- «Gol 2-1» de un gol que ya no existe, con la pantalla del directo enseñando 1-1.
--
-- Y no se arregla desde el cliente. `notifications` tiene DOS políticas RLS,
-- `notifications_select_own` y `notifications_update_own_read` (mig
-- 20260602000002): no hay política de DELETE ni de INSERT, así que a esa tabla solo
-- escriben `service_role` y las funciones SECURITY DEFINER. El entrenador que borra
-- el gol no puede borrar el aviso aunque quisiera.
--
-- POR QUÉ UN TRIGGER. Lo mismo que dijo la migración gemela: lo único que comparten
-- los dos clientes (web y app nativa) es la fila de `match_events`. Y la corrección
-- desde la app nativa es la pieza siguiente, así que ponerlo en el TS de web sería
-- escribirlo para el camino que HOY existe y dejar sin cubrir el que viene. El
-- aviso nace en la base; que muera en la base.
--
-- ── EL PREDICADO ES EL DEL EMISOR, Y ESO NO ES CASUAL ────────────────────────
-- Lo que hay que borrar no es «lo que parezca pendiente»: es TODO lo que el
-- drenador podría enviar de ese gol. Si el predicado del borrado fuera más
-- ESTRECHO que el del envío, quedaría una fila que el cron mandaría igual, y el
-- agujero seguiría abierto con un arreglo encima.
--
-- El drenador (`drainPushQueue`, apps/web/src/lib/drain-push-queue.ts) selecciona
-- `channel='push'` + `status='pending'` + `sent_at is null`. Aquí se borra por
-- `channel='push'` + `status='pending'`, SIN la condición de `sent_at`: es a
-- propósito más ancho. Una fila `pending` con `sent_at` puesto es un estado que no
-- debería existir, y si existiera, el drenador no la enviaría — pero prefiero
-- borrarla que razonar sobre ella.
--
-- El `type = 'goal'` es redundante con el prefijo de la clave (que ya empieza por
-- `goal:`) y va puesto igual: si algún día nace un tipo cuyo prefijo empiece por
-- esas mismas letras, este delete no se lo lleva por delante.
--
-- ── LO QUE NO SE BORRA, Y POR QUÉ ────────────────────────────────────────────
-- · El push YA ENVIADO (`status='sent'`). No se puede retirar un push del teléfono
--   —no hay API para eso, ni en web-push ni en Expo— así que su fila es el registro
--   de algo que de verdad pasó. Borrarla sería perder la única huella de que esa
--   familia recibió un aviso que ahora no cuadra. Lo único que tapa un push
--   enviado es el `tag` (`goal:<event_id>`), que colapsa avisos del mismo partido:
--   el siguiente gol lo sustituye en la bandeja.
-- · La CAMPANA (`channel='in_app'`). El feed excluye el tipo `goal` a propósito
--   (`FEED_HIDDEN_TYPES` en packages/core/src/notifications/feed.ts), del listado y
--   del contador, así que esa fila no se ve en ninguna pantalla y no puede mentirle
--   a nadie. Si algún día el gol entra en el feed, esta decisión hay que revisarla:
--   ahí sí habría que llevarse también la campana.
--
-- BEST-EFFORT. Todo va en su `begin … exception when others`, que en plpgsql abre
-- un savepoint: si limpiar los avisos falla, el BORRADO DEL GOL se completa igual.
-- Lo contrario sería dejar al entrenador sin poder corregir el acta porque la cola
-- de avisos tiene un problema. El fallo se avisa con `raise warning` (sale en los
-- logs de Postgres) y el bloque [8] del pgTAP lo fuerza para comprobarlo.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.unnotify_deleted_goal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_borradas integer;
begin
  begin
    -- El prefijo es el de `goalDedupeLikePrefix` (packages/core/src/notifications/
    -- goal-push.ts) y el que concatena `notify_goal`: `goal:<id del gol>:`. Los dos
    -- puntos del final NO son adorno — sin ellos, un gol cuyo id fuese prefijo de
    -- otro se llevaría los avisos del otro.
    delete from public.notifications
     where channel = 'push'::public.notification_channel
       and type = 'goal'::public.notification_type
       and status = 'pending'
       and dedupe_key like 'goal:' || old.id::text || ':%';

    get diagnostics v_borradas = row_count;

    -- Solo cuando hubo algo que borrar: en un partido normal esto no dice nada, y
    -- cuando dice algo es justo el caso que nos interesaba (se corrigió a tiempo).
    if v_borradas > 0 then
      raise notice 'unnotify_deleted_goal: % aviso(s) de push retirados del gol %',
        v_borradas, old.id;
    end if;
  exception when others then
    raise warning 'unnotify_deleted_goal falló para el gol % (%): %',
      old.id, sqlstate, sqlerrm;
  end;

  return null;
end;
$$;

comment on function public.unnotify_deleted_goal() is
  'Al BORRAR un gol de match_events, retira sus avisos de push que todavia no se '
  'han enviado (channel=push, status=pending, dedupe_key goal:<id>:%). Cubre web y '
  'app nativa, que es lo unico que comparten: la fila. No toca los ya enviados (son '
  'el registro de lo que paso) ni la campana (el feed excluye el tipo goal). '
  'Best-effort: los fallos se capturan y NO revierten el borrado del gol.';

-- ACL: una funcion nueva en `public` nace con EXECUTE para PUBLIC, y PUBLIC incluye
-- a `anon`. El guard `anon_execute_cerrado` [1] afirma que solo DOS funciones
-- nuestras son ejecutables por anon y se pone rojo sin esta linea — me lo cazo con
-- `notify_goal` en el #808. No hace falta grant a service_role: el bloque [5] de ese
-- guard exime a las funciones que devuelven trigger, y a esta la invoca el trigger.
revoke all on function public.unnotify_deleted_goal() from public;

-- El WHEN es el espejo del de `trg_notify_goal`: solo las filas que PUDIERON crear
-- un aviso llaman a la función. Una tarjeta, un cambio, un penalti fallado o la
-- tanda no han creado nada, así que no hay nada que retirar.
create trigger trg_unnotify_deleted_goal
  after delete on public.match_events
  for each row
  when (old.type = 'goal'
        or (old.type = 'penalty' and old.metadata->>'outcome' = 'scored'))
  execute function public.unnotify_deleted_goal();

-- ── Último vistazo (corre UNA vez, en el push) ───────────────────────────────
-- Imprime lo que afirma, incluso cuando pasa: un guard que calla no distingue
-- «estaba bien» de «el predicado no coge nada».
do $$
declare
  v_trigger integer;
  v_abiertas integer;
begin
  select count(*) into v_trigger
    from pg_trigger
   where tgname = 'trg_unnotify_deleted_goal'
     and tgrelid = 'public.match_events'::regclass
     and not tgisinternal;

  if v_trigger <> 1 then
    raise exception 'esperaba 1 trigger trg_unnotify_deleted_goal sobre match_events, hay %', v_trigger;
  end if;

  select count(*) into v_abiertas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'unnotify_deleted_goal'
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_abiertas <> 0 then
    raise exception 'unnotify_deleted_goal sigue siendo ejecutable por anon';
  end if;

  raise notice 'unnotify_deleted_goal: % trigger sobre match_events, 0 ejecutable por anon', v_trigger;
end;
$$;
