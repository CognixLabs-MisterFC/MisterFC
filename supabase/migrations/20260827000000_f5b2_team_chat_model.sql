-- F5B-2 — Modelo de chat de EQUIPO (grupo).
--
-- Tabla nueva `team_conversations` (una por equipo) + `team_messages`, SEPARADAS
-- del 1:1 (conversations/messages, que NO se tocan). Miembros DERIVADOS (sin
-- tabla de participantes): la pertenencia se computa en la RLS a partir de
-- team_members(vigentes) ∪ team_staff ∪ directores/admin del club → auto-sincroniza
-- con altas/bajas. Grupo ABIERTO BIDIRECCIONAL: todo miembro lee Y escribe (el
-- modo observer del director llega en F5B-4). Aislamiento estricto por equipo/club.
--
-- Sin realtime aquí (F5B-3b: polling + push). Sin UI (F5B-3).

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Helpers de pertenencia (SECURITY DEFINER, sin recursión RLS)
-- ═════════════════════════════════════════════════════════════════════════════

-- club_id del equipo (via categories; teams no tiene club_id directo).
create or replace function public.team_club_id(p_team_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cat.club_id
    from public.teams t
    join public.categories cat on cat.id = t.category_id
   where t.id = p_team_id;
$$;

comment on function public.team_club_id(uuid) is
  'F5B-2 — club_id del equipo (teams→categories.club_id). Helper para chat de equipo.';

-- ¿El user es miembro del chat del equipo? = staff del equipo ∪ jugador/familia
-- del roster vigente ∪ admin/director del club. Reutiliza los helpers existentes.
create or replace function public.user_is_team_chat_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null and (
    public.user_is_staff_of_team(p_team_id)
    or public.user_is_team_member_account(p_team_id)
    or public.user_is_admin_or_director(public.team_club_id(p_team_id))
  );
$$;

comment on function public.user_is_team_chat_member(uuid) is
  'F5B-2 — TRUE si el user pertenece al chat del equipo: staff del equipo ∪ '
  'jugador/familia del roster vigente ∪ admin/director del club. Miembros DERIVADOS.';

grant execute on function public.team_club_id(uuid) to authenticated;
grant execute on function public.user_is_team_chat_member(uuid) to authenticated;

-- (El wrapper por conversación se define en §3.1, tras crear team_conversations.)

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. team_conversations — una conversación de grupo por equipo
-- ═════════════════════════════════════════════════════════════════════════════

create table public.team_conversations (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  kind             text not null default 'team' check (kind in ('team')),
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  -- Un único hilo de grupo por equipo.
  constraint team_conversations_team_unique unique (team_id)
);

create index team_conversations_club_recent_idx on public.team_conversations (club_id, last_message_at desc);

comment on table public.team_conversations is
  'F5B-2 — hilo de grupo por equipo. Miembros derivados (staff ∪ roster vigente ∪ directores). club_id derivado del team por trigger.';

-- Trigger: derivar club_id del team (integridad + evita que el cliente lo mande
-- mal). Mismo espíritu que conversations_same_club del 1:1.
create or replace function public.team_conversations_set_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select public.team_club_id(new.team_id) into v_club;
  if v_club is null then
    raise exception 'team_conversation_team_not_found' using errcode = 'check_violation';
  end if;
  new.club_id := v_club;
  return new;
end;
$$;

create trigger team_conversations_set_club_trg
before insert on public.team_conversations
for each row execute function public.team_conversations_set_club();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. team_messages — mensaje de grupo
-- ═════════════════════════════════════════════════════════════════════════════
-- Sin read_at por mensaje: en un grupo el "leído" es por (user, conversación),
-- no por mensaje. El tracking de no-leídos del grupo se aborda en F5B-3 (UI).

create table public.team_messages (
  id                    uuid primary key default gen_random_uuid(),
  team_conversation_id  uuid not null references public.team_conversations(id) on delete cascade,
  sender_profile_id     uuid not null references public.profiles(id) on delete restrict,
  body                  text not null check (char_length(body) between 1 and 2000),
  created_at            timestamptz not null default now()
);

create index team_messages_conv_recent_idx on public.team_messages (team_conversation_id, created_at desc);

comment on table public.team_messages is
  'F5B-2 — mensaje de grupo. sender_profile_id forzado a auth.uid() por trigger.';

-- Trigger: forzar sender = auth.uid() (mismo patrón que messages_force_sender).
create or replace function public.team_messages_force_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = 'insufficient_privilege';
  end if;
  if new.sender_profile_id is distinct from auth.uid() then
    raise exception 'sender_must_equal_auth_uid' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger team_messages_force_sender_trg
before insert on public.team_messages
for each row execute function public.team_messages_force_sender();

-- Trigger: bump team_conversations.last_message_at en cada mensaje.
create or replace function public.team_messages_bump_conv()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_conversations
     set last_message_at = new.created_at
   where id = new.team_conversation_id;
  return new;
end;
$$;

create trigger team_messages_bump_conv_trg
after insert on public.team_messages
for each row execute function public.team_messages_bump_conv();

-- 3.1 Wrapper por conversación (ya existe team_conversations). Resuelve team_id
--     por dentro (SECURITY DEFINER) sin tropezar con la RLS de team_conversations.
create or replace function public.user_is_team_chat_member_by_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_is_team_chat_member((
    select tc.team_id
      from public.team_conversations tc
     where tc.id = p_conversation_id
  ));
$$;

comment on function public.user_is_team_chat_member_by_conversation(uuid) is
  'F5B-2 — TRUE si el user es miembro del chat de la team_conversation dada.';

grant execute on function public.user_is_team_chat_member_by_conversation(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. RLS — team_conversations
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.team_conversations enable row level security;

-- SELECT: cualquier miembro del chat del equipo (derivado).
create policy team_conversations_select_member on public.team_conversations
  for select to authenticated
  using (public.user_is_team_chat_member(team_id));

-- INSERT: crear el hilo del equipo lo hacen staff del equipo o admin/director del
-- club. Jugadores/familia NO crean el hilo (solo participan cuando existe).
-- WITH CHECK sobre team_id (el club_id lo fija el trigger). Aislamiento: los
-- helpers filtran por el team/club correctos.
create policy team_conversations_insert_staff_or_director on public.team_conversations
  for insert to authenticated
  with check (
    public.user_is_staff_of_team(team_id)
    or public.user_is_admin_or_director(public.team_club_id(team_id))
  );

-- UPDATE/DELETE: no desde cliente. last_message_at lo bumpea el trigger (definer).

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. RLS — team_messages
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.team_messages enable row level security;

-- SELECT: miembro del chat de la conversación padre.
create policy team_messages_select_member on public.team_messages
  for select to authenticated
  using (public.user_is_team_chat_member_by_conversation(team_conversation_id));

-- INSERT: miembro del chat, escribiendo en su propio nombre (bidireccional —
-- todos los miembros escriben). El trigger refuerza sender = auth.uid().
-- (El modo observer del director se añade en F5B-4.)
create policy team_messages_insert_member on public.team_messages
  for insert to authenticated
  with check (
    sender_profile_id = auth.uid()
    and public.user_is_team_chat_member_by_conversation(team_conversation_id)
  );

-- UPDATE/DELETE: no permitidos.

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Resolutor de destinatarios para el fan-out de notificaciones (F5B-3)
-- ═════════════════════════════════════════════════════════════════════════════
-- Devuelve los profile_id del grupo (staff ∪ jugador/familia vigentes ∪
-- directores/admin del club). SECURITY DEFINER; se llama desde el server action
-- de envío (F5B-3) para emitNotificationFanOut. UNION dedupe implícito.

create or replace function public.team_chat_member_profile_ids(p_team_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- staff del equipo (vínculo team_staff activo)
  select m.profile_id
    from public.team_staff ts
    join public.memberships m on m.id = ts.membership_id
   where ts.team_id = p_team_id
     and ts.left_at is null
  union
  -- jugador/familia del roster vigente (via player_accounts)
  select pa.profile_id
    from public.team_members tm
    join public.player_accounts pa on pa.player_id = tm.player_id
   where tm.team_id = p_team_id
     and tm.left_at is null
  union
  -- admin/director del club del equipo
  select m2.profile_id
    from public.memberships m2
   where m2.club_id = public.team_club_id(p_team_id)
     and m2.role in ('admin_club', 'director');
$$;

comment on function public.team_chat_member_profile_ids(uuid) is
  'F5B-2 — profile_id de los miembros del chat del equipo (staff ∪ roster vigente ∪ '
  'directores/admin del club). Para el fan-out de notificaciones en F5B-3. UNION dedupe.';

grant execute on function public.team_chat_member_profile_ids(uuid) to authenticated;
