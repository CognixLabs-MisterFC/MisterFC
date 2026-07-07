-- F5B-5 — No-leídos por grupo en los chats de equipo.
--
-- El 1:1 usa messages.read_at por-mensaje; en un grupo eso no escala (un mensaje
-- lo leen N personas). Se añade una marca de lectura POR (usuario, conversación):
-- team_conversation_reads.last_read_at = hasta cuándo ha leído ese usuario ese
-- chat. El contador del listado = team_messages posteriores a esa marca que no
-- envió el propio usuario.
--
-- Consistencia con F5B-4 (observer): el no-leídos SOLO cuenta para los chats en
-- los que el usuario PARTICIPA en el sentido de notificaciones, es decir
-- user_can_post_team_chat(team): staff/jugadores siempre; admin/director solo si
-- está 'active'. Así un director que solo observa ~15 grupos NO acumula badges.
--
-- Aditiva. Sin tocar el 1:1, la RLS de mensajes/observer ni el polling.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. team_conversation_reads — marca de lectura por (usuario, chat de equipo)
-- ═════════════════════════════════════════════════════════════════════════════

create table public.team_conversation_reads (
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  team_conversation_id  uuid not null references public.team_conversations(id) on delete cascade,
  last_read_at          timestamptz not null default now(),
  primary key (profile_id, team_conversation_id)
);

create index team_conversation_reads_conv_idx
  on public.team_conversation_reads (team_conversation_id);

comment on table public.team_conversation_reads is
  'F5B-5 — hasta cuándo cada usuario ha leído cada chat de equipo. last_read_at '
  'marca la lectura; los no-leídos son los team_messages posteriores no propios.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1 RLS: cada usuario gestiona SOLO sus propias filas, y solo de chats a los
--     que pertenece (miembro derivado). El SELECT del chat no cambia.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.team_conversation_reads enable row level security;

create policy team_conversation_reads_select_own on public.team_conversation_reads
  for select to authenticated
  using (
    profile_id = auth.uid()
    and public.user_is_team_chat_member_by_conversation(team_conversation_id)
  );

create policy team_conversation_reads_insert_own on public.team_conversation_reads
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and public.user_is_team_chat_member_by_conversation(team_conversation_id)
  );

create policy team_conversation_reads_update_own on public.team_conversation_reads
  for update to authenticated
  using (
    profile_id = auth.uid()
    and public.user_is_team_chat_member_by_conversation(team_conversation_id)
  )
  with check (
    profile_id = auth.uid()
    and public.user_is_team_chat_member_by_conversation(team_conversation_id)
  );

create policy team_conversation_reads_delete_own on public.team_conversation_reads
  for delete to authenticated
  using (
    profile_id = auth.uid()
    and public.user_is_team_chat_member_by_conversation(team_conversation_id)
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Contador de no-leídos por grupo para el usuario actual
-- ═════════════════════════════════════════════════════════════════════════════
-- Devuelve (team_conversation_id, unread) SOLO de los chats donde el usuario
-- participa (user_can_post_team_chat) y con al menos 1 no-leído. Los grupos sin
-- no-leídos no aparecen (el listado los trata como 0). SECURITY DEFINER pero
-- acotado a auth.uid(): cada quien solo obtiene lo suyo. El director observer
-- queda EXCLUIDO (user_can_post_team_chat=false en los chats que solo vigila).

create or replace function public.team_chat_unread_counts()
returns table (team_conversation_id uuid, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  select tc.id as team_conversation_id,
         count(m.id)::int as unread
    from public.team_conversations tc
    join public.team_messages m
      on m.team_conversation_id = tc.id
    left join public.team_conversation_reads r
      on r.team_conversation_id = tc.id
     and r.profile_id = auth.uid()
   where public.user_can_post_team_chat(tc.team_id)
     and m.sender_profile_id <> auth.uid()
     and (r.last_read_at is null or m.created_at > r.last_read_at)
   group by tc.id;
$$;

comment on function public.team_chat_unread_counts() is
  'F5B-5 — no-leídos por chat de equipo del usuario actual. Solo chats donde '
  'participa (user_can_post_team_chat): staff/jugadores siempre; director solo si '
  'active (los observer se excluyen). Cuenta team_messages no propios posteriores '
  'a team_conversation_reads.last_read_at.';

grant execute on function public.team_chat_unread_counts() to authenticated;
