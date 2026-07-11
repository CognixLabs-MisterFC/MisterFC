-- F14B-5b — Invitar admin de club (superadmin) + trigger de OWNER.
--
-- Cierra el backend de la consola: (1) el superadmin invita al admin de un club
-- sin owner; (2) cuando ese admin acepta y se crea su membership admin_club, un
-- trigger genérico le hace OWNER del club (Opción A, Jose). El trigger arregla
-- de paso el gap pre-existente (clubs de onboarding sin owner).
--
-- ALCANCE ESTRICTO: no se toca create_club_with_admin, ni accept_pending_invitations,
-- ni la policy invitations_insert_admin (la RPC la salta por SECURITY DEFINER).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TRIGGER de owner (Opción A). AFTER INSERT on memberships: si entra un
--    admin_club en un club SIN owner → ese profile pasa a owner.
--    La condición owner_profile_id IS NULL va en el UPDATE (no solo en un check
--    previo) → sin carreras: un club que ya tiene owner NUNCA se reasigna; si dos
--    admins entran, el owner queda en el PRIMERO. SECURITY DEFINER para que el
--    UPDATE de clubs funcione con independencia de quién insertó la membership.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_club_owner_on_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin_club' then
    update public.clubs
       set owner_profile_id = new.profile_id
     where id = new.club_id
       and owner_profile_id is null;
  end if;
  return new;
end;
$$;

comment on function public.assign_club_owner_on_admin() is
  'F14B-5b — al crear una membership admin_club en un club sin owner, asigna owner '
  '= ese profile (condición IS NULL en el UPDATE → race-safe, nunca reasigna). '
  'Cubre consola/onboarding/futuro y cierra el gap de clubs sin owner.';

create trigger memberships_assign_club_owner
  after insert on public.memberships
  for each row execute function public.assign_club_owner_on_admin();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. platform_invite_club_admin(p_club_id, p_email) — el superadmin crea la
--    invitación admin_club de un club SIN owner (salta invitations_insert_admin
--    por SECURITY DEFINER). Reinvitable: supersede las admin_club pendientes
--    previas del club (no hay unique en invitations → se borran las pendientes y
--    se inserta una nueva; una sola designación activa por club). Devuelve la
--    invitación para que la acción de consola dispare inviteUserByEmail.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.platform_invite_club_admin(
  p_club_id uuid,
  p_email text
)
returns table (id uuid, token uuid, email text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_uid is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  if not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'club_not_found' using errcode = 'P0001';
  end if;

  -- Esta vía es SOLO para clubs sin owner (regla 1). Con owner ya asignado, la
  -- gestión de staff normal (invitations_insert_admin, exige owner) se encarga.
  if exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_profile_id is not null) then
    raise exception 'club_already_has_admin' using errcode = 'P0001';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- Reinvitar: superseder las invitaciones admin_club PENDIENTES previas del club.
  delete from public.invitations i
   where i.club_id = p_club_id
     and i.role = 'admin_club'
     and i.accepted_at is null;

  return query
    insert into public.invitations (email, club_id, role, created_by)
    values (v_email, p_club_id, 'admin_club', v_uid)
    returning invitations.id, invitations.token, invitations.email;
end;
$$;

comment on function public.platform_invite_club_admin(uuid, text) is
  'F14B-5b — el superadmin invita al admin_club de un club SIN owner (salta '
  'invitations_insert_admin por SECURITY DEFINER). Reinvitable: borra las '
  'admin_club pendientes previas del club e inserta una nueva. Devuelve id/token/'
  'email para que la acción de consola llame a inviteUserByEmail.';

revoke all on function public.platform_invite_club_admin(uuid, text) from public;
grant execute on function public.platform_invite_club_admin(uuid, text) to authenticated;
