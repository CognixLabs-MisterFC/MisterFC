-- F14B-2 — Chokepoint: cablear is_superadmin() en user_role_in_club.
--
-- F14B-1 creó platform_admins + is_superadmin() (latente). Esta subfase lo
-- CABLEA en user_role_in_club, el helper del que se apoya casi toda la RLS.
--
-- Efecto: para un SUPERADMIN, user_role_in_club(cualquier_club) devuelve
-- 'admin_club' para CUALQUIER club (exista o no membership) → se comporta como
-- admin_club en todos los clubs (clubs/memberships/players/teams/categorías +
-- médica vía user_is_admin_or_director, con el gate de consentimiento intacto).
-- Para TODOS los demás usuarios, el resultado es IDÉNTICO a hoy: cero cambios
-- en el aislamiento normal entre clubs.
--
-- ALCANCE ESTRICTO: solo esta función. NO se tocan profiles_select_clubmate ni
-- legal_documents_select_own_club (join inline a memberships → F14B-3), ni los
-- RPCs admin con role='admin_club' inline (F14B-6), ni el modelo de tutela
-- (user_is_tutor_of_player / user_is_staff_of_team). Sin auditoría ni consola.
--
-- Se copia la definición VIVA (firma/STABLE/SECURITY DEFINER/search_path
-- exactos) y se AÑADE solo la línea del superadmin al inicio.

create or replace function public.user_role_in_club(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- F14B-2: un superadmin de plataforma actúa como admin_club en CUALQUIER club.
  select case
    when public.is_superadmin() then 'admin_club'
    else (
      select role
      from public.memberships
      where club_id = p_club_id
        and profile_id = auth.uid()
      limit 1
    )
  end;
$$;

comment on function public.user_role_in_club(uuid) is
  'Rol del user actual (auth.uid()) en el club indicado. NULL si no es miembro. '
  'F14B-2: si el user es superadmin de plataforma (is_superadmin), devuelve '
  '''admin_club'' para CUALQUIER club (acceso transversal); en otro caso, IDÉNTICO '
  'al comportamiento previo (rol de su membership, o NULL).';
