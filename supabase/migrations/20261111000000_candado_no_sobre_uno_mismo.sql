-- ════════════════════════════════════════════════════════════════════════════
-- W-7 — «NO SOBRE UNO MISMO» BAJA A LA BASE DE DATOS.
--
-- La regla existía SOLO en la pantalla. Se midió al hacer W-4 (#734): los dos RPC
-- `admin_update_staff_profile` y `admin_update_staff_contact` no comparan el target
-- con `auth.uid()` en ningún sitio, así que lo único que impedía editarse a uno
-- mismo era que la interfaz no pintara el botón. Estaba escrita a mano en dos
-- diálogos de la web, y la app nativa iba camino de ser la tercera copia; W-4 la
-- subió a core (`canEditStaffIdentityOf`) y dejó anotado que abajo no la vigilaba
-- nadie. Esto cierra eso.
--
-- ── QUÉ COMPRA ESTO, EXACTAMENTE (y qué no) ─────────────────────────────────
-- Conviene que quede escrito, porque el nombre y el contacto NO están igual:
--
--   · EL NOMBRE no gana protección. `profiles_update_self` es
--     `for update using (id = auth.uid())` SIN restricción de columnas, así que
--     cualquiera puede escribir su propio `profiles.full_name` por la vía normal —y
--     de hecho es lo que hace la pantalla de perfil, vía `updateProfileFromClient`.
--     Cerrar el RPC para uno mismo no quita esa vía ni pretende quitarla: lo que
--     hace es que la función diga lo que es. Este RPC existe para editar a OTROS,
--     con validación y con gate de dirección; el camino de lo propio es el perfil.
--
--   · EL CONTACTO sí cambia de verdad, y hay que decirlo. `phone` y
--     `contact_email` viven en `memberships`, no en `profiles`, y esa tabla NO
--     tiene policy de autoedición: `memberships_update_admin` exige ser
--     admin_club/director del club (y deja fuera la fila del owner para todos).
--     O sea que este RPC era la ÚNICA vía para poner tu propio contacto de club.
--     Desde aquí solo puede ponértelo OTRO admin o director.
--
--     CONSECUENCIA CONOCIDA: en un club cuyo único admin_club es el owner, nadie
--     puede rellenar su contacto. No es una regresión observable —la interfaz ya lo
--     prohibía y este RPC solo se alcanza por ella, así que hoy tampoco se puede—,
--     pero sí cierra la puerta a arreglarlo por aquí. Si algún día se quiere, el
--     sitio es la pantalla de perfil: o una policy propia acotada a esas dos
--     columnas, o un `self_update_contact` aparte. NO reabrir este RPC: volvería a
--     mezclar «gestionar a otro» con «editar lo mío», que es justo lo que se separa.
--
-- ── POR QUÉ UN CANDADO Y NO UNA GUARDA, que es la doctrina de la casa ───────
-- El RPC hermano `admin_update_staff_role` NO prohíbe actuar sobre uno mismo:
-- protege el invariante que se rompería, y su comentario lo dice —«nunca dejar el
-- club sin admin_club (igual que antes; sobre otro o uno mismo)»—. Esa forma es
-- mejor cuando hay un invariante que nombrar.
--
-- Aquí no lo hay: editarse el nombre no rompe nada. Lo que se protege es otra cosa,
-- y es de diseño: que haya UN solo sitio donde cada dato se cambia. Dos caminos para
-- el mismo campo es cómo se acaba con dos validaciones que divergen —el nombre tiene
-- tope 120 en este RPC y su propia validación en el perfil—, y con una pantalla de
-- gestión que hace de pantalla de perfil sin decirlo.
--
-- El precedente de «ni por sí mismo» también existe en la casa:
-- `owner_immutable` en el mismo RPC de rol.
--
-- ── EL CÓDIGO DE ERROR ES `forbidden`, a propósito ─────────────────────────
-- No se estrena un `self_forbidden`. Dos motivos:
--   · la app ya lo traduce (`errorDelRpc` en core mapea 'forbidden', y está en
--     `StaffNameError` y en `StaffContactError`), así que esta migración no arrastra
--     ni una línea de código ni una clave de texto nueva;
--   · un mensaje propio no lo va a leer nadie: ninguna pantalla ofrece la acción.
--     Esto es un respaldo del candado de arriba, no un aviso al usuario. Si algún
--     día una pantalla necesita distinguirlo, entonces sí toca código y texto, y va
--     en su propio PR.
--
-- ── DE DÓNDE SALEN ESTOS CUERPOS ───────────────────────────────────────────
-- De la 20261085000000, que es la última que los definió (verificado: ninguna
-- migración posterior toca ninguna de las dos). Se reescriben ENTEROS con
-- `create or replace` y el único cambio es el bloque nuevo, marcado «W-7».
--
-- Lo demás queda LETRA POR LETRA: el gate de dirección con `is_superadmin()`
-- (F14B-6), el `target_invalid`, los topes (120 / 3-32 / 254), el regex del correo
-- y el UPDATE acotado a sus columnas. Si algo de esto se moviera, la migración
-- estaría revirtiendo trabajo ajeno en silencio.
--
-- ── EL CANDADO VA PRIMERO, y no da igual ───────────────────────────────────
-- Después de `not_authenticated` y ANTES del gate de rol. Así la función se lee como
-- lo que es —«esto no es para ti mismo, sea quien seas»— y la respuesta no depende
-- del rol de quien pregunta: un coordinador y un admin_club reciben el mismo
-- `forbidden` al intentarlo sobre sí mismos, que además es lo que no filtra si el
-- que pregunta tiene o no permiso para lo otro.
--
-- Y alcanza AL SUPERADMIN. También tiene su pantalla de perfil.
-- ════════════════════════════════════════════════════════════════════════════

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

  -- W-7 — NO SOBRE UNO MISMO. Este RPC es para editar a OTROS; lo propio se cambia
  -- en la pantalla de perfil (`profiles_update_self`, que sigue abierta). Alcanza
  -- también al superadmin. Ver la cabecera de 20261111000000.
  if p_target_profile_id = v_uid then
    raise exception 'forbidden' using errcode = 'P0001';
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

comment on function public.admin_update_staff_profile(uuid, uuid, text) is
  'Bug 2a — la DIRECCIÓN del club (admin_club o director, mig 20261085000000) o el '
  'superadmin (F14B-6) corrige el NOMBRE de un miembro. W-7 (20261111000000): NO '
  'sobre uno mismo — lo propio va por la pantalla de perfil. Solo toca '
  'profiles.full_name.';

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

  -- W-7 — NO SOBRE UNO MISMO. OJO: aquí el candado sí QUITA una vía, porque
  -- `phone`/`contact_email` viven en `memberships` y esa tabla no tiene autoedición.
  -- Tu contacto de club te lo pone otro admin o director. La consecuencia (un club
  -- con un solo admin) está escrita en la cabecera de 20261111000000, junto con
  -- dónde arreglarlo si algún día hace falta: en el perfil, NO reabriendo esto.
  if p_target_profile_id = v_uid then
    raise exception 'forbidden' using errcode = 'P0001';
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

comment on function public.admin_update_staff_contact(uuid, uuid, text, text) is
  'Teléfonos de contacto — la DIRECCIÓN del club (admin_club o director, mig '
  '20261085000000) o el superadmin (F14B-6) gestiona el CONTACTO de un miembro. W-7 '
  '(20261111000000): NO sobre uno mismo, y aquí eso QUITA la única vía de poner el '
  'propio (memberships no tiene autoedición). Solo toca memberships.phone y '
  'memberships.contact_email.';
