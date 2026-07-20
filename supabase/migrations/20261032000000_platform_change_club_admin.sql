-- Cambiar el admin (owner) de un club — consola superadmin.
--
-- Corta al admin actual de forma INMEDIATA (le quita la membership admin_club de
-- ESTE club) e invita a uno nuevo por email. El nuevo se convierte en owner cuando
-- acepta (trigger assign_club_owner_on_admin, ya existente).
--
-- MODELO (invariante): admin_club = owner, uno por club (índice RM-1
-- memberships_one_admin_per_club). El owner nunca se diseñó para cambiarse; esta es
-- la ÚNICA vía sancionada para hacerlo.
--
-- ── Protección del owner a nivel de BD ──────────────────────────────────────────
-- Hoy la inmutabilidad del owner vive en RLS (memberships_delete_admin: NOT
-- profile_is_club_owner) + en la RPC admin_update_staff_role (owner_immutable). Una
-- SECURITY DEFINER con bypassrls (como esta) se salta la RLS, así que sin más
-- protección CUALQUIER definer podría borrar al owner por accidente. Añadimos un
-- trigger BEFORE DELETE que BLOQUEA borrar la membership admin_club; la única forma
-- de borrarla es desactivar el trigger dentro de la transacción sancionada (esta RPC).
--
-- ⚠️ Caveat (documentado): las FK clubs→memberships y profiles→memberships son
-- ON DELETE CASCADE. Hoy NADA borra clubs ni auth.users/profiles (la supresión RGPD
-- F14-7 es SOFT, no borra cuentas), así que el trigger no rompe ningún flujo. Si en
-- el futuro se añade borrado duro de club o de cuenta, ese flujo tendrá que
-- desactivar/contemplar este trigger (o el CASCADE fallará al llegar al admin_club).

-- ── 1. Trigger de protección del owner ─────────────────────────────────────────
create or replace function public.protect_club_owner_membership()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Solo se llega aquí para filas admin_club (WHEN del trigger). Bloqueo duro: la
  -- vía sancionada (platform_change_club_admin) desactiva el trigger para su DELETE.
  raise exception 'owner_membership_protected'
    using errcode = 'P0001',
          hint = 'usa platform_change_club_admin para cambiar el admin del club';
  return old;
end;
$function$;

drop trigger if exists protect_club_owner_membership on public.memberships;
create trigger protect_club_owner_membership
  before delete on public.memberships
  for each row
  when (old.role = 'admin_club')
  execute function public.protect_club_owner_membership();

-- ── 2. RPC de cambio de admin ──────────────────────────────────────────────────
create or replace function public.platform_change_club_admin(
  p_club_id uuid,
  p_new_email text
)
returns table(invitation_id uuid, token uuid, email text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_email     text := lower(btrim(coalesce(p_new_email, '')));
  v_old_admin uuid;
begin
  if v_uid is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  if not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'club_not_found' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'email_invalid' using errcode = '22023';
  end if;

  -- Admin actual del club (RM-1 garantiza ≤1).
  select m.profile_id into v_old_admin
    from public.memberships m
   where m.club_id = p_club_id and m.role = 'admin_club'
   limit 1;
  if v_old_admin is null then
    raise exception 'no_current_admin' using errcode = 'P0001';
  end if;

  -- SUCESIÓN: NO se reasigna ningún puntero. Solo borramos la membership de ESTE
  -- club (no el profile), así que nada queda con FK rota:
  --   · legal_documents no tiene columna de uploader (solo club_id).
  --   · invitations.created_by / autoría de mensajes y anuncios siguen apuntando al
  --     profile (vivo) del viejo admin → histórico preservado.
  --   · La CAPACIDAD de gestión de todo lo del club la hereda el nuevo admin
  --     automáticamente vía RLS por rol de club (no por created_by) al aceptar.

  -- Corte inmediato del viejo: borra su membership admin_club. El trigger
  -- protect_club_owner_membership la protege → lo DESACTIVAMOS solo para este DELETE
  -- y lo REACTIVAMOS pase lo que pase (éxito y error). El CASCADE limpia sus
  -- capabilities y team_staff de ese club. No se toca su cuenta auth ni sus
  -- membresías de otros clubes.
  begin
    alter table public.memberships disable trigger protect_club_owner_membership;
    delete from public.memberships
     where club_id = p_club_id
       and profile_id = v_old_admin
       and role = 'admin_club';
    alter table public.memberships enable trigger protect_club_owner_membership;
  exception when others then
    -- El subtxn revierte el DISABLE; re-enable idempotente por si acaso y re-lanzamos.
    begin
      alter table public.memberships enable trigger protect_club_owner_membership;
    exception when others then null;
    end;
    raise;
  end;

  -- Club sin owner: el trigger assign_club_owner_on_admin lo reasignará al nuevo
  -- cuando acepte (solo actúa si owner_profile_id IS NULL).
  update public.clubs set owner_profile_id = null where id = p_club_id;

  -- Invita al nuevo admin (réplica de platform_invite_club_admin; supersede la
  -- invitación admin_club pendiente previa si la hubiera). NO borra las demás
  -- invitaciones del club (las de jugadores/staff del viejo admin siguen vivas).
  delete from public.invitations i
   where i.club_id = p_club_id
     and i.role = 'admin_club'
     and i.accepted_at is null;

  return query
    insert into public.invitations (email, club_id, role, created_by)
    values (v_email, p_club_id, 'admin_club', v_uid)
    returning invitations.id, invitations.token, invitations.email;
end;
$function$;

revoke all on function public.platform_change_club_admin(uuid, text) from public;
grant execute on function public.platform_change_club_admin(uuid, text) to authenticated;
