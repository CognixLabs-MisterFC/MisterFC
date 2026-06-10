-- Rework B · B2 — Enlace de invitación directo (sin baile de recovery).
--
-- Añade `invited_user_id`: el `auth.users.id` del usuario que `inviteUserByEmail`
-- crea al enviar la invitación. Es la pieza que permite desacoplar el accept del
-- magic link de Supabase y decidir, sin flags rancios, cómo tratar al invitee:
--
--   invited_user_id NOT NULL  → cuenta creada por NOSOTROS para esta invitación
--                               y aún no reclamada. La acción de aceptar puede
--                               fijar su contraseña (admin updateUserById) y crear
--                               sesión. Es el bootstrap de un invitee nuevo.
--   invited_user_id NULL      → el email YA tenía cuenta (inviteUserByEmail falló
--                               con email_exists y caímos a resetPasswordForEmail).
--                               El invitee debe iniciar sesión con SU contraseña;
--                               el token solo le adjunta al club, nunca le resetea
--                               la contraseña ni le crea sesión por sí mismo.
--
-- ON DELETE SET NULL: si la cuenta auth se borra, la invitación no se borra en
-- cascada (igual criterio que created_by).

alter table public.invitations
  add column invited_user_id uuid references auth.users(id) on delete set null;

comment on column public.invitations.invited_user_id is
  'auth.users.id creado por inviteUserByEmail al enviar la invitación. NULL = el email ya tenía cuenta (invitee existente que debe iniciar sesión). Permite a la acción de aceptar fijar la contraseña SOLO sobre la cuenta no reclamada que creamos para esta invitación.';

create index invitations_invited_user_idx on public.invitations (invited_user_id);
