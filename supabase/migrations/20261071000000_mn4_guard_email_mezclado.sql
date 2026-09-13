-- ════════════════════════════════════════════════════════════════════════════
-- MN-4 · El agujero de `players.invite_email`, acotado.
--
-- QUÉ ES EL AGUJERO. `players.invite_email` es el correo al que el club manda la
-- invitación de tutor: se escribe desde el alta de jugador y desde la importación
-- de plantilla, y `sendOrRenewTutorInvitation` crea con él una invitación
-- `player_relation='parent'|'guardian'`. Si quien lo rellena pone ahí la dirección
-- DEL PROPIO JUGADOR, el chaval acepta y queda registrado como tutor de sí mismo:
-- desde ese momento firma sus propios consentimientos, ve la ficha médica y puede
-- pedir la supresión — los cuatro bloques que MN-1 reservó al tutor.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE ───────────────────────────────────────────
-- No detecta quién hay detrás de un correo. No es comprobable desde la base de
-- datos y cualquier promesa en esa dirección sería falsa: una dirección puede ser
-- de la madre, del hijo, o compartida por los dos, y las tres cosas se ven igual.
--
-- El cierre de verdad del agujero no es un guard: es que desde MN-2 EXISTE la vía
-- buena. Antes, un padre que quisiera que su hijo entrase no tenía más camino que
-- poner el correo del crío donde iba el suyo. Ahora tiene `invite_player_self`.
--
-- ── LO QUE SÍ HACE ──────────────────────────────────────────────────────────
-- Cerrar la contradicción que sí es medible: que la MISMA dirección figure, para
-- el MISMO jugador, como tutor y como cuenta propia. Eso no es ambiguo — es un
-- tutor haciéndose hijo de sí mismo, o al revés — y a partir de aquí se rechaza.
--
-- Se mira contra dos poblaciones, porque las dos acaban siendo lo mismo:
--   · las CUENTAS ya vinculadas (`player_accounts` + el correo de `auth.users`)
--   · las INVITACIONES VIVAS (pendientes y sin caducar) del mismo jugador
-- Una invitación caducada o ya superseded NO bloquea: un error de tecleo no puede
-- envenenar una dirección para siempre.
--
-- ── DÓNDE VIVE, Y POR QUÉ AHÍ ───────────────────────────────────────────────
-- En un TRIGGER sobre `invitations`, que es el punto común real: por ahí pasan el
-- alta de jugador, la importación de plantilla, `inviteBatch`, el reenvío desde la
-- ficha y `invite_player_self`. Un guard en cada llamante habría dejado fuera al
-- que se escriba mañana. Es la misma lección de BC-3 que nos costó el predicado
-- duplicado de `preview_account_deletion` en MN-BC.
--
-- El predicado, sin embargo, se escribe UNA vez —`player_email_relation_conflict`—
-- y lo llaman dos: el trigger, que es la red que no se puede esquivar, y
-- `invite_player_self`, que lo consulta ANTES para poder fallar con el tutor
-- delante en vez de reventar en el INSERT detrás de otros gates.
--
-- ── UN NOMBRE DE ERROR QUE CAMBIA ───────────────────────────────────────────
-- `invite_player_self` levantaba `email_is_tutor` con este mismo predicado escrito
-- a mano. Pasa a levantar `email_relation_conflict`, que es el nombre del único
-- sitio donde vive ahora. Se puede hacer sin coste porque ningún código de la app
-- lo consume todavía: MN-5, que es quien mapeará estos errores a texto, aún no
-- está escrito (comprobado con grep sobre apps/ y packages/).
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EL PREDICADO — escrito una vez
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_email_relation_conflict(
  p_player_id uuid,
  p_email text,
  p_relation text,
  p_exclude_invitation uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_quiere_self boolean;
begin
  -- Sin los tres datos no hay contradicción que medir. Y una relación fuera del
  -- catálogo no se interpreta: la rechaza el CHECK de la columna, no esto.
  if p_player_id is null or v_email = ''
     or p_relation is null or p_relation not in ('parent', 'guardian', 'self') then
    return false;
  end if;

  v_quiere_self := (p_relation = 'self');

  -- (A) Una CUENTA ya vinculada con esa dirección, en el papel contrario.
  if exists (
    select 1
      from public.player_accounts pa
      join auth.users u on u.id = pa.profile_id
     where pa.player_id = p_player_id
       and lower(btrim(u.email)) = v_email
       and case
             when v_quiere_self then pa.relation in ('parent', 'guardian')
             else pa.relation = 'self'
           end
  ) then
    return true;
  end if;

  -- (B) Una INVITACIÓN VIVA con esa dirección, en el papel contrario. Viva =
  -- pendiente y sin caducar: lo que está a punto de convertirse en (A).
  if exists (
    select 1
      from public.invitations i
     where i.player_id = p_player_id
       and lower(btrim(i.email)) = v_email
       and i.accepted_at is null
       and i.expires_at > now()
       and (p_exclude_invitation is null or i.id <> p_exclude_invitation)
       and case
             when v_quiere_self then i.player_relation in ('parent', 'guardian')
             else i.player_relation = 'self'
           end
  ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.player_email_relation_conflict(uuid, text, text, uuid) is
  'MN-4 · true si esa dirección ya figura, para ese jugador, en el papel contrario '
  '(tutor vs cuenta propia). Mira cuentas vinculadas e invitaciones vivas. NO dice '
  'quién hay detrás del correo: eso no se puede saber desde la base de datos.';

-- Nadie la llama desde una sesión: la usan el trigger (que corre con el rol de la
-- tabla) y una RPC `security definer`. Los privilegios por defecto de Supabase se
-- conceden POR NOMBRE a anon y authenticated, así que quitarlos de PUBLIC no basta.
revoke all on function public.player_email_relation_conflict(uuid, text, text, uuid) from public;
revoke all on function public.player_email_relation_conflict(uuid, text, text, uuid) from anon;
revoke all on function public.player_email_relation_conflict(uuid, text, text, uuid) from authenticated;
grant execute on function public.player_email_relation_conflict(uuid, text, text, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LA RED — el trigger sobre `invitations`
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.invitations_assert_relation_not_mixed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Invitación que no va sobre un jugador (staff, seguidor sin player): nada que mirar.
  if new.player_id is null or new.player_relation is null then
    return new;
  end if;

  -- `new.id` se excluye para que un UPDATE de la propia fila no se vea a sí mismo.
  if public.player_email_relation_conflict(
       new.player_id, new.email, new.player_relation, new.id) then
    raise exception 'email_relation_conflict';
  end if;

  return new;
end;
$$;

drop trigger if exists invitations_relation_not_mixed_check on public.invitations;

create trigger invitations_relation_not_mixed_check
  before insert or update of email, player_id, player_relation
  on public.invitations
  for each row
  execute function public.invitations_assert_relation_not_mixed();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `invite_player_self` — el predicado escrito a mano pasa a ser una llamada
--
-- Cuerpo reproducido desde su definición VIVA (`pg_get_functiondef`). El único
-- cambio contra ella es el bloque de `email_is_tutor`. `CREATE OR REPLACE`
-- conserva el ACL que le puso MN-2 (ni PUBLIC ni anon; authenticated y service_role).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_player_self(p_player_id uuid, p_email text)
 RETURNS TABLE(id uuid, token uuid, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_season uuid;
  v_email  text := lower(btrim(p_email));
  v_erased timestamptz;
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

  -- Temporada activa: es con la que sella el alta, así que es contra la que se mide.
  v_season := public.active_season_id(v_club);
  if v_season is null then
    raise exception 'no_active_season';
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
    raise exception 'consents_required';
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
$function$
;
