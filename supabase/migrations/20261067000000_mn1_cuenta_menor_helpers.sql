-- ════════════════════════════════════════════════════════════════════════════
-- MN-1 · La cuenta propia del MENOR. Separar `self` de «tutor» en el punto común.
--
-- HOY `user_is_tutor_of_player` miente: se llama «tutor» y devuelve true también para
-- `relation='self'`. No nació así. La creó F14-3b con `relation in ('parent','guardian')`
-- y su comentario decía, literalmente, «relation=self NO cuenta». Fue la migración
-- 20261038 la que añadió 'self', y lo hizo con un motivo explícito y acotado: que el
-- jugador ADULTO vinculado a su propia ficha gestionara **sus** cuatro secciones — foto,
-- médica, expediente y derecho al olvido.
--
-- Ese motivo sigue siendo bueno. Lo que cambia es que `self` deja de significar «adulto»:
-- con la cuenta propia del menor, un `self` puede tener 11 años. Y Jose reserva al tutor
-- exactamente esas cuatro secciones MENOS la foto, y solo mientras el jugador sea menor.
--
-- ── POR QUÉ TRES HELPERS Y NO UN PARÁMETRO ──────────────────────────────────
-- Un `user_is_tutor_of_player(id, include_self => true)` deja UN nombre para DOS preguntas
-- distintas: leyendo la política no sabrías cuál se está haciendo. Y con valor por defecto,
-- cualquiera de los 18 sitios que se olvide conserva el comportamiento viejo EN SILENCIO.
-- Con nombres distintos, el sitio dice qué pregunta.
--
-- ── POR QUÉ LA EDAD SE CALCULA EN VIVO ──────────────────────────────────────
-- `players.date_of_birth` es NOT NULL y está al 100% (40/40 medido en producción), así que
-- la minoría de edad se deriva y no se almacena. A las 00:00 del 18º cumpleaños la misma
-- consulta responde distinto: sin trigger, sin cron, sin estado que respaldar ni que se
-- quede atascado. (`profiles.date_of_birth`, en cambio, está al 32% y no sirve para gatear.)
--
-- ── LA LECCIÓN DE BC-3 ──────────────────────────────────────────────────────
-- La lógica va en el punto común, no en los llamantes. Por eso esta migración además
-- BORRA el `or exists (... relation='self')` escrito a mano en `invite_spectator`,
-- `list_player_spectators`, `remove_spectator` y `player_spectators_select`: son cuatro
-- copias del mismo predicado y pasan a llamar al helper.
--
-- ── ALCANCE ─────────────────────────────────────────────────────────────────
-- 18 objetos re-apuntados: 13 funciones y 5 políticas. Cada cuerpo se reproduce desde su
-- definición VIVA (`pg_get_functiondef`); lo único que cambia en cada uno es a qué helper
-- llama. No cambia el comportamiento de nadie en producción hoy: el único `relation='self'`
-- vivo es una fila de fixture, que se retira en su propio PR.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LOS HELPERS — el punto común
-- ─────────────────────────────────────────────────────────────────────────────

-- Vuelve a su significado original: SOLO padre/madre/tutor legal.
create or replace function public.user_is_tutor_of_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.player_accounts pa
    where pa.player_id = p_player_id
      and pa.profile_id = auth.uid()
      and pa.relation in ('parent', 'guardian')
  );
$$;

comment on function public.user_is_tutor_of_player(uuid) is
  'MN-1: true si el user actual es TUTOR vinculado (relation parent/guardian). relation=self NO cuenta — para eso está user_is_player_self. Vuelve al significado con el que nació en F14-3b.';

-- El propio jugador, tenga la edad que tenga.
create or replace function public.user_is_player_self(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.player_accounts pa
    where pa.player_id = p_player_id
      and pa.profile_id = auth.uid()
      and pa.relation = 'self'
  );
$$;

comment on function public.user_is_player_self(uuid) is
  'MN-1: true si el user actual ES el jugador (player_accounts.relation = self). No dice nada de su edad.';

-- Minoría de edad DERIVADA. date_of_birth es NOT NULL, así que no hay rama nula.
create or replace function public.player_is_minor(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and p.date_of_birth > (current_date - interval '18 years')
  );
$$;

comment on function public.player_is_minor(uuid) is
  'MN-1: true si el jugador es menor de 18 HOY. Se calcula en vivo sobre players.date_of_birth (NOT NULL): el 18º cumpleaños cambia la respuesta solo, sin trigger ni cron. Un jugador inexistente devuelve false.';

-- SUPERFICIE COMPARTIDA: lo que el menor hace igual que su tutor.
create or replace function public.user_manages_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_is_tutor_of_player(p_player_id)
      or public.user_is_player_self(p_player_id);
$$;

comment on function public.user_manages_player(uuid) is
  'MN-1: tutor O el propio jugador. Superficie COMPARTIDA (foto, seguidores, contacto, y la exención de auditoría por ser «familia»).';

-- SUPERFICIE RESERVADA: los cuatro bloques que Jose deja al tutor mientras haya minoría.
-- El jugador ADULTO self sigue gestionando lo suyo, que es lo que decidió la 20261038.
create or replace function public.user_manages_player_sensitive(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_is_tutor_of_player(p_player_id)
      or (
        public.user_is_player_self(p_player_id)
        and not public.player_is_minor(p_player_id)
      );
$$;

comment on function public.user_manages_player_sensitive(uuid) is
  'MN-1: superficie RESERVADA — médica, supresión del jugador, export RGPD y consentimientos SOBRE el jugador. Tutor siempre; el propio jugador SOLO si ya es mayor de edad. Al cumplir 18 se abre sola.';

-- Supabase concede por NOMBRE a anon/authenticated en objetos nuevos: se replica el ACL
-- que ya tienen los helpers vivos (execute para anon, authenticated y service_role) en
-- lugar de dejar el default a medias. Son STABLE y solo leen; el gate real lo pone quien
-- las llama.
revoke all on function public.user_is_player_self(uuid) from public;
revoke all on function public.player_is_minor(uuid) from public;
revoke all on function public.user_manages_player(uuid) from public;
revoke all on function public.user_manages_player_sensitive(uuid) from public;

grant execute on function public.user_is_player_self(uuid) to anon, authenticated, service_role;
grant execute on function public.player_is_minor(uuid) to anon, authenticated, service_role;
grant execute on function public.user_manages_player(uuid) to anon, authenticated, service_role;
grant execute on function public.user_manages_player_sensitive(uuid) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SUPERFICIE RESERVADA (5 objetos) — médica, supresión, RGPD, consentimientos
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 · Médica (escritura). Cuerpo vivo; solo cambia el helper.
create or replace function public.set_player_medical(p_player_id uuid, p_allergies text, p_medication text, p_medical_conditions text, p_emergency_contact text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'no_session'; end if;
  if not (public.user_manages_player_sensitive(p_player_id) and public.user_has_medical_consent_write(p_player_id)) then
    raise exception 'forbidden';
  end if;
  insert into public.player_medical (player_id, allergies, medication, medical_conditions, emergency_contact)
  values (p_player_id,
    nullif(btrim(coalesce(p_allergies,'')),''), nullif(btrim(coalesce(p_medication,'')),''),
    nullif(btrim(coalesce(p_medical_conditions,'')),''), nullif(btrim(coalesce(p_emergency_contact,'')),''))
  on conflict (player_id) do update set
    allergies=excluded.allergies, medication=excluded.medication,
    medical_conditions=excluded.medical_conditions, emergency_contact=excluded.emergency_contact;
end; $function$;

-- 2.2 · Médica (puerta de lectura). Cierra también get_player_medical, que se gatea aquí.
create or replace function public.user_can_access_player_medical(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- dirección / admin del club del jugador
    public.user_is_admin_or_director(
      (select club_id from public.players where id = p_player_id)
    )
    -- staff de un equipo ACTIVO del jugador (equipo base) — scope EQUIPO
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = p_player_id
        and tm.left_at is null
        and public.user_is_staff_of_team(tm.team_id)
    )
    -- staff de un equipo que lo tiene PROMOCIONADO (mientras exista la subida)
    or exists (
      select 1 from public.player_promotions pp
      where pp.player_id = p_player_id
        and public.user_is_staff_of_team(pp.team_id)
    )
    -- tutor vinculado, o el propio jugador SI ya es mayor de edad (MN-1)
    or public.user_manages_player_sensitive(p_player_id);
$function$;

-- 2.3 · Supresión del jugador.
create or replace function public.request_player_erasure(p_player_id uuid, p_reason text DEFAULT NULL::text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;
  if not public.user_manages_player_sensitive(p_player_id) then
    raise exception 'forbidden';
  end if;

  select club_id into v_club from public.players where id = p_player_id;
  if v_club is null then
    raise exception 'player_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('erasure_req:' || p_player_id::text));

  -- Idempotente: si ya hay una pendiente, se devuelve sin crear otra ni auditar.
  select id into v_existing from public.erasure_requests
   where player_id = p_player_id and status = 'pending' limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.erasure_requests (player_id, club_id, requested_by, reason)
  values (p_player_id, v_club, v_uid, nullif(btrim(p_reason), ''))
  returning id into v_id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'erasure.requested', 'player', p_player_id, v_club, nullif(btrim(p_reason), ''));

  return v_id;
end;
$function$;

-- 2.4 · Export RGPD. El comentario vivo ya decía «solo el tutor (parent/guardian)»:
--        con el helper viejo eso era falso desde la 20261038. Ahora vuelve a ser cierto.
create or replace function public.record_data_export(p_player_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_erased timestamptz;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Solo el tutor (parent/guardian) del jugador puede registrar el export; el propio
  -- jugador, solo si ya es mayor de edad (MN-1). Misma puerta de identidad que
  -- F14-6/F14-7, NO el rol de club.
  if not public.user_manages_player_sensitive(p_player_id) then
    raise exception 'forbidden';
  end if;

  select club_id, erased_at into v_club, v_erased from public.players where id = p_player_id;
  if v_club is null then
    raise exception 'player_invalid';
  end if;
  -- Jugador suprimido (F14-7): su ficha es inaccesible → tampoco se audita/exporta.
  if v_erased is not null then
    raise exception 'erased';
  end if;

  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- UNA sola entrada por descarga (regla 8). reason NULL (evento automático).
  insert into public.audit_log (
    actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
  ) values (
    v_uid, 'data.export', 'player', p_player_id, v_club,
    v_ip, nullif(btrim(p_user_agent), ''), null
  );
end;
$function$;

-- 2.5 · Consentimientos. OJO: la política NO se reserva entera.
--
-- Su rama `player_id IS NULL` no es un consentimiento SOBRE el jugador: son los términos
-- y la privacidad de la PROPIA CUENTA de quien firma. Si se reservara la política
-- completa, el menor no podría aceptar los términos de su cuenta y no podría darse de
-- alta. Lo reservado es el consentimiento CON player_id.
drop policy if exists "consents_insert_own" on public.consents;
create policy "consents_insert_own"
  on public.consents
  for insert
  to authenticated
  with check (
    tutor_profile_id = auth.uid()
    and (
      player_id is null
      or public.user_manages_player_sensitive(player_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SUPERFICIE COMPARTIDA (13 objetos) — lo que el menor hace igual que su tutor
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 · Foto: la RPC.
create or replace function public.set_player_photo(p_player_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'no_session';
  end if;
  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;
  -- Solo la columna photo_url. p_path NULL = se retira la foto.
  update public.players set photo_url = p_path where id = p_player_id;
end;
$function$;

-- 3.2 · Foto: el trigger que obliga a pasar por la RPC.
create or replace function public.players_guard_photo_url()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.photo_url is distinct from OLD.photo_url then
    if NEW.erased_at is not null and NEW.photo_url is null then
      return NEW;
    end if;
    if auth.uid() is not null and not public.user_manages_player(NEW.id) then
      raise exception 'photo_url solo la gestiona el tutor vinculado o el propio jugador (usa set_player_photo)';
    end if;
  end if;
  return NEW;
end;
$function$;

-- 3.3-3.5 · Foto: las tres políticas de Storage. El nombre conserva el sufijo `_tutor`
--           por no arrastrar un rename a tres políticas de un esquema ajeno; el censo de
--           pgTAP afirma a qué helper apunta cada una, que es la protección de verdad.
drop policy if exists "player_photos_insert_tutor" on storage.objects;
create policy "player_photos_insert_tutor"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'player-photos'
    and public.user_manages_player(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "player_photos_update_tutor" on storage.objects;
create policy "player_photos_update_tutor"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_manages_player(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'player-photos'
    and public.user_manages_player(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "player_photos_delete_tutor" on storage.objects;
create policy "player_photos_delete_tutor"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_manages_player(((storage.foldername(name))[1])::uuid)
  );

-- 3.6 · Contacto: la puerta de get_player_phone y get_player_tutors_contact.
--       Decisión 3 de Jose: el menor ve el contacto de sus tutores.
create or replace function public.user_can_access_player_contact(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(
      (select club_id from public.players where id = p_player_id)
    ) in (
      'admin_club', 'director', 'coordinador',
      'entrenador_principal', 'entrenador_ayudante'
    ),
    false
  )
  or public.user_manages_player(p_player_id);
$function$;

-- 3.7-3.9 · Las TRES de auditoría. Aquí el helper NO autoriza: decide si la lectura deja
--           rastro en `audit_log`. La lectura de la familia no se audita; la de un tercero
--           sí. Decisión 2 de Jose: el menor es FAMILIA, así que leyendo lo suyo no deja
--           rastro, igual que su tutor.

create or replace function public.get_player_medical(p_player_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
returns TABLE(allergies text, medication text, medical_conditions text, emergency_contact text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.player_medical%rowtype;
  v_club uuid;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- F14-7 — jugador suprimido: sin médica (además la fila ya se borró al aprobar).
  if exists (select 1 from public.players where id = p_player_id and erased_at is not null) then
    return;
  end if;

  -- La PUERTA es la reservada (user_can_access_player_medical): un menor self no pasa.
  if not coalesce(
    public.user_can_access_player_medical(p_player_id)
    and public.user_has_medical_consent_read(p_player_id)
  , false) then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.player_medical where player_id = p_player_id;

  if v_row.player_id is null or (
       v_row.allergies is null
   and v_row.medication is null
   and v_row.medical_conditions is null
   and v_row.emergency_contact is null
  ) then
    return;
  end if;

  -- La EXENCIÓN de auditoría es la compartida: familia no deja rastro.
  if not public.user_manages_player(p_player_id) then
    select club_id into v_club from public.players where id = p_player_id;
    begin
      v_ip := nullif(btrim(p_ip), '')::inet;
    exception when others then
      v_ip := null;
    end;
    insert into public.audit_log (
      actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
    ) values (
      v_uid,
      case when public.is_superadmin() then 'medical.read.platform' else 'medical.read' end,
      'player_medical', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return query
    select v_row.allergies, v_row.medication, v_row.medical_conditions, v_row.emergency_contact;
end;
$function$;

create or replace function public.get_player_phone(p_player_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text;
  v_club  uuid;
  v_ip    inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Suprimido o inexistente: nada, y sin distinguir uno de otro.
  select p.phone, p.club_id into v_phone, v_club
    from public.players p
   where p.id = p_player_id and p.erased_at is null;
  if v_club is null then
    return null;
  end if;

  if not public.user_can_access_player_contact(p_player_id) then
    raise exception 'forbidden';
  end if;

  if v_phone is null then
    return null;   -- nada que enseñar, nada que auditar
  end if;

  if not public.user_manages_player(p_player_id) then
    begin
      v_ip := nullif(btrim(p_ip), '')::inet;
    exception when others then
      v_ip := null;
    end;
    insert into public.audit_log (
      actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
    ) values (
      v_uid,
      case when public.is_superadmin() then 'contact.read.platform' else 'contact.read' end,
      'player_contact', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return v_phone;
end;
$function$;

create or replace function public.get_player_tutors_contact(p_player_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
returns TABLE(tutor_profile_id uuid, full_name text, relation text, email text, phone text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_club uuid;
  v_ip   inet;
  v_hay  boolean;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Jugador suprimido: sin contacto. Igual que la ficha médica.
  if exists (select 1 from public.players where id = p_player_id and erased_at is not null) then
    return;
  end if;

  if not public.user_can_access_player_contact(p_player_id) then
    raise exception 'forbidden';
  end if;

  select exists (
    select 1 from public.player_accounts pa where pa.player_id = p_player_id
  ) into v_hay;
  if not v_hay then
    return;   -- sin tutores vinculados no hay nada que enseñar ni que auditar
  end if;

  if not public.user_manages_player(p_player_id) then
    select club_id into v_club from public.players where id = p_player_id;
    begin
      v_ip := nullif(btrim(p_ip), '')::inet;
    exception when others then
      v_ip := null;
    end;
    insert into public.audit_log (
      actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
    ) values (
      v_uid,
      case when public.is_superadmin() then 'contact.read.platform' else 'contact.read' end,
      'player_contact', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return query
    select pa.profile_id, pr.full_name, pa.relation, u.email::text, pr.phone
      from public.player_accounts pa
      join public.profiles pr on pr.id = pa.profile_id
      join auth.users    u  on u.id  = pa.profile_id
     where pa.player_id = p_player_id
     order by pa.relation, pr.full_name;
end;
$function$;

-- 3.10-3.13 · Seguidores. Decisión 1 de Jose: el menor invita y revoca igual que el tutor.
--             Las cuatro llevaban el `or exists (... relation='self')` escrito a mano —
--             cuatro copias del mismo predicado. Se retiran: la lógica va en el helper.

create or replace function public.invite_spectator(p_player_id uuid, p_email text)
returns TABLE(id uuid, token uuid, email text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_email text := lower(btrim(p_email));
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate estricto: SOLO el tutor del jugador o el propio jugador.
  -- Ni admin, ni otro seguidor. Un seguidor NO invita a otro seguidor.
  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email';
  end if;

  select club_id into v_club from public.players where players.id = p_player_id;
  if v_club is null then
    raise exception 'forbidden';
  end if;

  -- Reinvitable: supersede las invitaciones de seguidor PENDIENTES del mismo
  -- (email, jugador) — como invitations no tiene unique, borramos las previas.
  delete from public.invitations i
  where i.role = 'spectator'
    and i.player_id = p_player_id
    and lower(btrim(i.email)) = v_email
    and i.accepted_at is null;

  return query
  insert into public.invitations (email, club_id, role, player_id, created_by)
  values (v_email, v_club, 'spectator', p_player_id, v_uid)
  returning invitations.id, invitations.token, invitations.email;
end;
$function$;

create or replace function public.list_player_spectators(p_player_id uuid)
returns TABLE(spectator_profile_id uuid, full_name text, email text, created_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate IDÉNTICO a invite_spectator/remove_spectator: SOLO el tutor del jugador
  -- o el propio jugador. Nadie más (ni admin, ni otro seguidor).
  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  return query
  select
    ps.spectator_profile_id,
    pr.full_name,
    au.email::text,
    ps.created_at
  from public.player_spectators ps
  left join public.profiles pr on pr.id = ps.spectator_profile_id
  left join auth.users au on au.id = ps.spectator_profile_id
  where ps.player_id = p_player_id
  order by ps.created_at asc;
end;
$function$;

create or replace function public.remove_spectator(p_player_id uuid, p_spectator_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  delete from public.player_spectators ps
  where ps.player_id = p_player_id
    and ps.spectator_profile_id = p_spectator_profile_id;
end;
$function$;

drop policy if exists "player_spectators_select" on public.player_spectators;
create policy "player_spectators_select"
  on public.player_spectators
  for select
  to authenticated
  using (
    spectator_profile_id = auth.uid()
    or public.user_manages_player(player_id)
    or public.user_is_admin_or_director(
         (select p.club_id from public.players p where p.id = player_spectators.player_id)
       )
  );
