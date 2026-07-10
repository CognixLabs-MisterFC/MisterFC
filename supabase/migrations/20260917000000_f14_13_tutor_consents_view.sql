-- F14-13 — PANTALLA DE CONSENTIMIENTOS EN EL PERFIL DEL TUTOR (solo lectura).
--
-- Dos RPCs de LECTURA (el tutor no retira consentimientos desde aquí):
--   1. get_tutor_consents(club) — estado latest-wins de los consentimientos del
--      tutor en el club activo (cuenta + por hijo), con título del documento.
--   2. get_legal_document_body(id) — el TEXTO EXACTO que el tutor aceptó (por
--      legal_document_id, no la versión vigente), gateado por "existe un consent
--      de este tutor que referencia ese documento".
--
-- Ambas SECURITY DEFINER con auth.uid() interno: no se fían de un id del cliente.
-- get_legal_document_body cierra el hueco de auditoría (el tutor lee lo que firmó
-- aunque el documento sea de un club del que ya no es miembro) SIN abrir la RLS de
-- legal_documents (que está restringida al club del usuario).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estado latest-wins de los consentimientos del tutor en el club activo.
--    DISTINCT ON (player_id, consent_type) + accepted_at DESC = última fila por
--    (tutor, hijo/cuenta, tipo). Usa el índice consents_state_idx (F14-1).
--    player_id NULL = consentimientos de CUENTA (terms_conditions, privacy_policy).
--    El filtro por club se hace vía legal_documents.club_id (cada consent ancla su
--    documento por FK; F14-11/12).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_tutor_consents(p_club_id uuid)
returns table (
  player_id uuid,
  player_name text,
  consent_type public.consent_type,
  granted boolean,
  accepted_at timestamptz,
  legal_document_id uuid,
  title text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (c.player_id, c.consent_type)
    c.player_id,
    case
      when c.player_id is null then null
      else nullif(btrim(pl.first_name || ' ' || coalesce(pl.last_name, '')), '')
    end as player_name,
    c.consent_type,
    c.granted,
    c.accepted_at,
    c.legal_document_id,
    ld.title
  from public.consents c
  join public.legal_documents ld on ld.id = c.legal_document_id
  left join public.players pl on pl.id = c.player_id
  where c.tutor_profile_id = auth.uid()
    and ld.club_id = p_club_id
  order by c.player_id, c.consent_type, c.accepted_at desc;
$$;

comment on function public.get_tutor_consents(uuid) is
  'F14-13 — estado latest-wins (última fila por player_id+consent_type) de los consentimientos del tutor (auth.uid()) en el club p_club_id, con el título del documento anclado. player_id NULL = consents de cuenta. Solo lectura. SECURITY DEFINER.';

revoke all on function public.get_tutor_consents(uuid) from public;
grant execute on function public.get_tutor_consents(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Texto EXACTO aceptado, por legal_document_id. Gate: solo si existe un consent
--    de ESTE tutor que referencia ese documento (auditoría de lo firmado). No abre
--    la RLS de legal_documents; funciona aunque el tutor ya no sea miembro del club.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_legal_document_body(p_legal_document_id uuid)
returns table (
  title text,
  body text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.consents c
    where c.tutor_profile_id = auth.uid()
      and c.legal_document_id = p_legal_document_id
  ) then
    raise exception 'forbidden';
  end if;

  return query
    select ld.title, ld.body
    from public.legal_documents ld
    where ld.id = p_legal_document_id;
end;
$$;

comment on function public.get_legal_document_body(uuid) is
  'F14-13 — título + body (markdown) del documento legal p_legal_document_id, SOLO si existe un consent del tutor (auth.uid()) que lo referencia. Sirve el texto EXACTO firmado sin abrir la RLS por club. RAISE forbidden si no lo consintió. SECURITY DEFINER.';

revoke all on function public.get_legal_document_body(uuid) from public;
grant execute on function public.get_legal_document_body(uuid) to authenticated;
