-- F5B-4 — Supervisión de dirección: modo OBSERVER del director en el chat de equipo.
--
-- Contexto (F5B-2/3): el director/admin, por ser miembro derivado de TODOS los
-- chats del club (user_is_admin_or_director), hoy lee Y escribe Y recibe push de
-- todos. Decisión de producto: por defecto el director entra en modo OBSERVER
-- (VE todo, pero NO escribe y NO recibe notificaciones); puede ACTIVAR un chat
-- concreto para participar (escribir + recibir).
--
-- Este cambio es ADITIVO y SOLO afecta al director/admin:
--   · SELECT de team_messages NO cambia (el director sigue viendo todo).
--   · INSERT de team_messages: el director necesita participación 'active' en ese
--     team; staff (entrenadores) y jugadores/familia NO se ven afectados.
--   · Fan-out: excluye a los directores en observer (sin fila 'active').
--
-- Sin realtime, sin tocar el 1:1 ni el polling.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. team_chat_participation — participación explícita del director en un chat
-- ═════════════════════════════════════════════════════════════════════════════
-- Semántica: SOLO aplica a directores/admins. La AUSENCIA de fila para un
-- director = observer (default observer sin necesidad de fila). Una fila con
-- mode='active' = participa en ese chat. mode='observer' es un estado explícito
-- equivalente a la ausencia (permite al toggle volver a observar sin borrar).
-- Staff/jugadores NO usan esta tabla: participan por su pertenencia derivada.

create table public.team_chat_participation (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  mode        text not null default 'observer' check (mode in ('observer', 'active')),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, team_id)
);

create index team_chat_participation_active_idx
  on public.team_chat_participation (team_id, profile_id)
  where mode = 'active';

comment on table public.team_chat_participation is
  'F5B-4 — participación del DIRECTOR/ADMIN en un chat de equipo. Ausencia de fila '
  '= observer (default). mode=active => escribe y recibe notificaciones de ese chat. '
  'No aplica a staff/jugadores (participan por pertenencia derivada).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1 RLS de la tabla: el director gestiona SU propia participación en chats de
--     SU club. profile_id forzado a auth.uid(); team acotado al club del director.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.team_chat_participation enable row level security;

-- SELECT: el propio director ve sus filas (para pintar el toggle).
create policy team_chat_participation_select_own on public.team_chat_participation
  for select to authenticated
  using (
    profile_id = auth.uid()
    and public.user_is_admin_or_director(public.team_club_id(team_id))
  );

-- INSERT/UPDATE/DELETE: el propio director sobre chats de su club. Solo
-- admin/director puede tener participación (staff/jugadores no la usan).
create policy team_chat_participation_insert_own on public.team_chat_participation
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and public.user_is_admin_or_director(public.team_club_id(team_id))
  );

create policy team_chat_participation_update_own on public.team_chat_participation
  for update to authenticated
  using (
    profile_id = auth.uid()
    and public.user_is_admin_or_director(public.team_club_id(team_id))
  )
  with check (
    profile_id = auth.uid()
    and public.user_is_admin_or_director(public.team_club_id(team_id))
  );

create policy team_chat_participation_delete_own on public.team_chat_participation
  for delete to authenticated
  using (
    profile_id = auth.uid()
    and public.user_is_admin_or_director(public.team_club_id(team_id))
  );

-- Trigger: bump updated_at en cada upsert.
create or replace function public.team_chat_participation_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger team_chat_participation_touch_trg
before insert or update on public.team_chat_participation
for each row execute function public.team_chat_participation_touch();

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Helper de escritura: ¿puede el user ESCRIBIR en el chat de este equipo?
-- ═════════════════════════════════════════════════════════════════════════════
-- Diferente de la PERTENENCIA (user_is_team_chat_member, que gobierna el SELECT):
--   · staff del equipo            → siempre (sin cambio)
--   · jugador/familia vigente     → siempre (sin cambio)
--   · admin/director del club     → SOLO si tiene participación mode='active'
-- Un director en observer (sin fila 'active') NO pasa este gate.

create or replace function public.user_can_post_team_chat(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null and (
    public.user_is_staff_of_team(p_team_id)
    or public.user_is_team_member_account(p_team_id)
    or (
      public.user_is_admin_or_director(public.team_club_id(p_team_id))
      and exists (
        select 1
          from public.team_chat_participation p
         where p.profile_id = auth.uid()
           and p.team_id = p_team_id
           and p.mode = 'active'
      )
    )
  );
$$;

comment on function public.user_can_post_team_chat(uuid) is
  'F5B-4 — TRUE si el user puede ESCRIBIR en el chat del equipo: staff ∪ '
  'jugador/familia vigentes (siempre) ∪ admin/director SOLO con participación active. '
  'El SELECT sigue gobernado por user_is_team_chat_member (el director ve todo).';

create or replace function public.user_can_post_team_chat_by_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_can_post_team_chat((
    select tc.team_id
      from public.team_conversations tc
     where tc.id = p_conversation_id
  ));
$$;

comment on function public.user_can_post_team_chat_by_conversation(uuid) is
  'F5B-4 — user_can_post_team_chat resuelto por team_conversation_id (para la RLS INSERT).';

grant execute on function public.user_can_post_team_chat(uuid) to authenticated;
grant execute on function public.user_can_post_team_chat_by_conversation(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. RLS team_messages — solo cambia el INSERT (SELECT intacto)
-- ═════════════════════════════════════════════════════════════════════════════
-- Antes: user_is_team_chat_member_by_conversation (cualquier miembro escribía,
-- incluido el director). Ahora: user_can_post_team_chat_by_conversation, que
-- exige participación 'active' al director. Staff/jugadores NO cambian (siguen
-- entrando por las dos primeras ramas del helper).

drop policy if exists team_messages_insert_member on public.team_messages;

create policy team_messages_insert_member on public.team_messages
  for insert to authenticated
  with check (
    sender_profile_id = auth.uid()
    and public.user_can_post_team_chat_by_conversation(team_conversation_id)
  );

-- (SELECT team_messages_select_member SIN CAMBIOS: el director sigue viendo todo.)

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Fan-out — excluir a los directores en observer
-- ═════════════════════════════════════════════════════════════════════════════
-- Se MODIFICA el resolutor team_chat_member_profile_ids: la rama de admin/director
-- ahora exige participación 'active' en el team. Así el director solo recibe push
-- de los chats que activó. Staff y jugadores/familia siguen SIEMPRE (ramas 1 y 2
-- sin cambio). Un director que además sea staff del equipo entra por la rama de
-- staff (participa de verdad) — coherente con el INSERT.

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
  -- admin/director del club del equipo SOLO si activó la participación en este
  -- chat (los que están en observer no reciben notificaciones). F5B-4.
  select m2.profile_id
    from public.memberships m2
    join public.team_chat_participation p
      on p.profile_id = m2.profile_id
     and p.team_id = p_team_id
     and p.mode = 'active'
   where m2.club_id = public.team_club_id(p_team_id)
     and m2.role in ('admin_club', 'director');
$$;

comment on function public.team_chat_member_profile_ids(uuid) is
  'F5B-4 — profile_id de los DESTINATARIOS de notificación del chat del equipo: '
  'staff ∪ jugador/familia vigentes (siempre) ∪ admin/director SOLO con '
  'participación active (los observer se excluyen). UNION dedupe.';
