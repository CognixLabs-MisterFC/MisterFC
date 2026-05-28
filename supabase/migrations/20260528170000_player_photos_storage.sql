-- Subfase 2.2 — Bucket privado para fotos de jugadores + helpers RLS de jugador
--
-- Diseño (más restrictivo que `profile-avatars` de F2.0):
--   - Bucket `player-photos` PRIVADO (`public=false`).
--   - SELECT restringido a miembros del club del jugador (no a cualquier
--     authenticated). Son fotos de MENORES — la visibilidad debe alinearse con
--     RLS de `public.players`, no con "cualquier user logueado".
--   - INSERT/UPDATE/DELETE solo a roles staff con permiso de gestión de
--     plantilla (admin_club/coordinador/entrenador_principal o ayudante con
--     `can_manage_squad`), mismo criterio que la policy de escritura de
--     `public.players` en F1.7.
--   - Path convention: `<player_id>/<uuid>.<ext>`. La carpeta es el player_id,
--     no el user_id (un mismo staff puede subir/cambiar fotos de varios
--     jugadores). El helper `user_can_see_player(player_id)` resuelve.
--   - Lectura desde la app: signed URLs cortas (5-15 min). El path se guarda
--     en `public.players.photo_url`; la URL firmada NO se persiste.
--
-- Helpers nuevos:
--   - `user_can_see_player(player_id)` — pertenencia al club del jugador.
--   - `user_can_manage_player(player_id)` — staff con permiso de squad.
--   - `user_can_see_player_medical(player_id)` — autoridad para medical_notes,
--     que se aplica en server-side queries (RLS no filtra a nivel columna).
--
-- Notas:
--   - Las policies actuales de `public.players` (F1.7) ya implementan los mismos
--     criterios fila a fila. Los helpers extraen la lógica para reusarla en
--     storage y en server actions.
--   - No se relaja el CHECK de `players.photo_url` (sigue exigiendo `^https?://`)
--     porque NO vamos a guardar la URL completa allí — vamos a guardar el path,
--     igual que `profile-avatars` lo hizo con `profiles.avatar_url`. Por eso
--     hay que relajar el CHECK también aquí.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers SQL
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_see_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and public.user_role_in_club(p.club_id) is not null
  );
$$;

comment on function public.user_can_see_player(uuid) is
  'true si el user actual pertenece al club del jugador. Cualquier miembro del club ve la ficha base del jugador (no implica acceso a medical_notes). Usado en storage de player-photos y como helper general.';


create or replace function public.user_can_manage_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        public.user_role_in_club(p.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
        or public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
      )
  );
$$;

comment on function public.user_can_manage_player(uuid) is
  'true si el user actual puede gestionar la ficha del jugador (escribir, subir fotos, asignar a equipos). admin/coord/principal del club o ayudante con can_manage_squad.';


create or replace function public.user_can_see_player_medical(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        -- Staff con visibilidad directa
        public.user_role_in_club(p.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
        -- Ayudante con can_see_medical concedido
        or public.user_has_capability_in_club(p.club_id, 'can_see_medical')
        -- Tutor vinculado al jugador
        or exists (
          select 1
          from public.player_accounts pa
          where pa.player_id = p.id
            and pa.profile_id = auth.uid()
        )
      )
  );
$$;

comment on function public.user_can_see_player_medical(uuid) is
  'true si el user actual puede ver las medical_notes del jugador. RLS no filtra columnas; el server query aplica este check para decidir si incluye el campo. admin/coord/principal del club, ayudante con can_see_medical, o tutor vinculado vía player_accounts.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket player-photos (privado)
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('player-photos', 'player-photos', false)
on conflict (id) do update set public = excluded.public;

-- SELECT: solo miembros del club del jugador. Esto restringe incluso la
-- existencia del objeto vía Storage API (`list`, `getMetadata`, signed URL
-- de cross-club rechaza).
create policy "player_photos_select_member"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_can_see_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- INSERT: staff con can_manage_squad. La path debe empezar por `<player_id>/`
-- y el invocador debe ser autoridad sobre ese jugador.
create policy "player_photos_insert_staff"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'player-photos'
    and public.user_can_manage_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- UPDATE: mismo criterio (reemplazar metadata, contenido, etc.).
create policy "player_photos_update_staff"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_can_manage_player(
      ((storage.foldername(name))[1])::uuid
    )
  )
  with check (
    bucket_id = 'player-photos'
    and public.user_can_manage_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- DELETE: mismo criterio. Nota: storage.protect_delete() bloquea DELETE
-- directo desde SQL; la policy aplica al usarse vía Storage API
-- (`supabase.storage.from('player-photos').remove(...)`).
create policy "player_photos_delete_staff"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'player-photos'
    and public.user_can_manage_player(
      ((storage.foldername(name))[1])::uuid
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Ajuste de public.players.photo_url
-- ─────────────────────────────────────────────────────────────────────────────
--
-- El CHECK actual exige formato URL `^https?://`. Ahora guardamos PATH del
-- bucket (`<player_id>/<uuid>.<ext>`), no URL. Relajamos igual que se hizo
-- con `profiles.avatar_url` en F2.0.

alter table public.players
  drop constraint if exists players_photo_url_check;

alter table public.players
  add constraint players_photo_url_check
  check (
    photo_url is null
    or (
      char_length(photo_url) between 1 and 200
      and photo_url !~ '^https?://'
    )
  );

comment on column public.players.photo_url is
  'Path del objeto en el bucket "player-photos". Formato `<player_id>/<uuid>.<ext>`. La URL firmada (TTL corto) se genera en cada render. NO guardar URLs completas.';
