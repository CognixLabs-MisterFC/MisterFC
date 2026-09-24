-- A-1 · ENTREGA DE LAS INVITACIONES: donde se apunta que un correo no llego.
--
-- EL AGUJERO, medido el 2026-09-24. Se invito a `chaodis@fasdifgjodjc.es`, un dominio
-- que no existe (no resuelve ni A ni MX). Resend ACEPTO el envio —devolvio id, y por eso
-- la pantalla dijo "Invitacion enviada", con razon desde el punto de vista de la app— y
-- el correo no llego a ningun sitio. De los 75 envios de la cuenta, 74 dicen `delivered`
-- y ese es el UNICO que se quedo en `sent`.
--
-- Y no quedaba rastro por dos motivos independientes:
--   · Resend no tenia NINGUN webhook configurado (lista vacia en su API): nada nos podia
--     avisar.
--   · `invitations` no tenia donde apuntarlo: ni el id del envio se guardaba.
--
-- Lo que ve quien invita, hoy: el listado tiene tres estados —Pendiente, Aceptada,
-- Caducada— todos deducidos de `accepted_at` y `expires_at`. Una invitacion que reboto
-- se ve IDENTICA a una que esta en la bandeja de alguien sin abrir, y a los 7 dias pasa
-- a "Caducada", que se lee como "no la acepto" y no como "nunca le llego". El club
-- persigue a una familia que no ha recibido nada.
--
-- ESTA MIGRACION NO ARREGLA ESO TODAVIA: pone donde apuntarlo y quien lo apunta. Nada
-- escribe en estas columnas hasta A-2 (el webhook + los envios guardando el id), y nada
-- se ve hasta A-3 (el cuarto estado en la pantalla). El pgTAP comprueba que, aplicada,
-- ninguna invitacion cambia de estado.
--
-- Las firmas nuevas para `packages/core/src/supabase/database.ts` van en A-2, que es
-- cuando la app las usa por primera vez: aqui no entra codigo. Mismo criterio que SU-1,
-- y se anaden A MANO (un `pnpm db:types` completo borra los `| null` escritos a mano,
-- ver PR #404).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE COLUMNAS EN `invitations` Y NO UNA TABLA DE ENVIOS.
--
-- Un correo puede cubrir VARIAS invitaciones: `inviteBatch` manda UN solo correo por
-- grupo (tutor + email) con la primera invitacion de ancla, asi que un padre con dos
-- hijos recibe un correo que vale por dos filas. Y al reves, una invitacion puede
-- enviarse VARIAS veces (el reenvio desde la ficha renueva token y caducidad).
--
-- O sea que envio e invitacion son muchos-a-muchos, y el modelo "puro" seria una tabla
-- de envios mas otra de union. No se hace, a proposito: la pregunta que hay que
-- contestar es "¿llego el ULTIMO correo de esta invitacion?", y para eso basta con el
-- estado del ultimo envio en la propia fila. El precio es no guardar el historico de
-- envios anteriores, y se paga con gusto: nadie lo ha pedido y una tabla de union es
-- superficie nueva con su RLS que mantener.
--
-- Si algun dia hace falta el historico, esto no estorba: las columnas siguen siendo el
-- "estado actual" y la tabla se anade al lado.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.invitations
  -- Id del ULTIMO envio en Resend. Es la unica forma de casar el webhook con la fila:
  -- su payload trae `data.email_id`. Varias filas pueden compartirlo (los hermanos del
  -- mismo correo) y por eso NO es unico.
  add column delivery_message_id text,
  -- Estado del ultimo envio. SIN CHECK, y con el mismo motivo que `subscription_entitlements.store`
  -- (SU-1): los valores los pone RESEND, no nosotros. Si manana anaden un tipo de evento,
  -- un CHECK haria fallar la ingesta del webhook entero por un valor que solo habia que
  -- registrar. Quien no reconozca un valor es el cliente, y ya sabe ignorarlo.
  add column delivery_state text,
  -- El motivo, cuando lo hay: "Invalid domain", "Mailbox does not exist"… Es lo unico
  -- que convierte "no llego" en algo accionable.
  add column delivery_detail text,
  -- Cuando ocurrio el evento SEGUN RESEND, no cuando nos enteramos: es lo que permite
  -- ordenar eventos que llegan desordenados.
  add column delivery_at timestamptz;

comment on column public.invitations.delivery_message_id is
  'A-1 — id del ULTIMO envio en Resend. No unico: un mismo correo cubre a los hermanos.';
comment on column public.invitations.delivery_state is
  'A-1 — estado del ultimo envio segun Resend (sent | delivered | bounced | complained | delivery_delayed…). SIN CHECK a proposito: los valores los pone Resend.';
comment on column public.invitations.delivery_at is
  'A-1 — fecha del evento SEGUN RESEND. Los webhooks llegan desordenados; este campo es el que ordena.';

-- El webhook busca por aqui, y solo le interesan las filas que tienen envio.
create index invitations_delivery_message_idx
  on public.invitations (delivery_message_id)
  where delivery_message_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- apply_invitation_delivery_event — el unico que escribe estas columnas.
--
-- Vive en SQL y no en el handler por lo de siempre: la regla de orden escrita en
-- TypeScript seria una regla que solo se cumple si pasas por ese camino.
--
-- DOS CANDADOS, y los dos son por como entregan los webhooks:
--
--  1. NO PISAR CON UN EVENTO MAS VIEJO. Resend no garantiza el orden. Sin esto, un
--     `sent` rezagado llegando detras de un `delivered` haria retroceder el estado.
--
--  2. NO TAPAR UN FALLO. Una vez sabemos que reboto, ningun evento no-fallido vuelve a
--     ponerlo en `sent` o `delivered`, ni aunque venga con fecha posterior. El modo de
--     fallo de esta funcion tiene que ser "avisa de mas", nunca "esconde un rebote":
--     esconderlo devuelve exactamente al problema que A-1 existe para cerrar.
--
-- Devuelve cuantas filas ha tocado. Cero significa "este id no es de ninguna invitacion
-- nuestra" —un correo de otra cosa, o un envio anterior a A-2— y el handler tiene que
-- poder distinguirlo de un error.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_invitation_delivery_event(
  p_message_id text,
  p_state      text,
  p_detail     text,
  p_at         timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  if p_message_id is null or btrim(p_message_id) = '' or p_state is null then
    return 0;
  end if;

  with tocadas as (
    update public.invitations i
       set delivery_state  = p_state,
           delivery_detail = p_detail,
           delivery_at     = coalesce(p_at, now())
     where i.delivery_message_id = p_message_id
       -- candado 1: nada mas viejo que lo que ya hay
       and (i.delivery_at is null or coalesce(p_at, now()) >= i.delivery_at)
       -- candado 2: un fallo ya registrado no se tapa.
       --
       -- El `coalesce` NO es decorativo, y el caso es mas sutil de lo que parece. Con
       -- `delivery_state` nulo, `null in (...)` vale NULL. Entonces:
       --   · si el evento SI es un fallo, la otra mitad del AND es FALSE y el conjunto
       --     da FALSE: la fila entra. Por eso un bounce inicial funcionaba.
       --   · si el evento NO es un fallo —`sent`, `delivered`: el camino NORMAL—, la
       --     otra mitad es TRUE, el AND da NULL, el `not` da NULL y la fila se queda
       --     FUERA del WHERE sin que nada falle.
       -- O sea que sin el coalesce solo se registraban los rebotes y los envios buenos
       -- se perdian en silencio. Lo caza el bloque [7] del pgTAP.
       and not (
         coalesce(i.delivery_state, '') in ('bounced', 'complained')
         and p_state not in ('bounced', 'complained')
       )
    returning 1
  )
  select count(*) into v_n from tocadas;

  return v_n;
end;
$$;

revoke all on function public.apply_invitation_delivery_event(text, text, text, timestamptz) from public;
revoke all on function public.apply_invitation_delivery_event(text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.apply_invitation_delivery_event(text, text, text, timestamptz) to service_role;

comment on function public.apply_invitation_delivery_event(text, text, text, timestamptz) is
  'A-1 — aplica un evento de entrega de Resend a TODAS las invitaciones de ese envio. No pisa con eventos mas viejos y NUNCA tapa un bounce/complaint. Devuelve filas tocadas; 0 = id desconocido. Solo service_role: la llama el webhook.';
