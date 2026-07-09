-- F14-3b — La FOTO del jugador la escribe SOLO el tutor vinculado.
--
-- Cambio de política (Jose): subir/cambiar/borrar la foto pasa a ser EXCLUSIVO
-- del tutor (player_accounts.relation in ('parent','guardian') con
-- profile_id = auth.uid()). El STAFF pierde la ESCRITURA pero CONSERVA la
-- LECTURA (el entrenador necesita ver la foto para identificar al niño). Ni el
-- propio jugador (relation='self') ni el director escriben.
--
-- Piezas:
--   1. Helper user_is_tutor_of_player (SECURITY DEFINER, estilo F2.2).
--   2. Storage bucket player-photos: policies de ESCRITURA de staff → de tutor.
--      La de LECTURA (player_photos_select_member) NO se toca (staff sigue viendo).
--   3. players.photo_url: NO se amplía players_write_staff (RLS no filtra columnas;
--      daría al tutor UPDATE de toda la ficha, incl. medical_notes). En su lugar:
--        - RPC set_player_photo(player_id, path) SECURITY DEFINER, solo esa columna.
--        - Trigger players_guard_photo_url: impide que players_write_staff (staff)
--          cambie photo_url por UPDATE directo. Solo el tutor (o el backend con
--          service_role, auth.uid() null — lo usará F14-3c en el alta) puede.
--
-- Fotos ya subidas por staff: se CONSERVAN (no se borra nada).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper: ¿auth.uid() es tutor (parent/guardian) del jugador?
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_is_tutor_of_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.player_accounts pa
    where pa.player_id = p_player_id
      and pa.profile_id = auth.uid()
      and pa.relation in ('parent', 'guardian')
  );
$$;

comment on function public.user_is_tutor_of_player(uuid) is
  'true si el user actual es TUTOR vinculado del jugador (player_accounts.relation parent/guardian). Base de permiso para escribir la foto (F14-3b). relation=self NO cuenta.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Storage player-photos: escritura de staff → de tutor. SELECT intacta.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "player_photos_insert_staff" on storage.objects;
drop policy if exists "player_photos_update_staff" on storage.objects;
drop policy if exists "player_photos_delete_staff" on storage.objects;

-- INSERT: solo el tutor del jugador (carpeta = <player_id>/…).
create policy "player_photos_insert_tutor"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'player-photos'
    and public.user_is_tutor_of_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- UPDATE: mismo criterio.
create policy "player_photos_update_tutor"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_is_tutor_of_player(
      ((storage.foldername(name))[1])::uuid
    )
  )
  with check (
    bucket_id = 'player-photos'
    and public.user_is_tutor_of_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- DELETE: mismo criterio (vía Storage API; storage.protect_delete bloquea SQL).
create policy "player_photos_delete_tutor"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_is_tutor_of_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3a. RPC set_player_photo: única vía para escribir players.photo_url.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_player_photo(p_player_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'no_session';
  end if;
  if not public.user_is_tutor_of_player(p_player_id) then
    raise exception 'forbidden';
  end if;
  -- Solo la columna photo_url. p_path NULL = el tutor retira la foto.
  update public.players set photo_url = p_path where id = p_player_id;
end;
$$;

comment on function public.set_player_photo(uuid, text) is
  'F14-3b — Fija (o retira, path NULL) players.photo_url de UN jugador. Exige ser tutor vinculado (user_is_tutor_of_player). Única vía de escritura de la foto; evita ampliar players_write_staff (que expondría toda la ficha).';

revoke all on function public.set_player_photo(uuid, text) from public;
grant execute on function public.set_player_photo(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. Trigger: photo_url solo la cambia el tutor (o el backend service_role).
--     players_write_staff sigue intacta para el RESTO de la ficha; este guard
--     impide que el staff escriba SOLO la columna photo_url por UPDATE directo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.players_guard_photo_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.photo_url is distinct from OLD.photo_url then
    -- auth.uid() null = backend con service_role (alta server-side, F14-3c): permitido.
    if auth.uid() is not null and not public.user_is_tutor_of_player(NEW.id) then
      raise exception 'photo_url solo la gestiona el tutor vinculado (usa set_player_photo)';
    end if;
  end if;
  return NEW;
end;
$$;

comment on function public.players_guard_photo_url() is
  'F14-3b — Bloquea cambios de players.photo_url salvo por el tutor vinculado o el backend (service_role). El staff conserva players_write_staff para el resto de la ficha pero no para la foto.';

create trigger players_guard_photo_url
  before update on public.players
  for each row execute function public.players_guard_photo_url();
