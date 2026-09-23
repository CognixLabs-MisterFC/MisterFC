-- RC-A — el tutor que tiene un borrado de cuenta EN CURSO no puede crear la cuenta
-- propia de su hijo.
--
-- EL AGUJERO, medido entero contra produccion antes de escribir esto:
--
--   1. El tutor pide el borrado. Su hijo aun no tiene cuenta, asi que el candado de
--      la 20261101000000 —que impide pedirlo dejando a un menor con la suya— le deja
--      pasar. Correcto.
--   2. Durante los 30 dias de plazo invita a su hijo. `invite_player_self` NO mira si
--      hay un borrado en curso: la invitacion se crea.
--   3. El hijo acepta. El candado de BC-6 frena a QUIEN ACEPTA teniendo un borrado
--      propio pendiente, y el que lo tiene pendiente es el padre, no el crio.
--   4. Vence el plazo. Medido: `player_self_account_status` devolvia 'none' y
--      `invite_player_self` devolvia la invitacion creada, con el borrado ya pedido.
--
-- La 20261102000000 (RC-B) cierra la salida: al rematar, el menor que se quedaria sin
-- ningun tutor pierde su cuenta. Esto cierra la ENTRADA, que es lo barato y lo que
-- evita crear algo para retirarlo treinta dias despues. Las dos hacen falta: RC-B
-- cubre tambien las cuentas que ya existian antes de pedir el borrado por otras vias.
--
-- DONDE VA EL CANDADO, y por que no en `invite_player_self`.
--
-- El predicado tiene que decir lo mismo en los dos sitios donde se mira: la RPC que
-- crea la invitacion y la tarjeta que ofrece el boton. Escribirlo dos veces es la
-- forma conocida de que acaben diciendo dos cosas —es literalmente lo que dicen los
-- comentarios de MN-4 y MN-10 dentro de esta misma funcion—. Asi que va en
-- `player_self_invite_blocker`, el predicado compartido: la RPC ya lanza lo que el
-- blocker devuelva y la tarjeta ya lo pinta. Ni `invite_player_self` ni
-- `player_self_account_status` se tocan.
--
-- LO QUE ESO CAMBIA, dicho claro: el blocker recibe un jugador y hasta hoy medía solo
-- al jugador. A partir de aqui tambien mira a QUIEN PREGUNTA. Es admisible porque sus
-- DOS unicos consumidores ya son del que pregunta (los dos leen `auth.uid()` y los dos
-- gatean por el llamante), y porque al blocker solo llega un TUTOR: en
-- `player_self_account_status` el propio jugador se va antes por la rama 'linked' —si
-- no tuviera cuenta propia, no seria 'self' y no pasaria el gate—. Queda comprobado en
-- el pgTAP [8]. Un tercer consumidor que no sea del llamante NO puede usar esta
-- funcion sin volver a mirar esto.
--
-- (`grant_player_consent` aparece si se busca el nombre en los cuerpos de produccion,
-- pero solo la NOMBRA en un comentario: no la llama.)
--
-- No se crea ningun objeto nuevo: `my_account_deletion_status()` ya existe, ya es del
-- llamante y ya devuelve solo las peticiones en estado 'pending'. Una peticion
-- cancelada o ya rematada no esta 'pending', asi que desbloquea sola.
--
-- ORDEN: el motivo nuevo va PRIMERO, antes que 'erased' y que los consentimientos.
-- Es el unico que no se arregla arreglando al jugador: mandar al tutor a firmar los
-- consentimientos de imagen para desbloquear un boton que su propio borrado tiene
-- cerrado es mandarle a perder el tiempo.
--
-- El valor nuevo, 'account_deletion_pending', sale por los dos sitios: como excepcion
-- de `invite_player_self` y como estado de `player_self_account_status`. El cliente
-- todavia no lo conoce, y eso NO deja un boton muerto: `getSelfAccountStatusFromClient`
-- devuelve `null` ante un valor que no reconoce y `null` significa «no ofrecer».
-- Degrada cerrado — el boton desaparece, sin explicacion. Ponerle texto es el PR
-- siguiente, de codigo, que aqui no cabe: las migraciones van separadas.

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
  -- RC-A — QUIEN PREGUNTA tiene un borrado de cuenta en curso. Va lo primero: es el
  -- unico motivo de esta lista que no depende del jugador y el unico que no se
  -- desbloquea arreglando nada del jugador.
  if exists (select 1 from public.my_account_deletion_status()) then
    return 'account_deletion_pending';
  end if;

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
  'MN-10 + RC-A. Primer motivo por el que invite_player_self se negaria con el tutor delante (account_deletion_pending | erased | no_active_season | consents_required), o null. OJO: account_deletion_pending mide a QUIEN LLAMA, no al jugador. Interno: lo consultan invite_player_self y player_self_account_status, no el cliente.';
