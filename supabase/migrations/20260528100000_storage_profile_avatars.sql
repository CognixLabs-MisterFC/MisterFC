-- Subfase 2.0 — Bucket privado para avatares de perfil
--
-- Diseño:
--   - Bucket "profile-avatars" privado (no `public: true`).
--   - Lectura por usuarios autenticados: cualquier authenticated puede generar
--     signed URL de cualquier avatar, pero el path solo se conoce vía consultas
--     a public.profiles (que ya está filtrado por RLS de clubmate). Esto evita
--     URLs CDN cacheadas indefinidamente y mantiene el patrón estricto exigido
--     en el lote B (player-photos) donde la sensibilidad es mayor (menores).
--   - Escritura solo dentro de la propia carpeta del user: `<auth.uid()>/<uuid>.<ext>`.
--   - La columna `public.profiles.avatar_url` pasa a guardar el PATH del objeto
--     (`<profile_id>/<uuid>.<ext>`), no la URL completa. La URL firmada se
--     genera en cada render con `storage.from('profile-avatars').createSignedUrl`.
--
-- Razones de bucket privado:
--   1. RGPD/menores: avatar de adultos no es PII grave, pero asentar el patrón
--      restrictivo ahora evita laxitudes cuando lleguen `player-photos` (F2.2).
--   2. Coherencia: misma manera de servir imágenes en toda la app.
--   3. URLs CDN públicas no expiran ni se invalidan fácilmente.

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', false)
on conflict (id) do update set public = excluded.public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies sobre storage.objects para este bucket
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: cualquier user autenticado. Defendido en capa de aplicación al
-- generar signed URLs solo a partir de paths obtenidos vía profiles (con RLS).
create policy "profile_avatars_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'profile-avatars');

-- INSERT: solo en propia carpeta. Naming: `<auth.uid()>/<uuid>.<ext>`.
create policy "profile_avatars_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: solo en propia carpeta (reemplazar avatar conservando path).
create policy "profile_avatars_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: solo en propia carpeta (borrar avatar antiguo al cambiarlo).
create policy "profile_avatars_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Ajuste de public.profiles.avatar_url
-- ─────────────────────────────────────────────────────────────────────────────
--
-- F1 dejó un CHECK que exige formato URL `^https?://`. Ahora guardamos PATH
-- de storage (`<profile_id>/<uuid>.<ext>`), no URL. Relajamos el CHECK:
--   - opcional
--   - longitud razonable (≤ 200)
--   - no empieza por "http" (los datos antiguos URL ya no caben; F1 nunca pobló
--     esta columna en producción → migración limpia)

alter table public.profiles
  drop constraint if exists profiles_avatar_url_check;

alter table public.profiles
  add constraint profiles_avatar_url_check
  check (
    avatar_url is null
    or (
      char_length(avatar_url) between 1 and 200
      and avatar_url !~ '^https?://'
    )
  );

comment on column public.profiles.avatar_url is
  'Path del objeto en el bucket "profile-avatars". Formato `<profile_id>/<uuid>.<ext>`. La URL firmada se genera en cada render.';
