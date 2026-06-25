-- F14.9 — Cierra el agujero cross-team de capabilities_update.
--
-- Antes: la policy capabilities_update aceptaba a admin/coord/PRINCIPAL del CLUB
-- (user_role_in_club) sin filtrar por equipo → un entrenador_principal podía
-- togglear capabilities de un ayudante de OTRO equipo del club (y, por el patrón
-- club-role, ni siquiera reconocía a un principal de equipo con rol de club
-- ayudante).
--
-- Ahora: admin/coord mantienen alcance club-wide (correcto). Un principal solo
-- puede editar capabilities de staff de SUS equipos: es principal (team_staff.
-- staff_role='entrenador_principal', activo) de un equipo del que el destinatario
-- también es staff activo. Esto se decide a nivel EQUIPO (team_staff), no por
-- memberships.role, coherente con el resto de RLS de equipo.
--
-- Decisiones (casos raros):
--  * Staff en varios equipos: basta compartir UN equipo. Nota: las capabilities
--    son a nivel club (una fila por membership), así que el toggle afecta al
--    ayudante en todos sus equipos — limitación del modelo, no de esta policy.
--  * Anti-escalada: el helper excluye la auto-edición (m_target.profile_id <>
--    auth.uid()), para que un principal-de-equipo con rol de club ayudante no
--    pueda auto-concederse capabilities club-wide (p.ej. can_see_medical).
--
-- Append-only: nueva función + recreación de la policy. INSERT/DELETE de
-- capabilities siguen yendo solo por trigger SECURITY DEFINER.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: ¿el user actual es principal de algún equipo del que p_membership_id
-- es staff activo? (excluye auto-edición).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_is_principal_of_assistant_team(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_staff ts_principal
    join public.memberships m_principal
      on m_principal.id = ts_principal.membership_id
    join public.team_staff ts_target
      on ts_target.team_id = ts_principal.team_id
     and ts_target.left_at is null
    join public.memberships m_target
      on m_target.id = ts_target.membership_id
    where m_principal.profile_id = auth.uid()
      and ts_principal.staff_role = 'entrenador_principal'
      and ts_principal.left_at is null
      and ts_target.membership_id = p_membership_id
      and m_target.profile_id <> auth.uid()   -- no auto-edición (anti-escalada)
  );
$$;

comment on function public.user_is_principal_of_assistant_team(uuid) is
  'F14.9 — TRUE si el user actual es entrenador_principal (team_staff activo) de algún equipo del que la membership destino es staff activo. Excluye la auto-edición. Gobierna quién (además de admin/coord) puede editar capabilities de un ayudante.';

grant execute on function public.user_is_principal_of_assistant_team(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recrear la policy de SELECT: un principal de equipo (aunque su rol de club sea
-- ayudante) debe poder VER las capabilities del staff de sus equipos. Sin esto,
-- el UPDATE no localiza la fila (su WHERE lee columnas y aplica la RLS de SELECT)
-- y la pantalla de capabilities no podría cargar los toggles.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists capabilities_select on public.capabilities;

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
          or public.user_is_principal_of_assistant_team(m.id)
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Recrear la policy de UPDATE con el filtro por equipo.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists capabilities_update on public.capabilities;

create policy capabilities_update on public.capabilities
  for update to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and (
          public.user_role_in_club(m.club_id) in ('admin_club', 'coordinador')
          or public.user_is_principal_of_assistant_team(m.id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and (
          public.user_role_in_club(m.club_id) in ('admin_club', 'coordinador')
          or public.user_is_principal_of_assistant_team(m.id)
        )
    )
  );
