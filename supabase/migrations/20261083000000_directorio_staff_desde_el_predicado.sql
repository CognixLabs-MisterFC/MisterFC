-- El directorio de staff sale del MISMO predicado que su policy.
--
-- ── EL FALLO, MEDIDO EN PRODUCCIÓN ──────────────────────────────────────────
--
-- `listStaffDirectoryFromClient` armaba la lista en TypeScript con tres consultas.
-- La primera leía `memberships` filtrando `club_id` y `role <> 'jugador'`, y NO
-- filtraba `left_at`. El portero que decide si se puede abrir el hilo —
-- `profile_is_staff_of_club`, que usa `staff_conversations_insert_staff`— SÍ lo
-- filtra, en sus dos ramas.
--
-- Resultado para el perfil con el que Jose lo probó en el dispositivo: el directorio
-- le ofrecía 7 personas, de las que 3 no pasaban el portero — tres entrenadores que
-- se fueron del club el 26 de agosto de 2026. Agrupadas por rol como las pinta la
-- pantalla, el grupo «entrenador principal» eran 4 y tres de los cuatro devolvían
-- `forbidden` al pulsarlos.
--
-- Es la misma forma del fallo que cerró la 20261082: la lista escrita en un lenguaje
-- y el permiso en otro. Aquí ni siquiera hubo que esperar a que divergieran — el
-- comentario de la constante en TypeScript ya decía «mismo criterio que
-- profile_is_staff_of_club», y el filtro simplemente no estaba.
--
-- ── LO QUE SE HACE ──────────────────────────────────────────────────────────
--
-- `staff_conversation_directory(club)` devuelve el directorio, y **quién está dentro
-- lo decide `profile_is_staff_of_club`**, el mismo predicado que el WITH CHECK. No se
-- vuelve a derivar: el CTE junta CANDIDATOS —cualquiera con una fila de rol en el
-- club— y el predicado es el que corta. Si mañana cambia el predicado, la lista se
-- entera sola.
--
-- Nadie puede pasar el predicado y quedarse fuera de la lista: sus dos ramas son
-- «rol de gestión en memberships» y «team_staff activo», y las dos producen
-- etiqueta. El bloque [1] del test lo fija comparando los dos conjuntos.
--
-- ── LA ETIQUETA, QUE ES OTRA COSA ───────────────────────────────────────────
--
-- Una persona puede tener varios roles (el caso real de este club: ayudante de club
-- y principal de un equipo). Se queda el de más prioridad, igual que hacía el
-- TypeScript. Esa prioridad sigue existiendo en los dos lados a propósito: aquí para
-- colapsar, y en la pantalla para ordenar las secciones. Lo que NO puede pasar es que
-- las dos listas se separen, y de eso se encarga un test de contrato en core que lee
-- ESTE fichero.
--
-- Las filas de `team_staff` cerradas no dan etiqueta: una asignación terminada no es
-- un rol que alguien tenga hoy. El `left_at` de la membresía no se filtra aquí — es
-- asunto del predicado, y filtrarlo seria volver a escribir su regla.
--
-- ── EL ORDEN ────────────────────────────────────────────────────────────────
--
-- Ordenado en SQL por `unaccent(lower(nombre))`, que es lo más cerca que se puede
-- estar del `localeCompare('es', { sensitivity: 'base' })` que hacía el cliente, y
-- con el id como desempate. El desempate NO es cosmético: en este club hay cuatro
-- personas llamadas «Jose Coach», y el `sort` de JavaScript sin desempate las dejaba
-- en el orden en que llegaran del servidor. Ahora el orden es el mismo en cada
-- llamada.

create or replace function public.staff_conversation_directory(p_club_id uuid)
returns table(profile_id uuid, full_name text, role text)
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

  -- La puerta es el MISMO predicado, aplicado a quien pregunta: para abrir el hilo
  -- la policy exige que los DOS sean staff del club, así que quien no lo es no tiene
  -- nada que buscar aquí.
  if not public.profile_is_staff_of_club(v_uid, p_club_id) then
    raise exception 'forbidden';
  end if;

  return query
  with prioridad(rol, orden) as (
    values ('admin_club', 1),
           ('director', 2),
           ('coordinador', 3),
           ('entrenador_principal', 4),
           ('entrenador_ayudante', 5),
           ('preparador_fisico', 6),
           ('delegado', 7)
  ),
  candidatos as (
    -- Rol de club. El `join prioridad` de abajo descarta 'jugador' por si solo: la
    -- tabla de prioridad ES la lista de etiquetas de staff.
    select m.profile_id, m.role as rol
      from public.memberships m
     where m.club_id = p_club_id

    union all

    -- Rol de equipo. Capta `delegado` y `preparador_fisico`, que no son roles de
    -- club. Las asignaciones cerradas no cuentan como rol.
    select m.profile_id, ts.staff_role
      from public.team_staff  ts
      join public.memberships m on m.id = ts.membership_id
     where m.club_id = p_club_id
       and ts.left_at is null
  )
  select c.profile_id,
         coalesce(pr.full_name, '') as full_name,
         (array_agg(c.rol order by p.orden))[1] as role
    from candidatos c
    join prioridad p on p.rol = c.rol
    left join public.profiles pr on pr.id = c.profile_id
   where c.profile_id <> v_uid
     and public.profile_is_staff_of_club(c.profile_id, p_club_id)
   group by c.profile_id, pr.full_name
   order by public.unaccent(lower(coalesce(pr.full_name, ''))), c.profile_id;
end;
$function$;

comment on function public.staff_conversation_directory(uuid) is
  'Directorio de staff del club para el selector de mensajes, MENOS quien pregunta. Quien esta dentro lo decide profile_is_staff_of_club, el mismo predicado que el WITH CHECK de staff_conversations_insert_staff, para que la lista que se ofrece y lo que se permite no puedan separarse (mig 20261083). La etiqueta es el rol de mas prioridad entre los suyos.';

revoke all on function public.staff_conversation_directory(uuid) from public;
revoke all on function public.staff_conversation_directory(uuid) from anon;
grant execute on function public.staff_conversation_directory(uuid) to authenticated;
grant execute on function public.staff_conversation_directory(uuid) to service_role;
