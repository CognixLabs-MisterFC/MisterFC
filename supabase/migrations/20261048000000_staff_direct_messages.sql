-- 12 · Mensajería privada entre STAFF (1:1 perfil↔perfil). ADITIVA y AISLADA.
--
-- Canal NUEVO. NO toca conversations / messages / team_* ni su RLS: esas las usan
-- las familias en producción y no las tocamos. Alcance (decisión de Jose): solo
-- staff del club, cualquiera con cualquiera, entre equipos distintos, SIMÉTRICO (los
-- dos inician y leen). Familias FUERA por construcción.
--
-- Modelo (3 tablas dedicadas):
--   staff_conversations       — un hilo 1:1 por par de perfiles y club. Par CANÓNICO
--                               (profile_a < profile_b) → hilo único sin importar
--                               quién lo abre; idempotencia por UNIQUE.
--   staff_messages            — mensajes APPEND-ONLY (sin UPDATE/DELETE de cliente →
--                               nadie edita ni borra cuerpos, propios ni ajenos).
--   staff_conversation_reads  — marcador de lectura por participante (last_read_at),
--                               mismo patrón que team_conversation_reads. Los no-leídos
--                               se derivan por diferencia (mensajes del OTRO posteriores
--                               a mi last_read_at). Elegido en vez de messages.read_at
--                               precisamente para que staff_messages sea inmutable.
--
-- Autorización: RLS. Helpers NUEVOS (SECURITY DEFINER STABLE, search_path fijado,
-- mismo idioma que user_role_in_club / user_is_staff_of_team). NO se recrea ninguna
-- función viva.
--
-- ORDEN: tablas → helpers → índices → trigger → RLS. Las funciones SQL validan su
-- cuerpo AL CREARSE, así que user_is_staff_conversation_participant (consulta
-- staff_conversations) va DESPUÉS de las tablas.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. TABLAS
-- ═════════════════════════════════════════════════════════════════════════════

create table public.staff_conversations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  profile_a uuid not null references public.profiles(id) on delete cascade,
  profile_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- Par canónico a<b → un único hilo por par (el caller ordena los dos uuid al crear).
  constraint staff_conversations_distinct check (profile_a <> profile_b),
  constraint staff_conversations_canonical check (profile_a < profile_b),
  constraint staff_conversations_pair_unique unique (club_id, profile_a, profile_b)
);

create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.staff_conversations(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint staff_messages_body_check check (char_length(body) >= 1 and char_length(body) <= 2000)
);

create table public.staff_conversation_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.staff_conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (profile_id, conversation_id)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. HELPERS
-- ═════════════════════════════════════════════════════════════════════════════

-- ¿Es P un miembro del STAFF del club C? El conjunto se deriva de DOS sitios:
--   (1) una membership de GESTIÓN: memberships.role distinto de 'jugador'
--       (admin_club / director / coordinador / entrenador_principal / entrenador_ayudante), y
--   (2) una fila team_staff ACTIVA (left_at IS NULL) cuyo membership pertenece a C.
--       Esto captura 'delegado' y 'preparador_fisico', que NO son roles de club sino
--       de team_staff (y va vía memberships.club_id: teams no tiene club_id directo).
-- Un jugador puro (solo membership 'jugador', sin team_staff activo) queda FUERA.
-- COALESCE en la rama de role: si P no tiene membership en C el subselect es NULL →
-- coalesce(...,false) → deniega (evita el "NULL no bloquea" de #371).
create or replace function public.profile_is_staff_of_club(p_profile_id uuid, p_club_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (
      select m.role
      from public.memberships m
      where m.profile_id = p_profile_id
        and m.club_id = p_club_id
      limit 1
    ) in ('admin_club', 'director', 'coordinador', 'entrenador_principal', 'entrenador_ayudante'),
    false
  )
  or exists (
    select 1
    from public.team_staff ts
    join public.memberships m on m.id = ts.membership_id
    where m.profile_id = p_profile_id
      and m.club_id = p_club_id
      and ts.left_at is null
  );
$$;

-- Conveniencia para el usuario actual. La usan las políticas y, más adelante, el
-- core/app para gatear el selector (que no ofrezca a quien la RLS rechazaría).
create or replace function public.user_is_staff_of_club(p_club_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.profile_is_staff_of_club(auth.uid(), p_club_id);
$$;

-- ¿Es el usuario actual participante de ESTA conversación de staff? SECURITY DEFINER
-- para mirar staff_conversations sin depender de su propia RLS (mismo patrón que
-- user_is_conversation_participant). exists → nunca NULL.
create or replace function public.user_is_staff_conversation_participant(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from public.staff_conversations sc
    where sc.id = p_conversation_id
      and auth.uid() in (sc.profile_a, sc.profile_b)
  );
$$;

grant execute on function public.profile_is_staff_of_club(uuid, uuid) to authenticated;
grant execute on function public.user_is_staff_of_club(uuid) to authenticated;
grant execute on function public.user_is_staff_conversation_participant(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. ÍNDICES (inbox: por participante + fecha del último mensaje; hilo: por conversación)
-- ═════════════════════════════════════════════════════════════════════════════
-- El inbox lista MIS hilos ordenados por recencia. El participante puede estar en
-- cualquiera de las dos columnas del par → un índice por cada lado (un OR sobre dos
-- columnas no aprovecha un único btree).
create index staff_conversations_profile_a_recent_idx
  on public.staff_conversations (profile_a, last_message_at desc);
create index staff_conversations_profile_b_recent_idx
  on public.staff_conversations (profile_b, last_message_at desc);
-- Carga del hilo y cómputo de no-leídos: mensajes de una conversación por fecha.
create index staff_messages_conversation_created_idx
  on public.staff_messages (conversation_id, created_at);

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. last_message_at: bump al insertar mensaje
-- ═════════════════════════════════════════════════════════════════════════════
-- Trigger SECURITY DEFINER: corre como owner → actualiza la fila SIN necesidad de
-- política UPDATE en staff_conversations. Así el hilo queda inmutable para el cliente
-- (solo INSERT+SELECT) y aun así el índice de recencia del inbox es correcto.
create or replace function public.staff_messages_bump_conversation()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  update public.staff_conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger staff_messages_bump_conversation_trg
  after insert on public.staff_messages
  for each row execute function public.staff_messages_bump_conversation();

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. RLS
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.staff_conversations enable row level security;
alter table public.staff_messages enable row level security;
alter table public.staff_conversation_reads enable row level security;

-- staff_conversations ─────────────────────────────────────────────────────────
-- SELECT: SOLO los dos participantes ven el hilo. Ni siquiera otro staff del club ve
-- hilos ajenos. auth.uid() nunca es NULL para el rol 'authenticated'.
create policy staff_conversations_select_participant
  on public.staff_conversations for select to authenticated
  using ( auth.uid() in (profile_a, profile_b) );

-- INSERT: quien crea (a) es uno de los dos, (b) el par va en orden canónico, y
-- (c) AMBOS perfiles son staff del club. Verificar el OTRO perfil es la clave de
-- seguridad: impide abrir hilo contra una familia/jugador (no-staff → false), contra
-- alguien de otro club (no-staff de ESTE club → false), y crear en nombre de terceros.
create policy staff_conversations_insert_staff
  on public.staff_conversations for insert to authenticated
  with check (
    auth.uid() in (profile_a, profile_b)
    and profile_a < profile_b
    and public.profile_is_staff_of_club(profile_a, club_id)
    and public.profile_is_staff_of_club(profile_b, club_id)
  );
-- Sin UPDATE/DELETE de cliente: el hilo es inmutable; last_message_at lo mueve el trigger.

-- staff_messages ──────────────────────────────────────────────────────────────
-- SELECT: solo participantes del hilo.
create policy staff_messages_select_participant
  on public.staff_messages for select to authenticated
  using ( public.user_is_staff_conversation_participant(conversation_id) );

-- INSERT: el emisor ES el usuario actual y es participante. Append-only (sin UPDATE
-- ni DELETE) → nadie edita ni borra cuerpos.
create policy staff_messages_insert_participant
  on public.staff_messages for insert to authenticated
  with check (
    sender_profile_id = auth.uid()
    and public.user_is_staff_conversation_participant(conversation_id)
  );

-- staff_conversation_reads ────────────────────────────────────────────────────
-- Cada quien gestiona SOLO su propio marcador, y solo si es participante del hilo.
create policy staff_conversation_reads_select_own
  on public.staff_conversation_reads for select to authenticated
  using ( profile_id = auth.uid() and public.user_is_staff_conversation_participant(conversation_id) );

create policy staff_conversation_reads_insert_own
  on public.staff_conversation_reads for insert to authenticated
  with check ( profile_id = auth.uid() and public.user_is_staff_conversation_participant(conversation_id) );

create policy staff_conversation_reads_update_own
  on public.staff_conversation_reads for update to authenticated
  using ( profile_id = auth.uid() and public.user_is_staff_conversation_participant(conversation_id) )
  with check ( profile_id = auth.uid() and public.user_is_staff_conversation_participant(conversation_id) );

create policy staff_conversation_reads_delete_own
  on public.staff_conversation_reads for delete to authenticated
  using ( profile_id = auth.uid() and public.user_is_staff_conversation_participant(conversation_id) );
