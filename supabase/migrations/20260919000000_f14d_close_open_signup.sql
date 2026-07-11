-- F14D — Cerrar el registro abierto (todo por invitación)
--
-- Decisión de producto (Jose): se elimina el signup libre por completo. Un auth
-- user solo puede nacer por un canal legítimo:
--
--   1. INVITACIÓN — el user lo crea `inviteUserByEmail(email, { data: {
--      invite_pending, invitation_id } })` desde los 3 sitios que generan
--      invitaciones. Verificado empíricamente en el remoto: `invitation_id`
--      aterriza en `raw_user_meta_data` (user_metadata), NO en
--      `raw_app_meta_data`. Además, la fila de `invitations` se inserta ANTES de
--      llamar a `inviteUserByEmail`, así que en el instante del trigger ya
--      existe una invitación pendiente para ese email.
--
--   2. FUNDADOR provisionado por el operador — cuenta creada a mano desde el
--      dashboard de Supabase para arrancar un club nuevo, marcada con
--      `raw_app_meta_data->>'founder' = 'true'` (el operador la fija al crearla).
--      El auto-alta de fundadores (superadmin) es futuro (F14B).
--
-- Cualquier otra alta (signup libre) se BLOQUEA. Como el trigger corre AFTER
-- INSERT en la MISMA transacción que el insert de auth.users, el RAISE revierte
-- también el auth user → no queda ningún user huérfano sin profile.
--
-- Solo se AÑADE el gate delante; el comportamiento del caso legítimo (crear el
-- profile con full_name/avatar_url/locale desde la metadata) NO cambia.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation_id text := new.raw_user_meta_data->>'invitation_id';
  v_founder       text := new.raw_app_meta_data->>'founder';
begin
  -- Gate de canal legítimo (F14D). Señal primaria: invitation_id concreto en
  -- user_metadata (invitación). Escape del operador: founder=true en
  -- app_metadata. Corroboración: existe invitación pendiente para este email.
  -- Se NIEGA solo cuando NINGUNO se cumple = registro abierto.
  if v_invitation_id is null
     and coalesce(v_founder, '') <> 'true'
     and not exists (
       select 1
       from public.invitations
       where lower(email) = lower(new.email)
         and accepted_at is null
         and expires_at > now()
     )
  then
    raise exception 'registro_no_permitido'
      using errcode = 'P0001',
            hint = 'El alta solo es posible por invitación. El signup libre está cerrado (F14D).';
  end if;

  insert into public.profiles (id, full_name, avatar_url, locale)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), ''),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    coalesce(new.raw_user_meta_data->>'locale', 'es')
  );
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Crea fila en public.profiles cuando se inserta una en auth.users. Idempotente vía PK. '
  'F14D: gate de registro cerrado — solo permite altas por invitación (invitation_id en '
  'user_metadata o invitación pendiente por email) o fundador provisionado por el operador '
  '(founder=true en app_metadata). En cualquier otro caso RAISE registro_no_permitido, que '
  'al correr AFTER INSERT en la misma transacción revierte el auth user (sin huérfanos).';
