-- ─────────────────────────────────────────────────────────────────────────────
-- ¿Ese correo ya tiene una invitación PENDIENTE en este club?
--
-- LA OTRA MITAD DE LA REGLA. «Un correo pertenece a una sola familia» tiene dos
-- caras, y hasta ahora el repo solo sabía contestar una:
--
--   · «ya es de alguien del club»  → `club_member_by_email` (mig 20261086000000),
--     usada por createPlayer (#646), el botón de la ficha (#647), /invitations
--     (#648) y la importación (#685). Mira `memberships`.
--   · «ya está invitado y no ha aceptado» → nadie. Y es un agujero real, porque
--     LA MEMBERSHIP NACE AL ACEPTAR (`accept_pending_invitations` hace el insert):
--     entre que invitas y que el padre entra, ese correo es INVISIBLE para la
--     primera pregunta. Medido el 22-09-2026 contra producción con un correo
--     invitado ese mismo día (`invite_pending=true`, 0 memberships):
--     `club_member_by_email` devolvía 0 filas.
--
-- Esa ventana es la que dejaba salir un SEGUNDO correo a la misma persona —y,
-- cuando las dos invitaciones eran de hijos distintos, la que juntaba en una sola
-- pantalla de aceptar a dos críos que no tenían por qué aparecer juntos.
--
-- QUÉ DEVUELVE: todas las pendientes vigentes de ese correo en ese club, en orden
-- de creación. TODAS, no solo una, y sin filtrar por rol ni por jugador: quien
-- llama necesita poder descartar la suya (renovar es reenviar a mano, y eso SÍ
-- manda correo) y quedarse con el resto. La decisión de si sale correo o no vive
-- en `pendingCoversEmail` (packages/core), que es donde el CI la ejecuta.
--
-- POR QUÉ UNA RPC Y NO UN SELECT. La policy `invitations_select_admin_or_invited`
-- solo deja leer la tabla a dirección, al invitado y a quien creó la fila. Un
-- entrenador puede crear un jugador —y con él dispara la invitación al tutor—,
-- pero no puede ver las invitaciones de los demás: con un `select` normal vería
-- cero pendientes y mandaría el correo igual. La función corre como la dueña y se
-- gatea a la MISMA lista que `players_insert_staff`, igual que su hermana.
--
-- No expone nada nuevo: id de la invitación, jugador, rol y fecha. Ni el correo
-- (lo trae quien pregunta) ni el token.
--
-- Test: supabase/tests/club_pending_invitation_by_email.sql
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.club_pending_invitation_by_email(
  p_club_id uuid,
  p_email text
)
returns table (
  invitation_id uuid,
  player_id uuid,
  role text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- MISMA lista que `players_insert_staff` y que `club_member_by_email`: quien
  -- puede crear el jugador puede preguntar si el correo de su tutor ya tiene una
  -- invitación en marcha.
  if coalesce(public.user_role_in_club(p_club_id), '') not in (
    'admin_club', 'director', 'coordinador',
    'entrenador_principal', 'entrenador_ayudante'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if v_email is null then
    return;
  end if;

  return query
  select i.id, i.player_id, i.role, i.created_at
    from public.invitations i
   where i.club_id = p_club_id
     and lower(i.email) = v_email
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at;
end;
$$;

revoke all on function public.club_pending_invitation_by_email(uuid, text) from public;
revoke all on function public.club_pending_invitation_by_email(uuid, text) from anon;
grant execute on function public.club_pending_invitation_by_email(uuid, text) to authenticated;
grant execute on function public.club_pending_invitation_by_email(uuid, text) to service_role;
