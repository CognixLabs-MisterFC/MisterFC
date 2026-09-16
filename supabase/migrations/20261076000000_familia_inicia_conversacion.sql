-- La familia puede abrir un hilo, y el que se va del club deja de leerlo.
--
-- ── DE DÓNDE VIENE ──────────────────────────────────────────────────────────
--
-- `conversations` ya modela el hilo familia↔club: (club_id, player_id,
-- coach_profile_id), con UNIQUE (coach_profile_id, player_id). Y ya funciona en los
-- DOS sentidos: la familia lo ve (`conversations_select_participants`, vía
-- `player_accounts`) y escribe dentro (`messages_insert_participant`). Lo único que
-- no puede es CREARLO, porque la policy de INSERT exige:
--
--     coach_profile_id = auth.uid()
--
-- o sea, solo puede abrirlo el lado del club. Por eso la app de familia nunca tuvo
-- compositor: no es que faltara pantalla, es que faltaba la puerta.
--
-- Esta migración abre esa puerta SIN relajar la policy. La regla de «a quién puede
-- escribir una familia» es demasiado específica para un WITH CHECK, y una policy más
-- laxa dejaría a la familia abrir hilo con cualquier perfil del club. Va en dos RPC
-- `SECURITY DEFINER`, que es donde este proyecto pone las reglas que no son de fila.
--
-- ── A QUIÉN PUEDE ESCRIBIR (decidido por Jose) ──────────────────────────────
--
--   · admin_club y director        → de su club, sin acotar a equipo
--   · cualquiera asignado a SU equipo → team_staff activo, TODOS los staff_role
--                                       (principal, ayudante, delegado, PF…)
--
-- Nadie más: ni otras familias, ni staff de equipos que no son los de su hijo.
--
-- ── Y EL AGUJERO QUE SE CIERRA DE PASO ──────────────────────────────────────
--
-- `conversations_select_participants` dice `coach_profile_id = auth.uid()` SIN mirar
-- si esa persona sigue siendo del club. Un entrenador que se va seguía leyendo la
-- correspondencia de esa familia para siempre.
--
-- Medido hoy en producción antes de tocar nada: 0 de los 8 hilos tienen un coach que
-- ya no sea miembro activo — pero hay 4 memberships dadas de baja, así que es
-- cuestión de tiempo. Y abrir la lista de destinatarios lo ensancharía.
--
-- SON TRES SITIOS, NO UNO, y esto es lo que hace que el arreglo sea de verdad:
--
--   1. la policy `conversations_select_participants`  → listar el hilo
--   2. `user_is_conversation_participant`             → LEER Y ESCRIBIR los mensajes
--   3. `user_unread_conversations_count`              → el contador de no leídos
--
-- Tocar solo la policy habría sido cosmético: el ex-entrenador no vería el hilo en su
-- bandeja pero seguiría leyendo `messages` con el id, y le seguiría subiendo el badge.
--
-- El criterio es `user_role_in_club(club_id) is not null`, que ya filtra `left_at is
-- null` y mantiene el comportamiento de superadmin del resto del esquema (un
-- superadmin resuelve a 'admin_club' en cualquier club).
--
-- LO QUE NO SE TOCA, y es deliberado: el lado de la FAMILIA. Un tutor cuyo hijo dejó
-- el club conserva su historial. Es la pregunta espejo y no estaba en el encargo;
-- cerrarla borraría de golpe conversaciones que hoy se ven.

-- ── 1 · El que ya no es del club deja de leer ───────────────────────────────

drop policy if exists conversations_select_participants on public.conversations;

create policy conversations_select_participants
  on public.conversations
  for select
  to authenticated
  using (
    (
      coach_profile_id = auth.uid()
      and public.user_role_in_club(club_id) is not null
    )
    or exists (
      select 1 from public.player_accounts pa
      where pa.player_id = conversations.player_id
        and pa.profile_id = auth.uid()
    )
  );

create or replace function public.user_is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and (
        (
          c.coach_profile_id = auth.uid()
          -- Sigue siendo del club. Sin esto, irse del club no cerraba nada.
          and public.user_role_in_club(c.club_id) is not null
        )
        or exists (
          select 1 from public.player_accounts pa
          where pa.player_id = c.player_id
            and pa.profile_id = auth.uid()
        )
      )
  );
$function$;

create or replace function public.user_unread_conversations_count()
returns integer
language sql
stable security definer
set search_path to 'public'
as $function$
  select count(distinct m.conversation_id)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.read_at is null
     and m.sender_profile_id <> auth.uid()
     and (
       (
         c.coach_profile_id = auth.uid()
         and public.user_role_in_club(c.club_id) is not null
       )
       or exists (
         select 1 from public.player_accounts pa
          where pa.player_id = c.player_id
            and pa.profile_id = auth.uid()
       )
     );
$function$;

-- ── 2 · A quién puede escribir esta familia ─────────────────────────────────
--
-- Devolver la LISTA desde el servidor, y no dejar que la arme el cliente, es lo que
-- hace que la regla se cumpla: la RPC de crear valida contra esta misma lista, así
-- que lo que se ofrece y lo que se permite no pueden separarse.
--
-- Trae ya el `conversation_id` si el hilo existe: la pantalla necesita saber si
-- ABRE o CREA, y pedirlo aparte serían N consultas más.
--
-- DEDUPLICADO por persona. Un director que además entrena al equipo saldría dos
-- veces; sale una, como 'team', porque la familia lo conoce por ahí.

create or replace function public.family_conversation_recipients(p_player_id uuid)
returns table (
  profile_id      uuid,
  full_name       text,
  kind            text,      -- 'club' (admin/director) | 'team' (asignado a su equipo)
  staff_role      text,      -- el rol concreto; en 'club' es el rol de membership
  team_id         uuid,
  team_name       text,
  conversation_id uuid       -- null = todavía no hay hilo
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_club uuid;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- La puerta es la MISMA que la del resto de la superficie de familia: tutor o el
  -- propio jugador con cuenta. El jugador ya VE estos hilos hoy (la policy de select
  -- no filtra por relación), así que dejarle abrirlos es coherente, no nuevo.
  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  -- Jugador suprimido: sin destinatarios. Igual que la ficha médica y el contacto.
  select club_id into v_club
    from public.players
   where id = p_player_id and erased_at is null;
  if v_club is null then
    return;
  end if;

  return query
  select distinct on (x.profile_id)
         x.profile_id, x.full_name, x.kind, x.staff_role, x.team_id, x.team_name,
         c.id as conversation_id
  from (
    -- El club: admin y dirección, sin acotar a equipo.
    select m.profile_id,
           pr.full_name,
           'club'::text as kind,
           m.role       as staff_role,
           null::uuid   as team_id,
           null::text   as team_name,
           1            as prioridad
      from public.memberships m
      join public.profiles pr on pr.id = m.profile_id
     where m.club_id = v_club
       and m.left_at is null
       and m.role in ('admin_club', 'director')
       and m.profile_id <> v_uid

    union all

    -- Su equipo: TODOS los asignados, sea cual sea el staff_role (Jose: "equipos
    -- asignados, todos" — entra el delegado y el preparador físico).
    select m.profile_id,
           pr.full_name,
           'team'::text as kind,
           ts.staff_role,
           t.id         as team_id,
           t.name       as team_name,
           0            as prioridad
      from public.team_members tm
      join public.team_staff   ts on ts.team_id = tm.team_id and ts.left_at is null
      join public.memberships  m  on m.id = ts.membership_id and m.left_at is null
      join public.profiles     pr on pr.id = m.profile_id
      join public.teams        t  on t.id = ts.team_id
     where tm.player_id = p_player_id
       and tm.left_at is null
       and m.club_id = v_club
       and m.profile_id <> v_uid
  ) x
  left join public.conversations c
         on c.coach_profile_id = x.profile_id
        and c.player_id        = p_player_id
  -- `prioridad` primero: si alguien sale por los dos lados, gana la fila de equipo.
  order by x.profile_id, x.prioridad, x.full_name;
end;
$function$;

-- ── 3 · Abrir el hilo (o devolver el que ya hay) ────────────────────────────
--
-- Idempotente por el UNIQUE (coach_profile_id, player_id) que la tabla ya tiene: dos
-- toques seguidos en el mismo nombre devuelven el mismo hilo, no dos.
--
-- NO escribe ningún mensaje. Crear el hilo y enviar son cosas distintas: si el envío
-- falla, la familia se queda con un hilo vacío y no con un mensaje perdido.

create or replace function public.family_start_conversation(
  p_player_id            uuid,
  p_recipient_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_club uuid;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;
  if not public.user_manages_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  select club_id into v_club
    from public.players
   where id = p_player_id and erased_at is null;
  if v_club is null then
    raise exception 'forbidden';
  end if;

  -- LA REGLA, contra la MISMA lista que se le ofreció. Si el destinatario ya no vale
  -- —se fue del club, lo sacaron del equipo— esto falla aunque la pantalla lo
  -- siguiera pintando de una carga anterior.
  if not exists (
    select 1 from public.family_conversation_recipients(p_player_id) r
     where r.profile_id = p_recipient_profile_id
  ) then
    raise exception 'forbidden';
  end if;

  select id into v_id
    from public.conversations
   where coach_profile_id = p_recipient_profile_id
     and player_id = p_player_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations (club_id, player_id, coach_profile_id)
  values (v_club, p_player_id, p_recipient_profile_id)
  on conflict (coach_profile_id, player_id) do nothing
  returning id into v_id;

  -- Carrera: otro toque lo creó entre el select y el insert. El UNIQUE aguantó y
  -- aquí se recoge el que ganó, en vez de devolver null.
  if v_id is null then
    select id into v_id
      from public.conversations
     where coach_profile_id = p_recipient_profile_id
       and player_id = p_player_id;
  end if;

  return v_id;
end;
$function$;

-- ── 4 · Privilegios ─────────────────────────────────────────────────────────
--
-- El patrón de la migración 20261075000000, que es el que hay que copiar: nombrar
-- `anon` EXPLÍCITAMENTE. Un `revoke ... from public` a secas NO cierra a anon, porque
-- el default privilege de Supabase le concede EXECUTE por su nombre y esa concesión
-- es otra entrada de la ACL que el revoke a PUBLIC no toca.

revoke all on function public.family_conversation_recipients(uuid) from public;
revoke all on function public.family_conversation_recipients(uuid) from anon;
grant execute on function public.family_conversation_recipients(uuid) to authenticated;
grant execute on function public.family_conversation_recipients(uuid) to service_role;

revoke all on function public.family_start_conversation(uuid, uuid) from public;
revoke all on function public.family_start_conversation(uuid, uuid) from anon;
grant execute on function public.family_start_conversation(uuid, uuid) to authenticated;
grant execute on function public.family_start_conversation(uuid, uuid) to service_role;

comment on function public.family_conversation_recipients(uuid) is
  'A quién puede escribir la familia de este jugador: admin/dirección del club y CUALQUIER asignado a su equipo. Trae el conversation_id si el hilo ya existe. La RPC de crear valida contra esta misma lista.';
comment on function public.family_start_conversation(uuid, uuid) is
  'Abre (o devuelve) el hilo de esta familia con un destinatario permitido. Idempotente por el UNIQUE (coach_profile_id, player_id). No escribe ningún mensaje.';
