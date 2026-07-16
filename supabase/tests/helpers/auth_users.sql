-- supabase/tests/helpers/auth_users.sql
--
-- Helper COMÚN de fixtures (F15-A). NO es una migración: no toca el esquema ni
-- ninguna policy. Define una función EFÍMERA en `pg_temp` (esquema temporal de
-- la sesión de psql; se autodestruye al cerrar la conexión, nunca se persiste en
-- la BD remota). Se incluye desde cada fixture con `\ir helpers/auth_users.sql`.
--
-- Por qué existe: desde F14D (#312) el trigger `handle_new_user` cierra el signup
-- abierto y exige, para insertar en `auth.users`, uno de: `invitation_id` en
-- user_metadata, `founder=true` en app_metadata, o una invitación pendiente para
-- ese email. Las fixtures se escribieron antes y creaban usuarios "a pelo" → hoy
-- fallan en la primera línea con `registro_no_permitido`.
--
-- Cómo lo resuelve: crea el usuario poniendo `founder=true` en `raw_app_meta_data`.
-- Verificado (F15-A) que `founder` lo lee EXCLUSIVAMENTE el gate de F14D — ni la
-- app ni ninguna otra policy — y que `handle_new_user` solo hace `insert into
-- profiles` (no crea club, no membership, no owner). Es decir: `founder` abre el
-- gate y NADA más → cero efectos secundarios sobre lo que el test prueba.
--
-- `raw_user_meta_data` (p_user_meta) se deja EXACTAMENTE como el test lo pide
-- (full_name, etc.), sin contaminarlo: el bypass vive aparte, en app_metadata.
-- El rol de dominio (admin/coordinador/jugador/…) NO se toca aquí: sigue saliendo
-- de los `insert into memberships/team_staff/player_accounts` de cada fixture.

create or replace function pg_temp.new_test_user(
  p_id        uuid,
  p_email     text,
  p_user_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql
as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, email_confirmed_at,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at
  ) values (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    now(),
    coalesce(p_user_meta, '{}'::jsonb),
    jsonb_build_object('founder', 'true'),
    now(),
    now()
  );
  return p_id;
end;
$$;
