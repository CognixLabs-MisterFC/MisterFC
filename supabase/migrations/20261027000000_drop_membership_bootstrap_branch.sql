-- F15-C2-fix — SEGURIDAD: eliminar la rama BOOTSTRAP de
-- memberships_insert_bootstrap_or_admin (secuestro de club).
--
-- Bug (reproducido en prod): la rama bootstrap del WITH CHECK
--   (profile_id = auth.uid()) AND (role='admin_club')
--     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.profile_id = auth.uid())
-- no liga club_id a propiedad ni a invitación. Cualquier usuario autenticado con
-- CERO membresías podía insertarse como admin_club de CUALQUIER club que aún no
-- tuviera fila admin_club — la ventana entre platform_create_club (crea el club
-- con owner NULL y SIN membership) y que el admin invitado acepte. Sin invitación.
-- El único freno era el UNIQUE memberships_one_admin_per_club, que NO cubre esa
-- ventana. Cuando el admin legítimo aceptaba, chocaba con el UNIQUE → club
-- secuestrado y dueño real fuera.
--
-- DECISIÓN (Jose): eliminar la rama ENTERA, no parchearla. Es un vestigio de la
-- era self-serve (registro abierto). Desde F14D (#312) el registro está CERRADO:
-- los clubes los crea Jose desde la consola (platform_create_club) y el admin
-- entra por INVITACIÓN (accept_pending_invitations, SECURITY DEFINER → bypassa
-- esta policy). No hay ninguna vía de autoservicio, así que la rama no protege
-- ningún flujo legítimo: solo es superficie de ataque.
--
-- Se conservan EXACTAMENTE las otras dos ramas (verificadas contra la DEF VIVA
-- vía pg_policies, no ficheros):
--   (2) auto-aceptación de invitación por el propio usuario (email + pending).
--   (3) gestión por admin/owner del club (high→owner; low→admin/director).
-- El nombre de la policy se mantiene para no romper referencias en migraciones.

drop policy if exists memberships_insert_bootstrap_or_admin on public.memberships;

create policy memberships_insert_bootstrap_or_admin
  on public.memberships
  for insert
  to authenticated
  with check (
    -- (2) Auto-aceptación de una invitación PENDIENTE dirigida a este usuario.
    (
      (profile_id = auth.uid())
      and (exists (
        select 1
        from invitations i
        where (i.email ~~* current_user_email())
          and (i.club_id = memberships.club_id)
          and (i.role = memberships.role)
          and (i.accepted_at is null)
          and (i.expires_at > now())
      ))
    )
    -- (3) Gestión de staff por la dirección del club: roles altos (admin/director)
    --     solo el owner (superadmin-aware); roles bajos, admin_club o director.
    or (
      case
        when membership_role_is_high(role) then user_is_club_owner(club_id)
        else (user_role_in_club(club_id) = any (array['admin_club'::text, 'director'::text]))
      end
    )
  );
