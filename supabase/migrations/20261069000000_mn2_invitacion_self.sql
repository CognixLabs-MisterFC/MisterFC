-- ════════════════════════════════════════════════════════════════════════════
-- MN-2 · La invitación del TUTOR a su hijo. La vía buena, por fin.
--
-- El bloqueo de `self` vivía en TRES capas y abrir una sola no hacía nada:
--   1. el enum de TypeScript `PLAYER_TUTOR_RELATIONS = ['parent','guardian']`  → PR de app
--   2. el CHECK `invitations_player_relation_check`, que solo admite esos dos  → AQUÍ
--   3. quién puede hacer el INSERT: `invitations_insert_admin` lo deja en
--      admin_club/director, así que una familia no podía crear invitaciones    → AQUÍ
--
-- Esta migración abre la 2 y rodea la 3 con una RPC `security definer`, que es el mismo
-- patrón con el que `invite_spectator` puso la invitación de seguidor en manos de la
-- familia sin tocar la política.
--
-- ── LA PRECONDICIÓN, Y POR QUÉ VA AL INVITAR ────────────────────────────────
-- `accept_pending_invitations` exige, para un rol 'jugador', una DECISIÓN de imagen
-- (`image_internal` e `image_social`) y la sella a nombre de quien acepta. Si acepta el
-- menor, firmaría él lo que debe firmar su tutor.
--
-- MN-3 resolverá eso omitiendo el bloque de imagen en las invitaciones `self` — no
-- copiando las filas del tutor, que falsificaría la fecha del ledger. Pero omitir solo
-- vale si esas filas YA EXISTEN. Así que la exigencia se adelanta aquí: el tutor no puede
-- invitar a su hijo si el jugador no tiene sus decisiones de imagen en regla. Falla antes,
-- con el tutor delante, que es quien puede arreglarlo — y no a mitad del alta del menor.
--
-- «En regla» = existe la decisión en la temporada activa, que es la temporada con la que
-- `accept_pending_invitations` sella. Es una DECISIÓN, no un permiso: vale tanto
-- `granted = true` como `false`; lo que no vale es que no la haya.
--
-- ── ORDEN DE APLICACIÓN ─────────────────────────────────────────────────────
-- MN-2 y MN-3 van juntas. Entre una y otra existe una ventana teórica: una invitación
-- `self` aceptada todavía pasaría por el bloque de imagen del alta y sellaría los
-- consentimientos a nombre del menor. No hay forma de llegar ahí desde la aplicación
-- (la pantalla que envía esta invitación es un PR posterior), pero conviene no dejar
-- la ventana abierta más de lo necesario.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CAPA 2 — el CHECK admite 'self'
--
-- `invitations_player_role_consistency` NO se toca: su rama
-- (role='jugador' AND player_id IS NOT NULL AND player_relation IS NOT NULL) ya
-- describe exactamente la forma de una invitación self.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.invitations
  drop constraint if exists invitations_player_relation_check;

alter table public.invitations
  add constraint invitations_player_relation_check
  check (
    player_relation is null
    or player_relation = any (array['parent'::text, 'guardian'::text, 'self'::text])
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CAPA 3 — la RPC, en manos del tutor
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.invite_player_self(p_player_id uuid, p_email text)
returns table(id uuid, token uuid, email text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- El correo de un TUTOR del jugador no puede recibir la invitación de cuenta propia:
  -- sería el tutor haciéndose hijo de sí mismo. (La dirección contraria —el correo del
  -- menor usado como email de tutor— la cierra MN-4.)
  if exists (
    select 1
      from public.player_accounts pa
      join auth.users u on u.id = pa.profile_id
     where pa.player_id = p_player_id
       and pa.relation in ('parent', 'guardian')
       and lower(btrim(u.email)) = v_email
  ) then
    raise exception 'email_is_tutor';
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
$function$;

comment on function public.invite_player_self(uuid, text) is
  'MN-2: el TUTOR invita a su hijo a tener cuenta propia (player_accounts.relation=self). Esa invitacion ES la autorizacion. Exige que el jugador tenga en regla las decisiones de imagen de la temporada activa: el alta del menor NO las va a pedir (MN-3), asi que tienen que existir antes.';

-- Mismo ACL que `invite_spectator`: ni PUBLIC ni anon. Los default privileges de
-- Supabase conceden POR NOMBRE, así que el revoke de PUBLIC no basta.
revoke all on function public.invite_player_self(uuid, text) from public;
revoke all on function public.invite_player_self(uuid, text) from anon;
grant execute on function public.invite_player_self(uuid, text) to authenticated, service_role;
