-- El director edita nombre y contacto, igual que el admin.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
--
-- En la ficha de Cuerpo técnico, «editar nombre» y «editar contacto» solo los
-- veía el admin_club. No era un gate de la UI: el permiso vive DENTRO de las dos
-- funciones, que son SECURITY DEFINER y por tanto se saltan la RLS. La UI solo
-- estaba dibujando lo que el SQL ya decidía.
--
-- Y el SQL decía `m.role = 'admin_club'` a pelo, con este comentario:
--
--     -- Solo admin_club del club (coordinador NO: la identidad es más sensible).
--
-- El comentario razona sobre el COORDINADOR, que efectivamente se queda fuera.
-- Del director no dice nada: cayó del lado de fuera por escribirse la condición
-- con un rol suelto en vez de con la familia de roles que le corresponde. En el
-- resto del club el director ya es admin en datos y vistas — la propia RLS de
-- `memberships` (`memberships_update_admin`) le deja escribir esas mismas filas
-- con `user_role_in_club(club_id) = any (array['admin_club','director'])`. O sea
-- que para el contacto la RLS ya le daba permiso y era esta función la que se lo
-- quitaba.
--
-- ── LO QUE SE HACE ─────────────────────────────────────────────────────────
--
-- Las dos funciones pasan a aceptar `admin_club` O `director`. Nada más cambia:
-- mismos argumentos, mismo SECURITY DEFINER, mismo search_path, mismas
-- validaciones, mismas columnas tocadas. Se recrean con CREATE OR REPLACE sobre
-- la MISMA firma, así que conservan sus permisos de ejecución.
--
-- El coordinador SIGUE fuera, y a propósito: el motivo escrito en 2026 no ha
-- cambiado. Nombre y contacto son identidad de la persona, no gestión de equipo.
--
-- ── LO QUE ESTO ABRE, Y QUEDA DICHO ────────────────────────────────────────
--
-- Ninguna de las dos funciones limita el TARGET por rol: un admin puede editar a
-- cualquier miembro del club, incluido el owner. Al entrar el director, hereda
-- eso mismo — podrá editar el nombre y el contacto del admin_club y del owner.
-- Es lo que significa «igual que el admin» y es lo que se pidió. Si algún día se
-- quiere proteger al owner, el precedente de la casa está en la RLS de
-- `memberships`: `not profile_is_club_owner(club_id, profile_id)`.

create or replace function public.admin_update_staff_profile(
  p_club_id uuid,
  p_target_profile_id uuid,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(p_full_name), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Dirección del club (admin_club o director). El coordinador NO: la identidad
  -- es más sensible que la gestión de equipos.
  -- F14B-6: dirección del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid
       and m.role in ('admin_club', 'director') and m.left_at is null
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club (no se pueden tocar perfiles ajenos).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = p_target_profile_id
  ) then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  if v_name is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'name_too_long' using errcode = 'P0001';
  end if;

  -- Solo el nombre. Nunca auth.users, email, locale ni otros campos.
  update public.profiles
     set full_name = v_name, updated_at = now()
   where id = p_target_profile_id;
end;
$function$;

create or replace function public.admin_update_staff_contact(
  p_club_id uuid,
  p_target_profile_id uuid,
  p_phone text,
  p_contact_email text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(btrim(p_contact_email), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Dirección del club (admin_club o director). El coordinador NO: el contacto
  -- es identidad sensible.
  -- F14B-6: dirección del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid
       and m.role in ('admin_club', 'director') and m.left_at is null
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club (no se pueden tocar membresías ajenas).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = p_target_profile_id
  ) then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  if v_phone is not null and char_length(v_phone) not between 3 and 32 then
    raise exception 'phone_invalid' using errcode = 'P0001';
  end if;

  if v_email is not null then
    if char_length(v_email) > 254 then
      raise exception 'contact_email_invalid' using errcode = 'P0001';
    end if;
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'contact_email_invalid' using errcode = 'P0001';
    end if;
  end if;

  -- Solo phone/contact_email de la membership de ESE club. Nunca auth, profiles,
  -- role ni otras columnas.
  update public.memberships
     set phone = v_phone, contact_email = v_email
   where club_id = p_club_id and profile_id = p_target_profile_id;
end;
$function$;
