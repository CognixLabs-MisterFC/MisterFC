-- F5 Lote A hotfix 2026-05-30
--   Feature D: anuncios globales (club-wide o multi-team) desde /es/anuncios.
--   Bugs B+C: ampliar RLS INSERT de conversations + announcements para
--     incluir la rama "team_staff.staff_role = entrenador_principal" del
--     ayudante club. Patrón calcado de PR #24 (4f3bf39) — F2.6 dejó
--     team_staff como autoridad por-team y la RLS de F5 Lote A se quedó
--     atrás (solo cap o role club).
--
-- Cambios:
--   1. announcements.club_id NOT NULL (backfill desde team_id legacy).
--   2. announcements.team_id pasa a NULLABLE. NULL = club-wide.
--   3. Trigger announcements_same_club: si team_id presente, valida
--      consistencia con club_id.
--   4. RLS SELECT: jugador/coach ve solo su team + club-wide. Admin/coord
--      ve todo.
--   5. RLS INSERT: team_id NULL solo admin/coord; team_id NOT NULL añade
--      rama "principal-by-team_staff del team específico".
--   6. RLS UPDATE/DELETE: actualizadas para usar club_id directo (más
--      barato que el join via teams→categories).
--   7. conversations.RLS INSERT: añade rama "principal-by-team_staff de
--      algún team del club activo".

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. announcements.club_id + backfill + NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.announcements
  add column if not exists club_id uuid references public.clubs(id) on delete cascade;

update public.announcements a
   set club_id = (
     select c.club_id
       from public.teams t
       join public.categories c on c.id = t.category_id
      where t.id = a.team_id
   )
 where a.club_id is null
   and a.team_id is not null;

alter table public.announcements alter column club_id set not null;
alter table public.announcements alter column team_id drop not null;

create index if not exists announcements_club_recent_idx
  on public.announcements (club_id, created_at desc);

comment on column public.announcements.team_id is
  'NULL = club-wide (todo el club). NOT NULL = anuncio dirigido a un team concreto. Para multi-team (admin selecciona 2+ teams), creamos N filas — una por team.';
comment on column public.announcements.club_id is
  'Club del anuncio. Si team_id presente, debe coincidir con el club del team (trigger valida).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger same_club
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.announcements_same_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_team_club uuid;
begin
  if new.team_id is not null then
    select c.club_id into v_team_club
      from public.teams t
      join public.categories c on c.id = t.category_id
     where t.id = new.team_id;
    if v_team_club is null or v_team_club <> new.club_id then
      raise exception 'announcement_team_club_mismatch'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists announcements_same_club_trg on public.announcements;
create trigger announcements_same_club_trg
before insert or update on public.announcements
for each row execute function public.announcements_same_club();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS announcements ampliada
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: admin/coord ven todo del club; team-bound visibles para staff del
-- team + jugadores/familia del team; club-wide visibles para cualquier
-- miembro del club.
drop policy if exists announcements_select_club_member on public.announcements;
create policy announcements_select_club_member on public.announcements
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or (team_id is null and public.user_role_in_club(club_id) is not null)
    or (
      team_id is not null
      and (
        public.user_is_staff_of_team(team_id)
        or exists (
          select 1
            from public.team_members tm
            join public.player_accounts pa on pa.player_id = tm.player_id
           where tm.team_id = announcements.team_id
             and tm.left_at is null
             and pa.profile_id = auth.uid()
        )
      )
    )
  );

-- INSERT: team_id NULL solo admin/coord; team_id NOT NULL añade rama
-- principal-by-team_staff del team específico (Bug C fix).
drop policy if exists announcements_insert_staff on public.announcements;
create policy announcements_insert_managers on public.announcements
  for insert to authenticated
  with check (
    author_profile_id = auth.uid()
    and (
      (team_id is null
        and public.user_role_in_club(club_id) in ('admin_club', 'coordinador'))
      or (
        team_id is not null
        and (
          public.user_role_in_club(club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
          or public.user_has_capability_in_club(club_id, 'can_message_families')
          or exists (
            select 1
              from public.team_staff ts
              join public.memberships m on m.id = ts.membership_id
             where ts.team_id = announcements.team_id
               and ts.staff_role = 'entrenador_principal'
               and ts.left_at is null
               and m.profile_id = auth.uid()
          )
        )
      )
    )
  );

-- UPDATE: autor o admin/coord/principal del club. Usamos club_id directo.
drop policy if exists announcements_update_author_or_manager on public.announcements;
create policy announcements_update_author_or_manager on public.announcements
  for update to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
  )
  with check (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
  );

drop policy if exists announcements_delete_author_or_manager on public.announcements;
create policy announcements_delete_author_or_manager on public.announcements
  for delete to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS conversations.INSERT ampliada (Bug B fix)
-- ─────────────────────────────────────────────────────────────────────────────
-- Añade rama principal-by-team_staff de algún team del club activo. Un
-- ayudante club que es principal de team X via team_staff puede iniciar
-- conversaciones con cualquier player del club (RLS no filtra el player
-- aquí; el server action ya valida que el player está en el club).

drop policy if exists conversations_insert_coach on public.conversations;
create policy conversations_insert_coach on public.conversations
  for insert to authenticated
  with check (
    coach_profile_id = auth.uid()
    and (
      public.user_role_in_club(club_id) in ('admin_club', 'coordinador', 'entrenador_principal')
      or public.user_has_capability_in_club(club_id, 'can_message_families')
      or exists (
        select 1
          from public.team_staff ts
          join public.memberships m on m.id = ts.membership_id
          join public.teams t on t.id = ts.team_id
          join public.categories c on c.id = t.category_id
         where ts.staff_role = 'entrenador_principal'
           and ts.left_at is null
           and m.profile_id = auth.uid()
           and c.club_id = conversations.club_id
      )
    )
  );
