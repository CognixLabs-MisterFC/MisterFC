-- El predicado del hilo, escrito UNA vez y usado por los dos lados.
--
-- ── DE DÓNDE VIENE ──────────────────────────────────────────────────────────
--
-- La 20261080 acotó `conversations_insert_coach` a los jugadores del equipo de quien
-- escribe, y dejó dicho lo que no arreglaba: `listMessageablePlayersFromClient`
-- seguía ofreciendo TODOS los jugadores del club. Resultado medido: dos
-- `entrenador_ayudante` con 42 nombres pintados de los que 18 devuelven `forbidden`
-- al pulsarlos.
--
-- Lo que se podía hacer y NO se hace: reescribir la regla en TypeScript para filtrar
-- la lista. Serían dos copias de la misma regla en dos lenguajes, y el día que una
-- cambie la otra se queda — que es exactamente el fallo que arregló la 80, solo que
-- entre el cliente y la RLS en vez de entre los dos extremos del hilo.
--
-- ── LO QUE SE HACE ──────────────────────────────────────────────────────────
--
-- Se saca el cuerpo del WITH CHECK a una función con nombre,
-- `user_can_open_conversation_with(player)`, y se usa en los DOS sitios:
--
--   · la policy pasa a ser `coach_profile_id = auth.uid() and <la función>`;
--   · `staff_conversation_players(club)` devuelve los jugadores que la función
--     deja pasar.
--
-- Es el mismo patrón que la mig 76 ya usa en el otro extremo: allí
-- `family_start_conversation` valida contra la MISMA lista que devuelve
-- `family_conversation_recipients`. Aquí la lista y el gate comparten el predicado.
--
-- ── EQUIVALENCIA, MEDIDA ────────────────────────────────────────────────────
--
-- La función deriva el club DEL JUGADOR; la policy usaba `conversations.club_id`.
-- Son lo mismo porque el trigger `conversations_same_club_trg` RECHAZA (no corrige)
-- cualquier fila cuyo `club_id` no sea el del jugador, y el WITH CHECK se evalúa
-- sobre la fila final, después de los triggers BEFORE.
--
-- No se deja en el razonamiento: ensayado contra producción, las 504 parejas
-- (12 miembros × 42 jugadores) dan el MISMO booleano con la expresión vieja y con la
-- función nueva. Cero discrepancias.
--
-- ── LO QUE LA LISTA AÑADE, Y POR QUÉ NO VA EN EL PREDICADO ──────────────────
--
-- `staff_conversation_players` filtra además por `left_club_at is null` y
-- `erased_at is null`, como hacía la consulta que sustituye. Eso NO sube al
-- predicado: la policy nunca lo pidió, y meterlo ahí sería cambiar permisos en una
-- migración que viene a unificar una regla. Ofrecer menos de lo que se permite es
-- seguro; al revés no.
--
-- (Queda anotado: la lista de la familia sí excluye a los suprimidos y la policy del
-- coach no. Hoy no hay ninguno. Es de otra tanda.)

-- ── 1 · El predicado ────────────────────────────────────────────────────────

create or replace function public.user_can_open_conversation_with(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        -- 1 · Dirección del club: alcanza a cualquier jugador.
        public.user_role_in_club(p.club_id) = any (
          array['admin_club'::text, 'director'::text, 'entrenador_principal'::text])

        -- 2 · Coordinación del equipo DEL JUGADOR.
        or exists (
          select 1
          from public.team_members tm
          where tm.player_id = p.id
            and tm.left_at is null
            and public.user_coordinates_team(tm.team_id)
        )

        -- 3 · Cuerpo técnico DEL EQUIPO DEL JUGADOR.
        or exists (
          select 1
          from public.team_staff   ts
          join public.memberships  m  on m.id = ts.membership_id
          join public.team_members tm on tm.team_id = ts.team_id
          where ts.left_at is null
            and m.left_at is null
            and m.profile_id = auth.uid()
            and m.club_id    = p.club_id
            and tm.player_id = p.id
            and tm.left_at is null
        )
      )
  );
$function$;

comment on function public.user_can_open_conversation_with(uuid) is
  'Quien puede ABRIR un hilo 1:1 con este jugador: la direccion del club con cualquiera, y la coordinacion y el cuerpo tecnico solo con los de SUS equipos. Es el predicado de conversations_insert_coach sacado a funcion para que la lista de destinatarios no lo reescriba aparte (mig 20261082). Si cambia la regla, cambia AQUI y los dos lados se enteran.';

revoke all on function public.user_can_open_conversation_with(uuid) from public;
revoke all on function public.user_can_open_conversation_with(uuid) from anon;
grant execute on function public.user_can_open_conversation_with(uuid) to authenticated;
grant execute on function public.user_can_open_conversation_with(uuid) to service_role;

-- ── 2 · La policy pasa a llamarlo ───────────────────────────────────────────

alter policy conversations_insert_coach on public.conversations
  with check (
    coach_profile_id = auth.uid()
    and public.user_can_open_conversation_with(player_id)
  );

comment on policy conversations_insert_coach on public.conversations is
  'Abre hilo 1:1 con un jugador. La regla vive en user_can_open_conversation_with(uuid), compartida con staff_conversation_players para que la lista que se ofrece y lo que se permite no puedan separarse (mig 20261082).';

-- ── 3 · La lista, contra el MISMO predicado ─────────────────────────────────

create or replace function public.staff_conversation_players(p_club_id uuid)
returns table(id uuid, first_name text, last_name text)
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

  -- La puerta: ser del club. Quien no lo es no pregunta por su plantilla, ni
  -- siquiera para que le contesten una lista vacia.
  if public.user_role_in_club(p_club_id) is null then
    raise exception 'forbidden';
  end if;

  return query
  select p.id, p.first_name, p.last_name
    from public.players p
   where p.club_id = p_club_id
     and p.left_club_at is null
     and p.erased_at is null
     and public.user_can_open_conversation_with(p.id)
   order by p.first_name, p.last_name
   limit 500;
end;
$function$;

comment on function public.staff_conversation_players(uuid) is
  'Jugadores del club con los que el que llama PUEDE abrir hilo: mismo predicado que la policy de INSERT (user_can_open_conversation_with), mas los filtros de actividad que la lista siempre tuvo. Espejo de family_conversation_recipients en el otro extremo del hilo (mig 20261082).';

revoke all on function public.staff_conversation_players(uuid) from public;
revoke all on function public.staff_conversation_players(uuid) from anon;
grant execute on function public.staff_conversation_players(uuid) to authenticated;
grant execute on function public.staff_conversation_players(uuid) to service_role;
