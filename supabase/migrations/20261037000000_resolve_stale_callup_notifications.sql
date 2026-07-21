-- FIX E · Limpieza one-shot de notificaciones de convocatoria "pegadas".
--
-- Contexto: el badge del sidebar contaba notifications in_app pending de tipo
-- callup_published/callup_updated SIN filtrar por vigencia, así que acumulaba
-- avisos de convocatorias que ya no corresponden a nada visible:
--   · su evento fue BORRADO (no queda fila en public.events), o
--   · el partido YA SE JUGÓ (events.starts_at < now()).
-- Como la lista /convocatorias solo pinta partidos FUTUROS, esas notificaciones
-- nunca se marcaban leídas (MarkNotificationsRead solo dispara al pintar la
-- lista) y el badge se quedaba inflado (13/16 con la pantalla a 0).
--
-- El conteo del badge ya se corrige en código (se deriva de loadUpcomingCallups,
-- misma fuente que la pantalla). Esta migración solo SANEA el dato histórico:
-- pasa esas notificaciones no-vigentes al estado terminal que usa el proyecto al
-- marcar leído (status 'sent' + sent_at), para que dejen de figurar como
-- pendientes en el feed de novedades.
--
-- Enlace notification → evento: el event_id va en el JSONB `payload` bajo la
-- clave 'event_id' (convocatorias/actions.ts: in_app_payload = { event_id }).
-- No hay FK; por eso "evento borrado" se detecta con un NOT EXISTS sobre events.
--
-- Alcance / seguridad:
--   · Solo toca status (pending → sent). NO borra filas.
--   · Genérica: cualquier club, cualquier user; sin ids hardcodeados.
--   · NO toca notificaciones VIGENTES: una convocatoria de un partido FUTURO
--     (starts_at >= now) sigue 'pending' — se resolverá al leerla como siempre.
--   · Idempotente: el filtro status = 'pending' hace que una 2ª pasada afecte 0
--     filas (las ya saneadas quedan en 'sent').
--
-- El UPDATE corre como owner (migración): el trigger notifications_protect_update
-- solo restringe transiciones cuando auth.uid() no es NULL (rol authenticated);
-- en migración auth.uid() es NULL, así que pending → sent es válido.

update public.notifications n
   set status  = 'sent',
       sent_at = now()
 where n.channel = 'in_app'
   and n.status  = 'pending'
   and n.type in ('callup_published', 'callup_updated')
   and (
     -- sin referencia a evento
     nullif(n.payload->>'event_id', '') is null
     -- evento borrado
     or not exists (
       select 1 from public.events e
        where e.id = (n.payload->>'event_id')::uuid
     )
     -- partido ya jugado (pasado)
     or exists (
       select 1 from public.events e
        where e.id = (n.payload->>'event_id')::uuid
          and e.starts_at < now()
     )
   );
