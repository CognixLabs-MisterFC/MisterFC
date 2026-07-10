-- F14-13b — PUBLICACIÓN DE TEXTOS LEGALES DESDE LA APP (admin_club).
--
-- Hoy legal_documents solo se escribe con service_role (script load-legal-docs.mjs).
-- Esta RPC permite al admin_club de un club publicar una versión nueva del body de
-- uno de los 5 doc_type FIJOS de SU club, replicando la idempotencia del script,
-- SIN abrir escritura directa a la tabla (SECURITY DEFINER, gate por rol).
--
-- Reglas (Jose):
--   · Solo admin_club (NO director/coordinador): user_role_in_club(club)='admin_club'.
--   · Los 5 doc_type son fijos; el admin NO crea documentos ni cambia el título.
--   · TÍTULO fijo por doc_type: se REUTILIZA el título de la versión vigente del
--     club (que el trigger de siembra F14-11/12 garantiza que existe); fallback a
--     una constante por doc_type = los títulos de siembra. Nunca se deriva del body.
--   · Idempotencia: si el body normalizado (solo espacio final, como el script)
--     coincide con el vigente → NO publica, devuelve published=false.
--   · Publicar versión nueva NO fuerza re-firma (el re-consentimiento va por
--     temporada, F14-5; la re-firma por versión fue #308 y se revirtió). Esta RPC
--     NO toca consents ni el gate; solo inserta en legal_documents.

create or replace function public.publish_legal_document(
  p_club_id uuid,
  p_doc_type public.legal_document_type,
  p_body text
)
returns table (
  version integer,
  published boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cur_version integer;
  v_cur_body text;
  v_cur_title text;
  v_title text;
  v_new_version integer;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate: SOLO admin_club de ESTE club (no director, no coordinador).
  if public.user_role_in_club(p_club_id) is distinct from 'admin_club' then
    raise exception 'forbidden';
  end if;

  if p_body is null or btrim(p_body) = '' then
    raise exception 'empty_body';
  end if;

  -- Anti-carrera: serializa publicaciones del mismo (club, doc_type). Evita que
  -- dos publicaciones simultáneas calculen la misma version+1 y choquen con el
  -- unique (club_id, doc_type, version).
  perform pg_advisory_xact_lock(hashtext('publish_legal:' || p_club_id::text || ':' || p_doc_type::text));

  -- Versión VIGENTE del club/doc_type (título + body para título fijo e idempotencia).
  select ld.version, ld.body, ld.title
    into v_cur_version, v_cur_body, v_cur_title
  from public.legal_documents ld
  where ld.club_id = p_club_id and ld.doc_type = p_doc_type
  order by ld.version desc
  limit 1;

  -- Idempotencia: body normalizado (solo espacio en blanco FINAL) idéntico → no-op.
  if v_cur_body is not null
     and regexp_replace(v_cur_body, '\s+$', '') = regexp_replace(p_body, '\s+$', '') then
    return query select v_cur_version, false;
    return;
  end if;

  -- Título FIJO: el vigente del club; si no hubiera (no debería), constante de siembra.
  v_title := left(coalesce(
    v_cur_title,
    case p_doc_type
      when 'privacy_policy'           then 'Política de Privacidad'
      when 'terms_conditions'         then 'Términos y Condiciones'
      when 'image_internal'           then 'Consentimiento de imagen — uso interno'
      when 'image_social'             then 'Consentimiento de imagen — redes sociales'
      when 'medical_informed_consent' then 'Consentimiento informado de datos médicos'
    end
  ), 200);

  v_new_version := coalesce(v_cur_version, 0) + 1;

  insert into public.legal_documents (club_id, doc_type, version, title, body)
  values (p_club_id, p_doc_type, v_new_version, v_title, p_body);

  return query select v_new_version, true;
end;
$$;

comment on function public.publish_legal_document(uuid, public.legal_document_type, text) is
  'F14-13b — publica una versión nueva del body de un doc_type del club (max(version)+1) si el admin_club lo edita/sube. Título FIJO (reutiliza el vigente del club). Idempotente: body normalizado idéntico → published=false, no inserta. Gate user_role_in_club=admin_club. No toca consents/re-firma. SECURITY DEFINER.';

revoke all on function public.publish_legal_document(uuid, public.legal_document_type, text) from public;
grant execute on function public.publish_legal_document(uuid, public.legal_document_type, text) to authenticated;
