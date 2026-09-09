-- Teléfonos de contacto — las dos columnas y quién puede leerlas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ RESUELVE
-- ------------
-- Hoy no existe ningún teléfono en la aplicación. Ni se pide en el alta del
-- tutor, ni en el perfil, ni en la ficha del jugador: lo único parecido es
-- `player_medical.emergency_contact`, que es texto libre, va POR NIÑO, depende
-- de que el tutor acepte el consentimiento médico y está vacío en producción.
-- Si a un niño le pasa algo en un entrenamiento, hoy el entrenador no tiene a
-- quién llamar.
--
--   · `profiles.phone` — el teléfono del TUTOR. Uno por persona.
--   · `players.phone`  — el teléfono del NIÑO. Uno por niño, opcional.
--
-- Las columnas nacen VACÍAS: esta migración no rellena ni un dato. Las
-- pantallas son otro paso.
--
-- POR QUÉ EL DEL TUTOR VA EN `profiles` Y NO EN `memberships`
-- -----------------------------------------------------------
-- `memberships.phone` ya existe (Bug 2 · 2c) y NO sirve aquí, por tres razones
-- que son de la base, no de estilo:
--
--   1. Es POR MEMBRESÍA. Un tutor con hijos en dos clubes tendría dos filas y
--      dos teléfonos que pueden discrepar. La decisión es «uno por persona».
--   2. Lo gestiona EL CLUB, no la persona: la única puerta de escritura es
--      `admin_update_staff_contact`, que exige ser `admin_club`. El teléfono
--      del tutor lo pone y lo cambia el tutor.
--   3. Es del CUERPO TÉCNICO por diseño: el listado que lo enseña sale de
--      `team_staff`, donde un tutor no está nunca.
--
-- `profiles` es la única tabla a nivel PERSONA (su PK es `auth.users.id`), y
-- ya trae la puerta de escritura hecha: la policy `profiles_update_self`
-- (`id = auth.uid()`) permite al tutor guardar su teléfono sin una sola línea
-- de SQL nueva, y a nadie más escribírselo.
--
-- POR QUÉ LA COLUMNA ES NULLABLE (y no `not null`)
-- ------------------------------------------------
-- La obligatoriedad es para ALTAS NUEVAS, y `not null` no sabe expresar eso.
-- Lo impide algo más gordo que los 5 tutores que ya están dentro: la fila de
-- `profiles` NO nace del formulario, la crea el trigger `on_auth_user_created`
-- → `handle_new_user`, que inserta (id, full_name, avatar_url, locale) en el
-- instante del signup, cuando el tutor todavía no ha visto ningún campo.
-- Cualquier constraint que exija teléfono al INSERT rompería la creación de la
-- cuenta. Lo mismo descarta el atajo de un CHECK con fecha: Postgres lo acepta
-- —comprobado— pero fallaría en el signup igual. La obligatoriedad vive donde
-- está el formulario.
--
-- EL FORMATO
-- ----------
-- Dos condiciones, ninguna nacional:
--   · un juego de caracteres cerrado (dígitos y los separadores que la gente
--     escribe de verdad: + ( ) . / - y espacio), longitud 6..24;
--   · entre 6 y 15 DÍGITOS una vez quitado todo lo demás. 15 es el máximo de
--     E.164 (el estándar internacional) y 6 deja sitio a números cortos.
--
-- Deliberadamente permisivo: no se exige el prefijo `+`, no se presupone
-- España, y NO se normaliza nada. Lo que teclea el tutor es lo que verá el
-- entrenador. La cadena vacía no pasa: la app debe mandar NULL, como ya hace
-- `admin_update_staff_contact` con su `nullif(btrim(...), '')`.
--
-- QUIÉN PUEDE LEER ESTO (la parte que decidió Jose)
-- -------------------------------------------------
-- Los teléfonos y el correo los ve el PERSONAL del club, no las familias.
-- Alcance: cualquier miembro del cuerpo técnico del club del jugador —admin,
-- dirección, coordinación y entrenadores—, no solo el staff de su equipo. Y
-- dos excepciones que no se pierden: el tutor ve el teléfono de SU hijo, y
-- cualquiera lee y escribe el suyo propio.
--
-- Sin cerrar nada, eso NO se cumpliría: `players_select_member` deja leer
-- cualquier fila de `players` a cualquier miembro del club, y los tutores son
-- miembros (fila en `memberships` con role='jugador'); `profiles_select_clubmate`
-- hace lo mismo con `profiles`. Es decir: por defecto, cualquier familia leería
-- por API el teléfono de cualquier niño del club.
--
-- El cierre se hace con privilegios de COLUMNA, y hay que hacerlo entero:
-- un `revoke select (phone)` suelto NO hace nada mientras siga en pie el grant
-- de tabla (comprobado en la base: `has_column_privilege` sigue devolviendo
-- true). Así que se revoca el SELECT de tabla y se vuelve a conceder columna a
-- columna, con la lista sacada del catálogo, menos `phone`.
--
-- CONSECUENCIA, Y HAY QUE SABERLA: a partir de aquí las dos tablas quedan en
-- modo FAIL-CLOSED. Quien añada mañana una columna a `players` o a `profiles`
-- y no toque los grants tendrá una columna que la app NO puede leer: en cuanto
-- una consulta la nombre, Postgres responde 42501 «permission denied for table
-- players» —el error habla de la TABLA aunque el problema sea de una columna—
-- y la lectura entera se va al suelo, no solo esa columna. Es ruidoso y sale al
-- primer intento, no es un dato que se pierda en silencio, pero es una trampa
-- si no se espera.
--
-- El guard de abajo recorre el catálogo y comprueba que TODAS las columnas
-- menos `phone` siguen siendo legibles, así que una enumeración incompleta AQUÍ
-- no llega a producción. Lo que ese guard no puede hacer es vigilar el futuro:
-- solo corre cuando se aplica esta migración. Para eso hace falta un test de
-- pgTAP con la misma comprobación, que corre en CADA PR — propuesto, no
-- incluido: esta migración es solo la migración.
--
-- La escritura NO se toca: el INSERT/UPDATE de `phone` sigue concedido, que es
-- lo que permite al tutor guardar el suyo bajo `profiles_update_self`. Sí hay
-- una consecuencia para el cliente: una escritura que encadene `.select()`
-- pidiendo `phone` fallará, porque eso es una lectura. Que la app no lo haga.
--
-- LO QUE SE CIERRA HAY QUE ABRIRLO POR ALGÚN LADO: TRES FUNCIONES
-- ---------------------------------------------------------------
--   · `get_player_tutors_contact(player)` — la ficha del jugador: nombre,
--     parentesco, CORREO y teléfono de cada tutor vinculado. El correo vive en
--     `auth.users`, fuera del alcance de PostgREST, así que esta función era
--     necesaria de todos modos.
--   · `get_player_phone(player)` — el teléfono del niño, que acaba de dejar de
--     ser legible por la vía normal. Es la que deja al TUTOR seguir viendo el
--     teléfono de su hijo.
--   · `get_my_phone()` — el propio, para la pantalla de perfil. Sin ella el
--     tutor podría escribir su teléfono pero no volver a verlo.
--
-- Las tres pasan por la misma puerta, `user_can_access_player_contact`, que es
-- un helper NUEVO y no una llamada al de la ficha médica: hoy hacen cosas
-- parecidas, pero si algún día se aprieta el acceso médico no quiero que el de
-- contacto se mueva solo y en silencio. Y este NO depende del consentimiento
-- médico: el teléfono está fuera del bloque médico, como se decidió.
--
-- El `revoke` de cada función nombra a `anon` ADEMÁS de a `public`, y no es
-- redundante: Supabase tiene default privileges que conceden EXECUTE a anon
-- sobre toda función nueva del esquema public, y esa concesión directa
-- sobrevive a un `revoke ... from public`. Lo cazó el guard de esta misma
-- migración al ensayarla.
--
-- Las dos que leen datos de otra persona dejan rastro en `audit_log` con
-- acción `contact.read` (`contact.read.platform` si mira un superadmin),
-- exactamente como `get_player_medical`, y solo cuando hay algo que enseñar y
-- quien mira no es tutor del jugador. Una ficha que enseñe teléfono del niño y
-- de los tutores deja DOS apuntes, uno por función; es ruido asumible a cambio
-- de que cada función registre lo suyo.
--
-- LA SUPRESIÓN
-- ------------
-- `physically_erase_player` borra columna a columna, enumerándolas. Una
-- columna nueva que no se añada ahí SOBREVIVE a la supresión de un menor. Por
-- eso el scrub se amplía aquí, en la misma migración que crea la columna. La
-- función se reescribe VERBATIM desde `pg_get_functiondef` de la base viva; el
-- único cambio es la línea `phone = null`.

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · El teléfono del tutor: una columna en `profiles`
-- ───────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column phone text
    check (
      phone is null
      or (
        btrim(phone) ~ '^[0-9+()./ -]{6,24}$'
        and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 6 and 15
      )
    );

comment on column public.profiles.phone is
  'Teléfono de contacto de la PERSONA (tutor, entrenador, quien sea). Uno por '
  'persona, lo escribe su dueño (policy profiles_update_self) y viaja con él '
  'entre clubes. NO es memberships.phone, que es del cuerpo técnico y lo '
  'gestiona el club. NULLABLE: los tutores anteriores a esta migración no '
  'tienen, y la fila de profiles la crea el trigger del signup sin teléfono. '
  'NO es legible por SELECT desde el cliente: se lee por get_my_phone() (el '
  'propio) o por get_player_tutors_contact() (los tutores de un jugador).';

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · El teléfono del niño: una columna en `players`
-- ───────────────────────────────────────────────────────────────────────────
alter table public.players
  add column phone text
    check (
      phone is null
      or (
        btrim(phone) ~ '^[0-9+()./ -]{6,24}$'
        and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 6 and 15
      )
    );

comment on column public.players.phone is
  'Teléfono del JUGADOR. OPCIONAL: muchos niños no tienen móvil. Es un dato de '
  'contacto ordinario y NO forma parte del bloque médico: no depende del '
  'consentimiento médico ni sustituye a player_medical.emergency_contact. NO '
  'es legible por SELECT desde el cliente: se lee por get_player_phone(). Se '
  'vacía en physically_erase_player.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · El cierre de lectura
--
--     Las listas de columnas salen del catálogo de la base viva
--     (information_schema.columns, por ordinal_position) menos `phone`. Si
--     falta una, la ficha del jugador se rompe entera — por eso el guard 9.6
--     las recorre TODAS y comprueba que siguen siendo legibles.
--
--     `postgres` y `service_role` no se tocan: el backend (exportación RGPD,
--     tareas administrativas) sigue viéndolo todo.
-- ───────────────────────────────────────────────────────────────────────────
revoke select on public.players from anon, authenticated;
grant select (
  id, club_id, first_name, last_name, date_of_birth, dorsal, position_main,
  positions_secondary, foot, height_cm, weight_kg, origin, medical_notes,
  photo_url, created_at, updated_at, invite_email, left_club_at,
  left_club_reason, erased_at, erased_by, last_name_blocked
) on public.players to anon, authenticated;

revoke select on public.profiles from anon, authenticated;
grant select (
  id, full_name, avatar_url, locale, date_of_birth, created_at, updated_at
) on public.profiles to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · La puerta
--
--     Cuerpo técnico del club (alcance CLUB, no equipo) + el tutor del
--     jugador. `user_role_in_club` ya resuelve por dentro dos cosas que aquí
--     hacen falta: el superadmin de plataforma cuenta como admin_club, y quien
--     está de baja (`left_at`) deja de ser miembro. El rol 'jugador' —que es
--     el que tienen los tutores y los jugadores con cuenta— queda FUERA de la
--     lista: una familia no ve los contactos de otra.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.user_can_access_player_contact(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    public.user_role_in_club(
      (select club_id from public.players where id = p_player_id)
    ) in (
      'admin_club', 'director', 'coordinador',
      'entrenador_principal', 'entrenador_ayudante'
    ),
    false
  )
  or public.user_is_tutor_of_player(p_player_id);
$$;

comment on function public.user_can_access_player_contact(uuid) is
  'Quién puede ver los datos de CONTACTO de un jugador y de sus tutores: '
  'cualquier miembro del cuerpo técnico del club (alcance club, no equipo) y '
  'el tutor vinculado al jugador. NO el resto de familias (role jugador), NO '
  'los seguidores. Es un helper propio y no el de la ficha médica, aunque hoy '
  'se parezcan: apretar el acceso médico no debe mover el de contacto.';

revoke all on function public.user_can_access_player_contact(uuid) from public, anon;
grant execute on function public.user_can_access_player_contact(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5 · Los tutores de un jugador: nombre, parentesco, correo y teléfono
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.get_player_tutors_contact(
  p_player_id  uuid,
  p_ip         text default null,
  p_user_agent text default null
)
returns table (
  tutor_profile_id uuid,
  full_name        text,
  relation         text,
  email            text,
  phone            text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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

  if not public.user_is_tutor_of_player(p_player_id) then
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
$$;

comment on function public.get_player_tutors_contact(uuid, text, text) is
  'Contacto de los tutores de un jugador para la ficha: nombre, parentesco, '
  'correo (de auth.users, inalcanzable por PostgREST) y teléfono. Puerta: '
  'user_can_access_player_contact. Cero filas si el jugador está suprimido o '
  'no tiene tutores. Deja apunte contact.read en audit_log cuando quien mira '
  'no es tutor del jugador.';

revoke all on function public.get_player_tutors_contact(uuid, text, text) from public, anon;
grant execute on function public.get_player_tutors_contact(uuid, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6 · El teléfono del niño
--
--     Existe porque el punto 3 cerró `players.phone` al cliente. Es también la
--     vía por la que un TUTOR sigue viendo el teléfono de su propio hijo: la
--     puerta lo contempla explícitamente.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.get_player_phone(
  p_player_id  uuid,
  p_ip         text default null,
  p_user_agent text default null
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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

  if not public.user_is_tutor_of_player(p_player_id) then
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
$$;

comment on function public.get_player_phone(uuid, text, text) is
  'Teléfono de un jugador. Misma puerta que get_player_tutors_contact, así que '
  'el tutor sigue viendo el de su hijo. NULL si el jugador está suprimido o no '
  'tiene teléfono. Deja apunte contact.read cuando quien mira no es tutor.';

revoke all on function public.get_player_phone(uuid, text, text) from public, anon;
grant execute on function public.get_player_phone(uuid, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 7 · El teléfono propio, para la pantalla de perfil
--
--     Sin auditoría: nadie necesita un registro de que alguien mira su propio
--     teléfono. La ESCRITURA no pasa por aquí: sigue siendo un UPDATE normal
--     bajo la policy profiles_update_self.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_phone()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.phone from public.profiles p where p.id = auth.uid();
$$;

comment on function public.get_my_phone() is
  'El teléfono de quien llama. Existe porque profiles.phone dejó de ser '
  'legible por SELECT desde el cliente; sin esto, el tutor podría guardar su '
  'teléfono y no volver a verlo. La escritura no cambia: UPDATE normal bajo '
  'profiles_update_self.';

revoke all on function public.get_my_phone() from public, anon;
grant execute on function public.get_my_phone() to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 8 · La supresión también borra el teléfono del niño
--
--     Copia VERBATIM de pg_get_functiondef sobre la base viva. Única
--     diferencia: la línea `phone = null` dentro del update.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.physically_erase_player(p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_erased timestamptz;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  select club_id, erased_at into v_club, v_erased from public.players where id = p_player_id;
  if v_club is null then
    raise exception 'player_invalid';
  end if;
  if not public.user_is_admin_or_director(v_club) then
    raise exception 'forbidden';
  end if;
  -- No se puede saltar la aprobación: exige supresión previa.
  if v_erased is null then
    raise exception 'not_erased';
  end if;

  -- Scrub irreversible. positions_secondary es NOT NULL default '{}' → se vacía.
  update public.players
     set last_name         = null,
         last_name_blocked = null,   -- se elimina el apellido bloqueado (irreversible)
         invite_email      = null,
         phone             = null,   -- teléfono del jugador: dato de contacto directo
         height_cm         = null,
         weight_kg         = null,
         foot              = null,
         origin            = null,
         dorsal            = null,
         position_main     = null,
         positions_secondary = '{}'::text[],
         updated_at        = now()
   where id = p_player_id;
  -- CONSERVA: first_name, date_of_birth, la fila players, los consents y el histórico.

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  values (v_uid, 'erasure.physical_delete', 'player', p_player_id, v_club, null);
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 9 · Guard
-- ───────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_tab       text;
  v_col       text;
  v_def       text;
  v_nullable  text;
  v_con_prof  text;
  v_con_play  text;
  v_ok        boolean;
  v_fn        text;
begin
  -- 9.1 · Las dos columnas existen y son NULLABLE. Lo segundo es lo que
  --       protege a los tutores que ya están dentro y, sobre todo, al signup:
  --       el día que alguien ponga `not null` aquí, esto para la migración.
  foreach v_tab in array array['profiles', 'players'] loop
    select is_nullable into v_nullable
      from information_schema.columns
     where table_schema = 'public' and table_name = v_tab and column_name = 'phone';
    if v_nullable is null then
      raise exception 'teléfonos: falta la columna phone en %', v_tab;
    end if;
    if v_nullable <> 'YES' then
      raise exception 'teléfonos: %.phone es NOT NULL y rompería el alta de cuentas', v_tab;
    end if;
  end loop;

  -- 9.2 · Las dos columnas llevan el MISMO CHECK. Se comparan LA UNA CON LA
  --       OTRA en vez de contra un texto escrito a mano: la forma exacta en que
  --       Postgres reimprime un CHECK (paréntesis, `::text`) depende de su
  --       versión, y el CI aplica esto sobre una base efímera que no tiene por
  --       qué ser la misma versión que producción.
  select pg_get_constraintdef(c.oid) into v_con_prof
    from pg_constraint c
   where c.conrelid = 'public.profiles'::regclass
     and c.contype = 'c' and c.conname = 'profiles_phone_check';
  select pg_get_constraintdef(c.oid) into v_con_play
    from pg_constraint c
   where c.conrelid = 'public.players'::regclass
     and c.contype = 'c' and c.conname = 'players_phone_check';

  if v_con_prof is null or v_con_play is null then
    raise exception 'teléfonos: falta el CHECK de formato (profiles: %, players: %)',
      coalesce(v_con_prof, 'AUSENTE'), coalesce(v_con_play, 'AUSENTE');
  end if;
  if v_con_prof <> v_con_play then
    raise exception 'teléfonos: los CHECK de profiles.phone y players.phone han divergido';
  end if;
  if v_con_prof !~ 'regexp_replace' or v_con_prof !~ '6,24' then
    raise exception 'teléfonos: el CHECK de formato no es el que documenta esta migración: %', v_con_prof;
  end if;

  -- 9.3 · El formato hace lo que dice. Se evalúa la MISMA expresión del CHECK
  --       sobre una tanda de ejemplos. (Está escrita dos veces, aquí y en el
  --       CHECK; el assert 9.2 es lo que impide que se separen.)
  select bool_and(
           (
             btrim(v) ~ '^[0-9+()./ -]{6,24}$'
             and length(regexp_replace(v, '[^0-9]', '', 'g')) between 6 and 15
           ) = esperado
         )
    into v_ok
    from (values
            ('600123456',        true),   -- móvil español tal cual se teclea
            ('+34 600 123 456',  true),   -- con prefijo y espacios
            ('(+34) 600-123-456',true),   -- con paréntesis y guiones
            ('+44 20 7946 0958', true),   -- extranjero
            ('+1 415 555 2671',  true),   -- extranjero, otro formato
            ('96 123 45 67',     true),   -- fijo
            ('',                 false),  -- vacío: la app debe mandar NULL
            ('   ',              false),
            ('12345',            false),  -- cinco dígitos no es un teléfono
            ('llamar al club',   false),  -- letras
            ('600123456 ext 12', false),  -- letras camufladas
            ('1234567890123456', false)   -- 16 dígitos: por encima de E.164
         ) as t(v, esperado);
  if not v_ok then
    raise exception 'teléfonos: el formato no se comporta como se documentó';
  end if;

  -- 9.4 · Las columnas nacen VACÍAS. Si esto salta es que la migración ha
  --       rellenado datos, que es justo lo que no debe hacer.
  if exists (select 1 from public.profiles where phone is not null)
     or exists (select 1 from public.players where phone is not null) then
    raise exception 'teléfonos: hay teléfonos escritos; esta migración no rellena datos';
  end if;

  -- 9.5 · EL CIERRE: ni anon ni authenticated pueden SELECT sobre phone.
  --       Este es el assert que caza el fallo del que avisa la cabecera —un
  --       `revoke select (phone)` suelto deja este privilegio en pie—.
  foreach v_tab in array array['profiles', 'players'] loop
    if has_column_privilege('authenticated', 'public.' || v_tab, 'phone', 'SELECT') then
      raise exception 'teléfonos: authenticated todavía puede leer %.phone', v_tab;
    end if;
    if has_column_privilege('anon', 'public.' || v_tab, 'phone', 'SELECT') then
      raise exception 'teléfonos: anon todavía puede leer %.phone', v_tab;
    end if;
  end loop;

  -- 9.6 · LA APERTURA: todas las DEMÁS columnas siguen siendo legibles. Se
  --       recorre el catálogo, no una lista escrita a mano, así que si al
  --       enumerar los grants se quedó una fuera, aquí sale con su nombre en
  --       vez de romperse la ficha del jugador en producción.
  foreach v_tab in array array['profiles', 'players'] loop
    for v_col in
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = v_tab and column_name <> 'phone'
       order by ordinal_position
    loop
      if not has_column_privilege('authenticated', 'public.' || v_tab, v_col, 'SELECT') then
        raise exception 'teléfonos: authenticated ha PERDIDO la lectura de %.%', v_tab, v_col;
      end if;
    end loop;
  end loop;

  -- 9.7 · La ESCRITURA de phone sigue concedida: es lo que permite al tutor
  --       guardar el suyo (profiles_update_self) y al club el del niño.
  foreach v_tab in array array['profiles', 'players'] loop
    if not has_column_privilege('authenticated', 'public.' || v_tab, 'phone', 'UPDATE') then
      raise exception 'teléfonos: authenticated no puede ESCRIBIR %.phone', v_tab;
    end if;
  end loop;

  -- 9.8 · Las tres funciones y el helper: existen, son SECURITY DEFINER, las
  --       puede ejecutar authenticated y NO anon.
  foreach v_fn in array array[
    'public.user_can_access_player_contact(uuid)',
    'public.get_player_tutors_contact(uuid, text, text)',
    'public.get_player_phone(uuid, text, text)',
    'public.get_my_phone()'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'teléfonos: no existe la función %', v_fn;
    end if;
    if not (select prosecdef from pg_proc where oid = to_regprocedure(v_fn)) then
      raise exception 'teléfonos: % no es SECURITY DEFINER', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'teléfonos: authenticated no puede ejecutar %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'teléfonos: anon puede ejecutar %', v_fn;
    end if;
  end loop;

  -- 9.9 · La puerta NO deja pasar al rol 'jugador' (el de las familias) por la
  --       vía del cuerpo técnico. Se mira la definición viva: si alguien añade
  --       'jugador' a la lista, se abre el contacto de todo el club a todas las
  --       familias, y eso es exactamente lo que se decidió que no.
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = to_regprocedure('public.user_can_access_player_contact(uuid)');
  if v_def ~ '''jugador''' then
    raise exception 'teléfonos: la puerta de contacto admite el rol jugador';
  end if;
  if v_def !~ 'user_is_tutor_of_player' then
    raise exception 'teléfonos: la puerta de contacto ya no contempla al tutor del jugador';
  end if;

  -- 9.10 · La supresión de un menor borra el teléfono. Este es el assert que
  --        fallaría si alguien reescribe physically_erase_player desde una
  --        copia vieja y se deja la línea por el camino.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'physically_erase_player';
  if v_def !~ 'phone\s*=\s*null' then
    raise exception 'teléfonos: physically_erase_player no borra players.phone';
  end if;

  -- 9.11 · Y lo que NO debía cambiar: el contacto de emergencia médico sigue
  --        donde estaba. El teléfono nuevo no lo sustituye ni lo toca.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'player_medical'
       and column_name = 'emergency_contact'
  ) then
    raise exception 'teléfonos: ha desaparecido player_medical.emergency_contact';
  end if;
end $guard$;
