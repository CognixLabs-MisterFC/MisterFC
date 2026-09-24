-- A-3 · QUE `failed` Y `suppressed` TAMBIEN SEAN PEGAJOSOS.
--
-- EL HUECO. A-1 protegio de que un evento no-fallido tapara un fallo ya registrado, pero
-- su lista de fallos eran solo dos: `bounced` y `complained`. Resend manda cuatro que
-- significan "no ha llegado y no va a llegar":
--
--   · `bounced`    — el servidor del destinatario lo rechazo para siempre
--   · `complained` — llego y lo marcaron como spam
--   · `failed`     — no salio siquiera (cuota agotada, error de la API)
--   · `suppressed` — Resend lo corto por su lista de supresion
--
-- Los dos ultimos NO estaban en la lista, asi que un evento posterior podia taparlos.
--
-- POR QUE SE CIERRA SI EN LA PRACTICA NO PASA. Es verdad que hoy a un `failed` no le
-- sigue ningun evento: si el correo no sale, no hay nada que entregar. Pero eso es una
-- propiedad del proveedor, no nuestra, y no esta escrita en ningun sitio donde podamos
-- verla romperse. A-3 va a pintar los cuatro como «No llego» en la pantalla, y en el
-- momento en que la pantalla trata cuatro estados igual, el candado que solo protege dos
-- deja de cuadrar con lo que la gente ve. La regla y lo que se ensena tienen que decir lo
-- mismo.
--
-- Y el modo de fallo sigue siendo el de A-1, que es el que manda: "avisa de mas", nunca
-- "esconde un fallo". Anadir estados a la lista solo puede hacer que un fallo se conserve
-- mas tiempo; nunca que uno se pierda.
--
-- LA LISTA VIVE UNA SOLA VEZ, en `k_terminales`. Antes estaba escrita DOS veces en el
-- mismo WHERE —una para el estado guardado y otra para el que llega— y dos listas que
-- tienen que decir lo mismo acaban diciendo cosas distintas. Ese es el unico cambio de
-- forma; el resto del cuerpo es identico al de A-1, verificado contra `pg_get_functiondef`
-- de produccion.
--
-- Sin `= any(...)` sobre un array habria que repetir el literal; con el, anadir un estado
-- manana es tocar una linea.

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
declare
  v_n integer;
  -- Los estados que significan "no llego y no va a llegar". Una vez registrado uno de
  -- estos, ningun evento que NO sea de esta lista vuelve a moverlo.
  k_terminales constant text[] := array['bounced', 'complained', 'failed', 'suppressed'];
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
       -- `delivery_state` nulo, una comparacion contra la lista vale NULL. Entonces:
       --   · si el evento SI es un fallo, la otra mitad del AND es FALSE y el conjunto
       --     da FALSE: la fila entra. Por eso un bounce inicial funcionaba.
       --   · si el evento NO es un fallo —`sent`, `delivered`: el camino NORMAL—, la
       --     otra mitad es TRUE, el AND da NULL, el `not` da NULL y la fila se queda
       --     FUERA del WHERE sin que nada falle.
       -- O sea que sin el coalesce solo se registraban los fallos y los envios buenos
       -- se perdian en silencio. Lo caza el bloque [7] del pgTAP de A-1.
       --
       -- `p_state` no necesita coalesce: arriba se ha devuelto 0 si era nulo.
       and not (
         coalesce(i.delivery_state, '') = any (k_terminales)
         and not (p_state = any (k_terminales))
       )
    returning 1
  )
  select count(*) into v_n from tocadas;

  return v_n;
end;
$$;

comment on function public.apply_invitation_delivery_event(text, text, text, timestamptz) is
  'A-1/A-3 — aplica un evento de entrega de Resend a TODAS las invitaciones de ese envio. No pisa con eventos mas viejos y NUNCA tapa un fallo (bounced, complained, failed, suppressed). Devuelve filas tocadas; 0 = id desconocido. Solo service_role: la llama el webhook.';
