-- Bug 2 · 2c — contacto del entrenador (teléfono / email de contacto), gestionado
-- por el club y editable por el admin.
--
-- El contacto es un dato NUEVO gestionado por el club, NO la identidad global
-- (profiles) ni el email de LOGIN (auth.users.email, que jamás se toca). Por
-- analogía con players.invite_email (contacto club-managed del jugador), vive en
-- el registro club↔coach = memberships (por club). Columnas nullable con
-- validación de formato de email a nivel CHECK.
--
-- La RLS memberships_update_admin permite a admin_club Y coordinador editar
-- cualquier columna; pero 2a cerró que la identidad/contacto del staff es SOLO
-- admin_club. Para mantener esa paridad a nivel DB (y testearla en pgTAP) se usa
-- una función SECURITY DEFINER estrecha y gateada — mismo patrón que 2a.
--
-- admin_update_staff_contact(club, target, phone, contact_email):
--   · exige auth.uid() = admin_club de p_club_id (solo admin_club, NO coordinador),
--   · exige que el target sea miembro de p_club_id,
--   · normaliza vacío → NULL; valida formato de email y longitudes,
--   · actualiza SOLO memberships.phone y memberships.contact_email de ese club.
--   · NUNCA toca auth.users, profiles, role ni otros campos.

alter table public.memberships
  add column phone text
    check (phone is null or char_length(btrim(phone)) between 3 and 32),
  add column contact_email text
    check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

comment on column public.memberships.phone is
  'Bug 2 (2c) — teléfono de contacto del miembro, gestionado por el club (NO login). NULLABLE.';
comment on column public.memberships.contact_email is
  'Bug 2 (2c) — email de contacto del miembro, gestionado por el club. NO es el email de login (auth.users.email). NULLABLE.';

create or replace function public.admin_update_staff_contact(
  p_club_id           uuid,
  p_target_profile_id uuid,
  p_phone             text,
  p_contact_email     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(btrim(p_contact_email), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Solo admin_club del club (coordinador NO: el contacto es identidad sensible).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
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
$$;

comment on function public.admin_update_staff_contact(uuid, uuid, text, text) is
  'Bug 2 (2c) — el admin_club edita el contacto (phone/contact_email) de un miembro de su club, gestionado por el club. SECURITY DEFINER, solo admin_club, solo target del club, solo esas dos columnas. NO toca auth.users (email de login) ni profiles.';
