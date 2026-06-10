-- Rework C · C2 — sembrar el catálogo estándar al crear un club.
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C2). ADR-0018.
-- CREATE OR REPLACE de create_club_with_admin: misma firma y misma lógica
-- (auth, anti-multi-club, validaciones, insert atómico club+membership), con UN
-- añadido: tras crear el club, llama a seed_standard_categories(v_club_id) para
-- que todo club nuevo nazca con las 10 categorías estándar (is_standard=true).
--
-- seed_standard_categories (C1, 20260702000000) es IDEMPOTENTE → llamarla en el
-- alta no puede duplicar. El club nuevo no tiene categorías previas, así que se
-- siembran las 10.

create or replace function public.create_club_with_admin(
  p_name text,
  p_slug text,
  p_locale text default 'es'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_club_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo un user sin memberships puede crear su primer club por aquí.
  -- En Fase 2, cuando se permita multi-club, esta restricción se relajará en
  -- una función separada (`create_additional_club`) con su propia autorización.
  if exists (select 1 from public.memberships where profile_id = v_user_id) then
    raise exception 'already_in_a_club' using errcode = 'P0001';
  end if;

  -- Validaciones de entrada (también las hace el cliente con Zod, pero la
  -- función es el contrato final de la base de datos).
  if p_name is null or char_length(trim(p_name)) = 0 or char_length(p_name) > 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  if p_locale not in ('es', 'en', 'va') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;

  -- Insert atómico de club + membership admin_club.
  insert into public.clubs (name, slug, locale)
  values (p_name, p_slug, p_locale)
  returning id into v_club_id;

  insert into public.memberships (profile_id, club_id, role)
  values (v_user_id, v_club_id, 'admin_club');

  -- Rework C (C2): sembrar el catálogo estándar de categorías (idempotente).
  perform public.seed_standard_categories(v_club_id);

  return v_club_id;
end;
$$;

comment on function public.create_club_with_admin(text, text, text) is
  'Crea club + membership admin_club de forma atómica (SECURITY DEFINER). Rework C (C2): además siembra el catálogo estándar de categorías vía seed_standard_categories (idempotente).';
