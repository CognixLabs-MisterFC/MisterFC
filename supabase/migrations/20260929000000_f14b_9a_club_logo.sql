-- F14B-9a — Logo del club: columna + bucket público + subida (admin) + consola.
--
-- MODELO (Jose): el logo lo sube/cambia SOLO el admin (user_role_in_club='admin_club',
-- que ya incluye al superadmin por el chokepoint F14B-2). El director NO (como los
-- documentos legales). Bucket PÚBLICO: el logo es identidad pública (el login-por-club
-- futuro lo necesitará sin sesión).
--
-- Patrón: réplica de player-photos (F14B-3b) pero con gate de ADMIN por carpeta =
-- club_id (path 'club-logos/{club_id}/...'), y escritura de clubs.logo_path SOLO por
-- la RPC set_club_logo (un trigger por columna impide el UPDATE directo, porque
-- clubs_update_admin permite también al director).
--
-- ALCANCE: columna + bucket + policies + RPC + guard + logo_path en platform_list_clubs.
-- NO toca los PDF (F14B-9b). NO el login-por-club.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. clubs.logo_path — path del objeto en el bucket. NULL = sin logo. Formato
--    '{club_id}/{uuid}.{ext}' (mismo criterio que players.photo_url / avatar_url:
--    se guarda el PATH, no la URL). Bucket público → la URL se resuelve por render.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.clubs
  add column if not exists logo_path text
    check (
      logo_path is null
      or (char_length(logo_path) between 1 and 200 and logo_path !~ '^https?://')
    );

comment on column public.clubs.logo_path is
  'F14B-9a — path del logo en el bucket público "club-logos" (formato {club_id}/{uuid}.{ext}). '
  'NULL = sin logo. Se escribe SOLO vía set_club_logo (gate admin_club); un trigger bloquea el '
  'UPDATE directo. La URL pública se resuelve por render (bucket público).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bucket 'club-logos' PÚBLICO.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('club-logos', 'club-logos', true)
on conflict (id) do update set public = excluded.public;

-- SELECT: lectura pública (bucket público; el login-por-club futuro la necesita sin sesión).
drop policy if exists "club_logos_select_public" on storage.objects;
create policy "club_logos_select_public"
  on storage.objects
  for select
  to public
  using (bucket_id = 'club-logos');

-- INSERT/UPDATE/DELETE: SOLO admin_club del club de la carpeta (superadmin incluido por
-- el chokepoint). El club_id es el primer segmento del path: 'club-logos/{club_id}/...'.
drop policy if exists "club_logos_insert_admin" on storage.objects;
create policy "club_logos_insert_admin"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'club-logos'
    and public.user_role_in_club(((storage.foldername(name))[1])::uuid) = 'admin_club'
  );

drop policy if exists "club_logos_update_admin" on storage.objects;
create policy "club_logos_update_admin"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'club-logos'
    and public.user_role_in_club(((storage.foldername(name))[1])::uuid) = 'admin_club'
  )
  with check (
    bucket_id = 'club-logos'
    and public.user_role_in_club(((storage.foldername(name))[1])::uuid) = 'admin_club'
  );

-- DELETE: mismo criterio (vía Storage API; storage.protect_delete bloquea el SQL directo).
drop policy if exists "club_logos_delete_admin" on storage.objects;
create policy "club_logos_delete_admin"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'club-logos'
    and public.user_role_in_club(((storage.foldername(name))[1])::uuid) = 'admin_club'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC set_club_logo — ÚNICA vía para escribir clubs.logo_path. Gate admin_club
--    (excluye director; incluye superadmin por el chokepoint). p_path NULL = quita.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_club_logo(p_club_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'no_session';
  end if;
  if public.user_role_in_club(p_club_id) is distinct from 'admin_club' then
    raise exception 'forbidden';
  end if;
  -- Solo la columna logo_path. p_path NULL = el admin retira el logo.
  update public.clubs set logo_path = p_path where id = p_club_id;
end;
$$;

comment on function public.set_club_logo(uuid, text) is
  'F14B-9a — Fija (o retira, path NULL) clubs.logo_path de UN club. Gate user_role_in_club='
  '''admin_club'' (superadmin incluido por el chokepoint; director excluido). Única vía de '
  'escritura del logo; el trigger clubs_guard_logo_path bloquea el UPDATE directo.';

revoke all on function public.set_club_logo(uuid, text) from public;
grant execute on function public.set_club_logo(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger de columna: clubs.logo_path SOLO la cambia el admin (vía la RPC) o el
--    backend (service_role, auth.uid() null). Necesario porque clubs_update_admin
--    permite UPDATE al admin Y al director (user_is_admin_or_director) → sin este
--    guard, un director podría escribir logo_path por UPDATE directo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.clubs_guard_logo_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.logo_path is distinct from OLD.logo_path then
    -- auth.uid() null = backend service_role: permitido. En sesión, solo admin_club.
    if auth.uid() is not null
       and public.user_role_in_club(NEW.id) is distinct from 'admin_club' then
      raise exception 'logo_path solo lo gestiona el admin del club (usa set_club_logo)';
    end if;
  end if;
  return NEW;
end;
$$;

comment on function public.clubs_guard_logo_path() is
  'F14B-9a — Bloquea cambios de clubs.logo_path salvo por el admin_club (vía set_club_logo) o '
  'el backend (service_role). clubs_update_admin sigue permitiendo el resto del UPDATE (admin/'
  'director) pero NO el logo al director.';

drop trigger if exists clubs_guard_logo_path on public.clubs;
create trigger clubs_guard_logo_path
  before update on public.clubs
  for each row execute function public.clubs_guard_logo_path();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. platform_list_clubs: añadir logo_path (para pintar el logo en la consola).
--    Cambia la RETURNS TABLE (columna nueva) → hay que DROP + CREATE (no basta
--    REPLACE). Copia de la def viva (F14B-5a) + logo_path. Gate is_superadmin intacto.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.platform_list_clubs();
create or replace function public.platform_list_clubs()
returns table (
  id uuid,
  name text,
  slug text,
  locale text,
  logo_path text,
  created_at timestamptz,
  owner_profile_id uuid,
  owner_name text,
  has_owner boolean,
  has_admin boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.is_superadmin() then raise exception 'forbidden'; end if;

  return query
    select
      c.id, c.name, c.slug, c.locale, c.logo_path, c.created_at,
      c.owner_profile_id,
      op.full_name as owner_name,
      (c.owner_profile_id is not null) as has_owner,
      exists (
        select 1 from public.memberships m
        where m.club_id = c.id and m.role = 'admin_club'
      ) as has_admin
    from public.clubs c
    left join public.profiles op on op.id = c.owner_profile_id
    order by c.created_at asc;
end;
$$;

comment on function public.platform_list_clubs() is
  'F14B-5a/9a — lista todos los clubs (solo superadmin): datos + logo_path + owner (nombre) + '
  'flags has_owner / has_admin.';

revoke all on function public.platform_list_clubs() from public;
grant execute on function public.platform_list_clubs() to authenticated;
