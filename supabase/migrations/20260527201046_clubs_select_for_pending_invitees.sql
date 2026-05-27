-- Fix — clubs SELECT visible al invitado mientras la invitación esté pendiente
--
-- Bug observado: un user clica el magic link de invitación, llega a /invite/{token}
-- autenticado, pero la página muestra "Invitación no encontrada".
--
-- Causa: el page hace un select relacional `select ..., club:club_id(id, name)
-- from invitations where token=...`. La policy `invitations_select_admin_or_invited`
-- permite al invitado ver la fila por email match, pero la policy
-- `clubs_select_member` (1.7) niega el club referenciado porque el invitado
-- todavía no es miembro (no ha aceptado). El join devuelve `club: null`, y la
-- página interpreta eso como "no encontrada".
--
-- Fix: añadir una segunda policy SELECT a clubs que dé visibilidad cuando el
-- user tiene una invitación pendiente al club con su propio email.
--
-- Por qué es seguro:
--   - El token es opaco (UUID), no se expone más de lo necesario.
--   - Solo permite leer clubs donde existe una invitación con
--     email = current_user_email() del user (no clubs random).
--   - La policy es PERMISSIVE (las policies SELECT múltiples se ORean), así que
--     se suma a la existente `clubs_select_member` sin debilitarla.

create policy clubs_select_via_pending_invitation on public.clubs
  for select to authenticated
  using (
    exists (
      select 1 from public.invitations i
      where i.club_id = clubs.id
        and i.accepted_at is null
        and i.expires_at > now()
        and i.email ilike public.current_user_email()
    )
  );

comment on policy clubs_select_via_pending_invitation on public.clubs is
  'Permite al invitado ver el club referenciado en su invitación pendiente. Necesario para el select relacional invitations → clubs en /invite/{token}. Sin esto el join devuelve club=null y la página renderiza "no encontrada".';
