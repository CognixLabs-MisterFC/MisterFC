-- Subfase 1.7 — RLS policies + helper functions
--
-- Esta migración aporta:
--   1. Funciones helper en schema public: user_role_in_club, user_has_capability_in_club.
--      (No usamos auth.* porque el schema auth es propiedad de supabase_auth_admin
--      y no se nos permite crear funciones ahí desde una migración normal.)
--   2. Policies para todas las tablas creadas en 1.1–1.6.
--
-- Diseño global:
--   - Aislamiento multi-tenant por club_id. Un user de club A no puede leer ni
--     modificar nada del club B (ni siquiera el nombre del club).
--   - Bootstrap del primer admin: cualquier user autenticado SIN memberships
--     puede crear su primer club + membership admin_club (flow /onboarding).
--   - 5 roles: admin_club > coordinador > entrenador_principal > entrenador_ayudante
--     > jugador. Las capabilities del ayudante están encima.
--   - Las policies son INTENCIONADAMENTE permisivas para coaches genéricos en
--     1.7 (no diferencian entrenador_principal vs ayudante por equipo). Esa
--     granularidad llega en Fase 2 cuando exista UI de gestión por equipo.
--
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_role_in_club(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.memberships
  where club_id = p_club_id
    and profile_id = auth.uid()
  limit 1;
$$;

comment on function public.user_role_in_club(uuid) is
  'Rol del user actual (auth.uid()) en el club indicado. NULL si no es miembro.';

create or replace function public.user_has_capability_in_club(
  p_club_id uuid,
  p_capability text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.granted
      from public.memberships m
      join public.capabilities c on c.membership_id = m.id
      where m.club_id = p_club_id
        and m.profile_id = auth.uid()
        and c.capability_name = p_capability
      limit 1
    ),
    false
  );
$$;

comment on function public.user_has_capability_in_club(uuid, text) is
  'true si el user actual tiene la capability concedida en una membership del club indicado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- clubs
-- ─────────────────────────────────────────────────────────────────────────────

create policy clubs_select_member on public.clubs
  for select to authenticated
  using (public.user_role_in_club(id) is not null);

-- Bootstrap del primer club: cualquier user autenticado sin memberships puede crearlo.
-- Si ya tiene alguna membership, no puede crear más clubs vía INSERT directo (eso
-- es el flow de invitaciones / multi-club en fases posteriores).
create policy clubs_insert_first on public.clubs
  for insert to authenticated
  with check (
    auth.uid() is not null
    and not exists (
      select 1 from public.memberships where profile_id = auth.uid()
    )
  );

create policy clubs_update_admin on public.clubs
  for update to authenticated
  using (public.user_role_in_club(id) = 'admin_club')
  with check (public.user_role_in_club(id) = 'admin_club');

-- ─────────────────────────────────────────────────────────────────────────────
-- categories
-- ─────────────────────────────────────────────────────────────────────────────

create policy categories_select_member on public.categories
  for select to authenticated
  using (public.user_role_in_club(club_id) is not null);

create policy categories_write_admin_coord on public.categories
  for all to authenticated
  using (public.user_role_in_club(club_id) in ('admin_club', 'coordinador'))
  with check (public.user_role_in_club(club_id) in ('admin_club', 'coordinador'));

-- ─────────────────────────────────────────────────────────────────────────────
-- teams
-- ─────────────────────────────────────────────────────────────────────────────

create policy teams_select_member on public.teams
  for select to authenticated
  using (
    exists (
      select 1
      from public.categories c
      where c.id = category_id
        and public.user_role_in_club(c.club_id) is not null
    )
  );

create policy teams_write_admin_coord on public.teams
  for all to authenticated
  using (
    exists (
      select 1
      from public.categories c
      where c.id = category_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
    )
  )
  with check (
    exists (
      select 1
      from public.categories c
      where c.id = category_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────────────────────

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Permite ver el profile de quienes comparten al menos un club contigo
-- (para listas de jugadores/staff, en Fase 2 esto se afina por equipo).
create policy profiles_select_clubmate on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m_self
      join public.memberships m_other on m_other.club_id = m_self.club_id
      where m_self.profile_id = auth.uid()
        and m_other.profile_id = public.profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- INSERT solo vía trigger handle_new_user (SECURITY DEFINER), no por user.
-- Sin policy de INSERT → bloqueado para clientes.

-- ─────────────────────────────────────────────────────────────────────────────
-- memberships
-- ─────────────────────────────────────────────────────────────────────────────

create policy memberships_select_clubmate on public.memberships
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.user_role_in_club(club_id) is not null
  );

-- INSERT:
--   (a) Bootstrap admin_club: user sin memberships se inserta a sí mismo como admin_club.
--   (b) Admin/coord del club inserta a otra persona (aceptación de invitación).
create policy memberships_insert_bootstrap_or_admin on public.memberships
  for insert to authenticated
  with check (
    (
      profile_id = auth.uid()
      and role = 'admin_club'
      and not exists (
        select 1 from public.memberships m where m.profile_id = auth.uid()
      )
    )
    or
    (
      -- Aceptación de invitación: el user se autoinserta porque la invitación
      -- ya fue creada por admin/coord. Verificación de email match va en la
      -- server action (SECURITY: la lectura del email exige RLS sobre invitations
      -- que también validamos abajo).
      profile_id = auth.uid()
      and exists (
        select 1 from public.invitations i
        where i.email ilike (select email from auth.users where id = auth.uid())
          and i.club_id = memberships.club_id
          and i.role = memberships.role
          and i.accepted_at is null
          and i.expires_at > now()
      )
    )
    or
    (
      -- Admin/coord insertando manualmente (futuro: UI de gestión sin invitación).
      public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    )
  );

create policy memberships_update_admin on public.memberships
  for update to authenticated
  using (public.user_role_in_club(club_id) in ('admin_club', 'coordinador'))
  with check (public.user_role_in_club(club_id) in ('admin_club', 'coordinador'));

create policy memberships_delete_admin on public.memberships
  for delete to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club');

-- ─────────────────────────────────────────────────────────────────────────────
-- players
-- ─────────────────────────────────────────────────────────────────────────────

create policy players_select_member on public.players
  for select to authenticated
  using (public.user_role_in_club(club_id) is not null);

create policy players_write_staff on public.players
  for all to authenticated
  using (
    public.user_role_in_club(club_id) in (
      'admin_club', 'coordinador', 'entrenador_principal'
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
  )
  with check (
    public.user_role_in_club(club_id) in (
      'admin_club', 'coordinador', 'entrenador_principal'
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- player_accounts
-- ─────────────────────────────────────────────────────────────────────────────

create policy player_accounts_select_self_or_staff on public.player_accounts
  for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante'
        )
    )
  );

create policy player_accounts_write_admin on public.player_accounts
  for all to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in ('admin_club', 'coordinador')
    )
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in ('admin_club', 'coordinador')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- team_members
-- ─────────────────────────────────────────────────────────────────────────────

create policy team_members_select_member on public.team_members
  for select to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) is not null
    )
  );

create policy team_members_write_staff on public.team_members
  for all to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
    )
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
    )
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
    )
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- capabilities
-- ─────────────────────────────────────────────────────────────────────────────

-- Cada user puede ver sus propias capabilities + admin/coord/principal del club las ven.
create policy capabilities_select on public.capabilities
  for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and (
          m.profile_id = auth.uid()
          or public.user_role_in_club(m.club_id) in (
            'admin_club', 'coordinador', 'entrenador_principal'
          )
        )
    )
  );

-- UPDATE solo admin/coord/principal del club al que pertenece la membership.
create policy capabilities_update on public.capabilities
  for update to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and public.user_role_in_club(m.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and public.user_role_in_club(m.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
    )
  );

-- INSERT/DELETE solo vía trigger (SECURITY DEFINER), no por cliente.

-- ─────────────────────────────────────────────────────────────────────────────
-- invitations
-- ─────────────────────────────────────────────────────────────────────────────

create policy invitations_select_admin_or_invited on public.invitations
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or email ilike (select email from auth.users where id = auth.uid())
  );

create policy invitations_insert_admin on public.invitations
  for insert to authenticated
  with check (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
  );

-- UPDATE solo para que el flow de aceptar pueda marcar accepted_at.
-- El check de identidad ya lo hace la server action; aquí permitimos al user
-- cuyo email coincide con la invitación marcarla aceptada.
create policy invitations_update_invited_or_admin on public.invitations
  for update to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or email ilike (select email from auth.users where id = auth.uid())
  )
  with check (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or email ilike (select email from auth.users where id = auth.uid())
  );

create policy invitations_delete_admin on public.invitations
  for delete to authenticated
  using (public.user_role_in_club(club_id) in ('admin_club', 'coordinador'));
