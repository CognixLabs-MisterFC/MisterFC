-- platform_change_club_admin — sustituye el mecanismo de bypass del trigger del owner.
--
-- ANTES (20261032000000): la RPC hacía
--     ALTER TABLE public.memberships DISABLE TRIGGER protect_club_owner_membership;
--     ... DELETE ...
--     ALTER TABLE public.memberships ENABLE  TRIGGER protect_club_owner_membership;
--   Ese ALTER TABLE es DDL de alcance GLOBAL de tabla: toma ACCESS EXCLUSIVE sobre
--   memberships y, entre el DISABLE y el ENABLE, deja la tabla ENTERA sin la
--   protección del owner (ventana concurrente para cualquier otra transacción).
--
-- AHORA: guard por variable de sesión LOCAL a la transacción.
--   · El trigger deja pasar el DELETE SOLO si
--       current_setting('misterfc.allow_owner_membership_delete', true) = 'on'
--     (2º arg true = missing_ok → NULL si nunca se activó → NULL <> 'on' → bloquea;
--      default seguro).
--   · La RPC la activa con set_config(..., 'on', is_local := true) justo antes del
--     DELETE. is_local=true → se limpia sola al terminar la transacción (commit O
--     rollback), sin necesidad de resetearla a mano ni en el bloque de excepción, y
--     SIN tomar ningún lock global ni abrir ventana sobre el resto de la tabla.
--
-- Solo cambia el MECANISMO. La sucesión por rol, los guards, la RLS y el resto de la
-- RPC quedan idénticos a 20261032000000. El trigger (objeto) creado en esa migración
-- se conserva; aquí solo se sustituye el CUERPO de su función y el de la RPC.

-- ── 1. Función del trigger — ahora consulta el permiso de sesión ────────────────
create or replace function public.protect_club_owner_membership()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Solo se llega aquí para filas admin_club (WHEN del trigger). La vía sancionada
  -- (platform_change_club_admin) activa un permiso LOCAL a su transacción; cualquier
  -- otro DELETE no lo tiene → bloqueo duro. current_setting(...,true) devuelve NULL
  -- si nunca se activó → NULL <> 'on' → bloquea (default seguro).
  if current_setting('misterfc.allow_owner_membership_delete', true) = 'on' then
    return old;  -- permitido: deja pasar el DELETE
  end if;
  raise exception 'owner_membership_protected'
    using errcode = 'P0001',
          hint = 'usa platform_change_club_admin para cambiar el admin del club';
  return old;
end;
$function$;

-- ── 2. RPC — set_config local en vez de ALTER TABLE DISABLE/ENABLE TRIGGER ──────
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
  -- protect_club_owner_membership la protege. En vez de DISABLE/ENABLE TRIGGER (DDL
  -- global que toma ACCESS EXCLUSIVE sobre memberships y abre una ventana concurrente
  -- sin protección), activamos un permiso LOCAL a ESTA transacción con set_config
  -- is_local=true: se limpia solo al terminar (commit o rollback), sin lock global ni
  -- ventana sobre el resto de la tabla. El CASCADE limpia sus capabilities y team_staff
  -- de ese club. No se toca su cuenta auth ni sus membresías de otros clubes.
  perform set_config('misterfc.allow_owner_membership_delete', 'on', true);
  delete from public.memberships
   where club_id = p_club_id
     and profile_id = v_old_admin
     and role = 'admin_club';

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
