-- Un entrenador solo abre hilo con jugadores DE SU equipo.
--
-- ── EL FALLO ────────────────────────────────────────────────────────────────
--
-- Salió anotado al escribir #614. La tercera rama de `conversations_insert_coach`
-- comprobaba que el equipo del que llama y el jugador estuvieran en el MISMO CLUB,
-- y nada más:
--
--     exists (select 1 from team_staff ts
--               join memberships m  on m.id = ts.membership_id
--               join teams       t  on t.id = ts.team_id
--               join categories  c  on c.id = t.category_id
--              where ts.left_at is null
--                and m.profile_id = auth.uid()
--                and c.club_id = conversations.club_id)   -- ← el jugador no aparece
--
-- O sea: cualquiera con una fila viva en `team_staff` de CUALQUIER equipo del club
-- podía abrir un hilo con CUALQUIER jugador del club. La segunda rama —la de
-- coordinación— sí ata el jugador (`tm.player_id = conversations.player_id`); es solo
-- la tercera la que se dejó suelta.
--
-- Medido en producción: dos `entrenador_ayudante` alcanzaban **42 jugadores** cuando
-- los de sus equipos son **24**. 18 de más cada uno.
--
-- ── LO QUE LO CONVIERTE EN UN FALLO Y NO EN UNA DECISIÓN ────────────────────
--
-- Que el otro extremo del mismo producto ya dice lo contrario. Cuando es la FAMILIA
-- quien abre el hilo (mig 20261076000000), `family_conversation_recipients` le ofrece
-- exactamente dos cosas: la dirección del club (`admin_club`, `director`) y los
-- asignados al equipo DEL JUGADOR, sea cual sea su `staff_role`. Un ayudante de otro
-- equipo no sale en esa lista, y `family_start_conversation` lo rechaza si el cliente
-- se lo inventa.
--
-- Los dos extremos del mismo hilo no pueden tener reglas distintas.
--
-- ── QUÉ SE ROMPE: NADA, Y NO ES SUERTE ──────────────────────────────────────
--
-- Esta policy es de INSERT. Leer y escribir en un hilo YA EXISTENTE no pasa por
-- aquí: van por `user_is_conversation_participant`, que pide ser el coach del hilo y
-- seguir siendo del club. Así que ningún hilo vivo pierde nada, por construcción y no
-- por cómo estén los datos hoy.
--
-- Y por los datos, además: de los 8 hilos que hay en producción, los 8 pasan la regla
-- acotada (7 por rol de club, 3 por equipo compartido). Cero se romperían.
--
-- Tampoco el camino de idempotencia: `startConversationFromClient` busca el hilo
-- existente por UNIQUE(coach_profile_id, player_id) y solo inserta si no lo hay, así
-- que reabrir uno viejo nunca toca esta policy.
--
-- ── A QUIÉN DEJA FUERA, MIRADO UNO A UNO ────────────────────────────────────
--
--   · Dirección escribiendo a un equipo que no entrena → SIGUE PUDIENDO. La rama 1
--     no se toca: `admin_club`, `director` y `entrenador_principal` de club alcanzan
--     a cualquier jugador, sin equipo de por medio.
--   · Coordinación → SIGUE PUDIENDO. Un coordinador no es de categoría en el modelo:
--     `user_coordinates_team` lo busca en `team_staff` CON `staff_role='coordinador'`,
--     y el CHECK de `invitations` obliga a `team_id not null` al invitarlo. O sea que
--     un coordinador tiene una fila por cada equipo que coordina, y la rama 3 acotada
--     lo cubre igual que la rama 2.
--   · Preparador físico y delegado → alcanzan a los jugadores de sus equipos. Es lo
--     que la lista de la familia ya les concede («equipos asignados, todos»).
--   · Un jugador SIN equipo → deja de ser alcanzable por el cuerpo técnico, y solo
--     lo alcanza la dirección. Es EXACTAMENTE lo que hoy ve su familia: sin equipo,
--     la lista de destinatarios solo trae la dirección del club. Hay 1 hoy.
--
-- ── LO QUE ESTA MIGRACIÓN NO ARREGLA ────────────────────────────────────────
--
-- `listMessageablePlayersFromClient` (core) sigue ofreciendo TODOS los jugadores del
-- club a cualquiera que pueda escribir. Su hermana de equipos sí acota y lo deja
-- escrito: «ofrecer más los llevaría a un hilo que la RLS no les deja abrir». Hasta
-- que se acote, esos 18 nombres siguen pintados y ahora devuelven `forbidden` al
-- pulsarlos. Es un error en una acción que no debería ofrecerse, no una regresión de
-- permisos: la RLS queda bien antes que la pantalla, no después.
--
-- ── FORMA ───────────────────────────────────────────────────────────────────
--
-- `alter policy` y no drop+create: recrear pierde lo que no se vuelva a escribir, y
-- aquí solo cambia el WITH CHECK. La rama 3 pasa a colgar de `team_members` del
-- jugador, y de paso se le añaden dos cosas que la versión vieja no pedía y la lista
-- de la familia sí: que la membership esté VIVA y que sea del club del hilo.

alter policy conversations_insert_coach on public.conversations
  with check (
    coach_profile_id = auth.uid()
    and (
      -- 1 · Dirección del club: alcanza a cualquier jugador. Sin tocar.
      public.user_role_in_club(club_id) = any (
        array['admin_club'::text, 'director'::text, 'entrenador_principal'::text])

      -- 2 · Coordinación del equipo DEL JUGADOR. Sin tocar: ya lo ataba.
      or exists (
        select 1
        from public.team_members tm
        where tm.player_id = conversations.player_id
          and tm.left_at is null
          and public.user_coordinates_team(tm.team_id)
      )

      -- 3 · Cuerpo técnico DEL EQUIPO DEL JUGADOR. LA QUE CAMBIA.
      or exists (
        select 1
        from public.team_staff   ts
        join public.memberships  m  on m.id = ts.membership_id
        join public.team_members tm on tm.team_id = ts.team_id
        where ts.left_at is null
          and m.left_at is null
          and m.profile_id = auth.uid()
          and m.club_id    = conversations.club_id
          and tm.player_id = conversations.player_id
          and tm.left_at is null
      )
    )
  );

comment on policy conversations_insert_coach on public.conversations is
  'Abre hilo 1:1 con un jugador: la direccion del club (admin/director/principal de club) con cualquiera, y la coordinacion y el cuerpo tecnico SOLO con los jugadores de SUS equipos. Misma regla que family_conversation_recipients, que es el otro extremo del mismo hilo (mig 20261080).';
