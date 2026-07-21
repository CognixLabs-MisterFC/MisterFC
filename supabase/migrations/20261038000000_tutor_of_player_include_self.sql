-- F14-3b (extensión, opción B) — user_is_tutor_of_player acepta también relation='self'.
--
-- Contexto: hasta ahora un jugador ADULTO vinculado a su propia ficha
-- (player_accounts.relation='self') NO podía gestionar su foto/médica/expediente/
-- derecho al olvido: el helper user_is_tutor_of_player solo reconocía
-- relation IN ('parent','guardian'). Al mover esas 4 secciones a /perfil se
-- decide (Jose) que el propio jugador adulto SÍ gestione lo suyo.
--
-- Cambio MÍNIMO y ÚNICO: se añade 'self' al IN de relations permitidos en
-- user_is_tutor_of_player. El vínculo sigue siendo obligatorio (profile_id =
-- auth.uid() sobre un player_account propio); no se amplía nada más.
--
-- Este único helper es la puerta de las 4 acciones (todas delegan en él):
--   · set_player_photo (RPC)                    → foto
--   · storage player_photos_{insert,update,delete}_tutor (bucket)  → subir/borrar foto
--   · players_guard_photo_url (trigger)         → UPDATE directo de photo_url
--   · set_player_medical (RPC, rama relation)   → médica (sigue exigiendo ADEMÁS
--       user_has_medical_consent_write, consentimiento vigente — NO se toca aquí)
--   · request_player_erasure (RPC)              → derecho al olvido
--   · /mi-ficha/export/[playerId] (route → RPC) → descargar expediente
-- Por eso NO se recrea ninguna de ellas: cambiar el helper propaga a las 6.
--
-- DEFINICIÓN VIVA ANTES (pg_get_functiondef), solo cambia el IN:
--   ...  and pa.relation in ('parent', 'guardian')
-- DESPUÉS:
--   ...  and pa.relation in ('parent', 'guardian', 'self')
-- (el resto del cuerpo es byte a byte idéntico: mismo exists, mismo profile_id =
--  auth.uid(), mismo player_id = p_player_id).
--
-- NULL-safe: exists(...) devuelve boolean no-nulo por definición (no hay
-- NULL-bypass posible); se conserva la forma STABLE SECURITY DEFINER.

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
      and pa.relation in ('parent', 'guardian', 'self')
  );
$$;

comment on function public.user_is_tutor_of_player(uuid) is
  'true si el user actual gestiona al jugador vía un player_account propio (relation parent/guardian/self). Base de permiso para foto/médica/expediente/olvido (F14-3b + extensión self). El adulto self gestiona lo suyo.';
