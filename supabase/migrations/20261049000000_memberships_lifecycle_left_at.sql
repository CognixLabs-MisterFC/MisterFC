-- Baja de miembros (Paso 1 · MODELO). ADITIVA y AISLADA: añade el ciclo de vida a
-- memberships SIN que nada lo lea todavía. El enforcement (helpers user_role_in_club
-- /profile_is_staff_of_club/... y el filtro del loader de acceso) es el PASO 2.
--
-- Idioma del repo (players.left_club_at, team_members.left_at, team_staff.left_at):
-- left_at DATE nullable + razón. NULL = miembro ACTIVO. NO destructivo: conserva
-- histórico (team_staff, estadísticas, autoría). Reversible (volver a NULL = reactivar).
-- Aplica a jugadores (vía la membership del TUTOR), staff y directores por igual.
-- La supresión RGPD sigue siendo un flujo APARTE (erasure_requests); no se mezcla.
--
-- NOTAS de decisiones de Jose (para pasos posteriores, NO se implementan aquí):
--  · ACCESO por memberships.left_at, no por players.left_club_at (eje deportivo del
--    menor, distinto). La membership del tutor es la fila de acceso.
--  · El índice memberships_one_admin_per_club NO se toca: el admin_club NO se da de
--    baja (es el dueño del club). Dar de baja al admin exige traspasar antes la
--    administración; será una GUARDA en la acción de baja del Paso 4, no un cambio de
--    índice.
--  · La baja del tutor es una acción EXPLÍCITA; nunca automática al dar de baja a un
--    hijo (un tutor puede tener otro hijo, o volver a tenerlo).

alter table public.memberships
  add column left_at     date,
  add column left_reason text;

comment on column public.memberships.left_at is
  'Fecha de baja del miembro en el club. NULL = ACTIVO. No borra la fila (conserva histórico). Reversible: volver a NULL reactiva. El corte de acceso (helpers/RLS + loader) es el Paso 2.';

comment on column public.memberships.left_reason is
  'Razón opcional de la baja; solo con left_at no nulo. Se limpia al reactivar.';

-- Invariante del modelo. ADITIVO: todas las filas actuales son left_at NULL → pasan.
-- La razón solo tiene sentido con una baja, y se acota igual que el resto de texto
-- libre de la tabla (cap 500, como hace hoy la acción de baja de jugador).
alter table public.memberships
  add constraint memberships_left_reason_check
  check (
    left_reason is null
    or (left_at is not null and char_length(btrim(left_reason)) <= 500)
  );
