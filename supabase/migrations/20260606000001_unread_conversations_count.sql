-- F5 Bug M — Helper SECURITY DEFINER que cuenta conversaciones con mensajes
-- no leídos del user actual.
--
-- Síntoma: el badge "Mensajes" del sidebar (y la card de mensajes en home)
-- no aparecía para admin_club a pesar de tener mensajes recibidos
-- pendientes. La query original sobre `messages` con `.is('read_at', null)
-- .neq('sender_profile_id', user_id)` depende de la RLS SELECT de messages
-- (`user_is_conversation_participant` SECURITY DEFINER). Aunque la RLS
-- devolvía las filas correctas en tests aislados, el resultado en el
-- runtime de la app era 0 para admin.
--
-- Fix robusto: una función SECURITY DEFINER que hace EXPLICITAMENTE el
-- predicate de "participante" + el conteo, sin pasar por la RLS de messages.
-- El predicate es idéntico a `user_is_conversation_participant` pero
-- inline. Esto:
--   1. Elimina cualquier ambigüedad sobre RLS / planner / Supabase client.
--   2. Devuelve un único int — el caller solo lee `count`, sin SET de
--      conversation_ids en JS.
--   3. Es más barato: el planner tiene `count(distinct)` y un JOIN
--      sencillo, en lugar de scan + dedupe en cliente.

create or replace function public.user_unread_conversations_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.conversation_id)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.read_at is null
     and m.sender_profile_id <> auth.uid()
     and (
       c.coach_profile_id = auth.uid()
       or exists (
         select 1 from public.player_accounts pa
          where pa.player_id = c.player_id
            and pa.profile_id = auth.uid()
       )
     );
$$;

comment on function public.user_unread_conversations_count() is
  'F5 Bug M — número de conversaciones con mensajes no leídos para el user actual. SECURITY DEFINER + predicate "participante" inline para evitar dependencia de la RLS de messages.';
