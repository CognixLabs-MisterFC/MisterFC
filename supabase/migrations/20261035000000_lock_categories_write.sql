-- 5b — Catálogo de categorías 100% FIJO. Ningún usuario (admin_club/director
-- incluidos) crea, edita ni borra categorías. La única vía de escritura es
-- seed_standard_categories (SECURITY DEFINER, propiedad de postgres → bypassa RLS),
-- que usan el alta de club (create_club_with_admin) y el backfill. El rollover
-- (open_next_season / finalize_active_season) no toca categories.
--
-- Se retira el write de la RLS de USUARIO. Antes:
--   categories_write_admin_coord [ALL]
--     using/​with check = user_role_in_club(club_id) in ('admin_club','director')
-- El SELECT NO se toca: categories_select_member sigue intacto (todos los miembros
-- y spectators siguen viendo el catálogo).

-- Retira el write que concedía admin_club|director.
drop policy if exists categories_write_admin_coord on public.categories;

-- Cerrojo explícito y nombrado (cinturón + tirantes con el default-deny): política
-- de escritura que NUNCA concede a un usuario. No afecta al SELECT (las políticas
-- permisivas se combinan con OR; el SELECT lo da categories_select_member).
drop policy if exists categories_write_locked on public.categories;
create policy categories_write_locked on public.categories
  for all to authenticated
  using (false)
  with check (false);

comment on policy categories_write_locked on public.categories is
  'Catálogo fijo (5b): ningún usuario escribe categorías (INSERT/UPDATE/DELETE denegados). Solo seed_standard_categories (SECURITY DEFINER) escribe, saltándose RLS. El SELECT lo concede categories_select_member.';
