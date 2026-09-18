-- ════════════════════════════════════════════════════════════════════════════
-- RV-3 · CONCEDER un consentimiento fuera del alta.
--
-- #622 cerró la foto sin decisión (`coalesce(..., false)`). Eso fue lo correcto, y
-- destapó lo que faltaba: RV-1 y RV-2 solo saben RETIRAR. Un tutor que nunca firmó
-- no tiene forma de firmar, porque la pantalla pinta el LEDGER y en el ledger no hay
-- nada que pintar. Medido en producción: de las 21 combinaciones (7 vínculos de tutor
-- × 3 permisos opcionales), **6 no tienen ninguna fila**. Dos jugadores enteros están
-- así, y uno de ellos TIENE FOTO: hoy esa foto no se ve y no existe ninguna manera de
-- que se vea.
--
-- ── NO SIRVE LA RPC DE RV-1 CON OTRO PARÁMETRO ──────────────────────────────
-- Lo miré antes de escribir nada. `revoke_player_consent` no vale ni cambiándole un
-- booleano, y no por cómo está escrita sino porque las dos operaciones se sellan
-- distinto:
--
--   · RETIRAR apunta AL DOCUMENTO QUE SE FIRMÓ (lo copia de la fila vigente): el
--     ledger es prueba de QUÉ se retiró.
--   · CONCEDER tiene que apuntar AL DOCUMENTO VIGENTE: es prueba de QUÉ SE ACEPTA
--     HOY. Copiar el documento de una fila anterior sellaría una aceptación de un
--     texto que la persona no ha visto, y en el caso que motiva todo esto —«jamás
--     firmado»— no hay ninguna fila de la que copiar.
--
-- Y la regla que RV-1 llama `nothing_to_revoke` es exactamente el caso que hay que
-- ATENDER aquí. Así que: función hermana. RV-1 no se toca — está aplicada, probada y
-- llamada desde la pantalla.
--
-- ── LA TRAMPA DEL TIPO DE DOCUMENTO ─────────────────────────────────────────
-- Los dos enums NO son el mismo, y no se corresponden por nombre en el quinto valor:
--
--     consent_type              legal_document_type
--     ───────────────────────   ─────────────────────────
--     image_internal        →   image_internal
--     image_social          →   image_social
--     medical_data_processing →  medical_informed_consent   ← aquí se rompe
--
-- `where doc_type = p_consent_type::text::legal_document_type` habría compilado y
-- habría fallado SOLO en el de salud, que es el único de los tres con datos del
-- art. 9. De ahí `consent_document_type`: el mapa en un sitio, con nombre, y con un
-- bloque de pgTAP que lo comprueba valor por valor. `accept_pending_invitations` y
-- `record_season_reconsent` llevan el mapa a mano desde F14; no los toco en esta
-- migración —son el alta y el formulario anual, y funcionan— pero el test nuevo
-- afirma el mapa que ellas usan, así que si alguien lo cambia salta igual.
--
-- ── «ACEPTO ESTO» TIENE QUE SER ESTO ────────────────────────────────────────
-- `p_legal_document_id` es OBLIGATORIO y se comprueba contra el vigente: si no
-- coinciden, `document_changed`. Es el id que la pantalla acaba de pintar. Sin esa
-- comprobación, un club que publica una versión nueva mientras el modal está abierto
-- consigue una fila que dice «aceptó la v3» de alguien que leyó la v2. Para un ledger
-- cuyo valor entero es servir de prueba, eso no es un detalle.
--
-- ── EL TEXTO SE PUEDE LEER ANTES DE FIRMAR (y no hace falta nada nuevo) ─────
-- Esto era el riesgo real de la tarea: `get_legal_document_body` está gateada por
-- «existe un consent tuyo que referencia este documento», así que un texto que nunca
-- firmaste NO se puede leer por ahí, y conceder a ciegas no es consentimiento.
-- Resultó que no hace falta inventar nada: la policy `legal_documents_select_own_club`
-- ya deja a cualquier miembro del club leer los documentos de su club, `authenticated`
-- conserva el SELECT después de #622 (comprobado, `body` incluido) y los 5 tutores de
-- producción tienen membresía viva en su club (comprobado: 5 de 5). Por eso
-- `get_tutor_consent_options` devuelve el ID Y EL TÍTULO del documento vigente y la
-- pantalla lee el cuerpo de la tabla. `get_legal_document_body` se queda como está:
-- sigue siendo «el texto exacto que firmaste», que es otra pregunta.
--
-- ── POR QUÉ HAY UNA RPC DE LECTURA NUEVA ────────────────────────────────────
-- `get_tutor_consents` no puede enseñar lo que no existe: es el ledger. Ampliarla con
-- filas sintéticas la habría convertido en mentirosa en un sitio donde no se puede
-- mentir — la lee la EXPORTACIÓN RGPD de acceso (`/mi-ficha/export`), y una fila sin
-- decisión se leería ahí como «denegado». Así que se queda intacta y al lado va
-- `get_tutor_consent_options`, que devuelve la REJILLA completa (cada hijo × los tres
-- opcionales) con el estado en tres valores: `granted`, `revoked`, `never`.
--
-- ── LA AUTORIDAD ES EL MISMO GATE QUE ESCRIBE ───────────────────────────────
-- Misma lección que #625 y #626: la lista sale del predicado, no de un filtro escrito
-- aparte. Aquí el predicado es `user_manages_player_sensitive`, el mismo que gatea
-- `grant_player_consent` y `revoke_player_consent`. Se aplica tal cual, sin copiar su
-- interior, y el pgTAP afirma la equivalencia (todo lo listado se puede conceder, y
-- todo lo que se puede conceder está listado). Regalo de hacerlo así: el gate ya dice
-- que un jugador MENOR con cuenta propia no maneja sus datos sensibles, así que los 2
-- vínculos `self` de producción (los dos menores) no reciben ninguna opción, y el día
-- que uno cumpla 18 la recibe sin tocar esto.
--
-- Nótese lo que NO se filtra: `left_club_at` ni `erased_at`. A propósito. Si eso debe
-- impedir una decisión, el sitio es el gate —donde lo verían las dos operaciones— y no
-- dos copias que se separan al mes siguiente. Hoy: 0 jugadores en cualquiera de los
-- dos estados.
--
-- ── QUÉ PASA AL CONCEDER, MEDIDO ────────────────────────────────────────────
-- Ensayado contra producción dentro de BEGIN…ROLLBACK, sobre el caso real (el jugador
-- con foto y sin ninguna fila de `image_internal`):
--
--     player_photo_visible:        false → TRUE   (y esa función gatea la RLS de
--                                                  storage: la foto pasa a poder leerse)
--     player_self_invite_blocker:  'consents_required' → desbloqueado
--
-- El segundo no lo buscaba y es la mitad del valor de esta migración: el mismo hueco
-- estaba impidiendo invitar al hijo a tener su propia cuenta, porque
-- `player_self_invite_blocker` exige que EXISTA decisión de imagen en la temporada
-- activa. Hoy hay 2 de 7 hijos bloqueados por eso, sin ninguna manera de desbloquearlos.
-- Y `medical_data_processing` devuelve el acceso a la ficha médica —lectura Y
-- escritura— porque la fila se sella en la temporada activa, que es la que mira
-- `user_has_medical_consent_write`. `image_social` no enciende nada automático: no hay
-- nada que publique solo. La pantalla dirá las tres cosas por separado, igual que dice
-- las tres de retirar.
--
-- ── LO QUE NO SE CONCEDE AQUÍ ───────────────────────────────────────────────
-- `terms_conditions` y `privacy_policy` → `not_grantable`. No es simetría con
-- `not_revocable` por gusto: esos dos son OBLIGATORIOS y se aceptan donde se mide que
-- están aceptados —el alta y el re-consentimiento anual, que sellan por temporada
-- (`tutor_needs_reconsent`)—. Una aceptación suelta desde Perfil no cerraría el muro y
-- dejaría una fila que parece cerrarlo.
--
-- SIN `commit`: las migraciones de este repo no lo llevan.
-- ════════════════════════════════════════════════════════════════════════════

-- ── El mapa consent_type → legal_document_type ──────────────────────────────
create or replace function public.consent_document_type(p_consent_type public.consent_type)
returns public.legal_document_type
language sql
immutable
as $$
  select case p_consent_type
    when 'terms_conditions'        then 'terms_conditions'::public.legal_document_type
    when 'privacy_policy'          then 'privacy_policy'
    when 'image_internal'          then 'image_internal'
    when 'image_social'            then 'image_social'
    when 'medical_data_processing'  then 'medical_informed_consent'
  end;
$$;

comment on function public.consent_document_type(public.consent_type) is
  'RV-3 — mapa consent_type → legal_document_type. Existe porque los dos enums NO coinciden por nombre: medical_data_processing se documenta con medical_informed_consent. Sin CASE por defecto: un valor nuevo del enum devuelve NULL y quien lo use fallará con no_document, en vez de escoger el documento de otro tipo.';


-- ── CONCEDER ────────────────────────────────────────────────────────────────
create or replace function public.grant_player_consent(
  p_player_id          uuid,
  p_consent_type       public.consent_type,
  p_legal_document_id  uuid,
  p_ip                 text default null,
  p_user_agent         text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tutor   uuid := auth.uid();
  v_club    uuid;
  v_season  uuid;
  v_granted boolean;
  v_doc_id  uuid;
  v_doc_ver integer;
begin
  if v_tutor is null then
    raise exception 'no_session' using errcode = '42501';
  end if;

  -- Antes que el gate, igual que en RV-1: es una regla del producto, no de
  -- autorización, y su mensaje debe ser el mismo para quien tiene permiso y para quien
  -- no.
  if p_consent_type in ('terms_conditions', 'privacy_policy') then
    raise exception 'not_grantable' using errcode = '22023';
  end if;

  if p_player_id is null or not public.user_manages_player_sensitive(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Serializa el comprobar-y-escribir. RV-1 no lo lleva y ahí no importaba: dos
  -- retiradas iguales son ruido y el latest-wins resuelve igual. Aquí es lo mismo,
  -- pero el doble toque en un móvil con mala red es el caso normal y una concesión
  -- duplicada en un registro de decisiones se lee peor.
  perform pg_advisory_xact_lock(hashtext('consent:' || v_tutor::text || ':' || p_player_id::text || ':' || p_consent_type::text));

  -- Estado vigente, EXACTAMENTE como lo resuelve `get_tutor_consents` (y como lo lee
  -- RV-1): última fila por (tutor, jugador, tipo), sin filtrar por temporada. Tiene que
  -- ser el mismo criterio o la persona recibiría un error sobre algo que no tiene
  -- delante.
  select c.granted into v_granted
  from public.consents c
  where c.tutor_profile_id = v_tutor
    and c.player_id = p_player_id
    and c.consent_type = p_consent_type
  order by c.accepted_at desc, c.seq desc
  limit 1;

  -- Idempotente. Ya está concedido: no hace falta una fila más diciendo lo mismo.
  if v_granted is true then
    return;
  end if;

  select p.club_id into v_club from public.players p where p.id = p_player_id;

  -- El documento VIGENTE del club para este tipo: `order by version desc limit 1`, que
  -- es el mismo criterio de `record_season_reconsent` y del alta. No hay columna
  -- «activo»; la versión más alta ES la vigente.
  select ld.id, ld.version into v_doc_id, v_doc_ver
  from public.legal_documents ld
  where ld.club_id = v_club
    and ld.doc_type = public.consent_document_type(p_consent_type)
  order by ld.version desc
  limit 1;

  -- Un club sin ese texto no puede recoger ese consentimiento. El alta se salta el
  -- permiso en silencio cuando falta (`if v_img_social_version is not null`); aquí no:
  -- la persona ha pulsado un botón y tiene que saber que no se ha guardado nada.
  if v_doc_id is null then
    raise exception 'no_document' using errcode = '22023';
  end if;

  -- Se firma LO QUE SE LEYÓ. Si el club publicó una versión nueva entre que la
  -- pantalla pintó el texto y este momento, no se sella nada: la pantalla recarga y
  -- vuelve a preguntar sobre el texto nuevo.
  if p_legal_document_id is distinct from v_doc_id then
    raise exception 'document_changed' using errcode = '22023';
  end if;

  v_season := public.active_season_id(v_club);

  -- `season_id` es NOT NULL, y además es la temporada la que hace que la concesión
  -- surta efecto donde se mide: `user_has_medical_consent_write` y
  -- `player_self_invite_blocker` filtran por la temporada activa.
  if v_season is null then
    raise exception 'no_active_season' using errcode = '22023';
  end if;

  insert into public.consents (
    tutor_profile_id, player_id, consent_type, granted,
    legal_document_id, legal_document_version, season_id, ip, user_agent
  )
  values (
    v_tutor, p_player_id, p_consent_type, true,
    v_doc_id, v_doc_ver, v_season,
    nullif(p_ip, '')::inet, nullif(p_user_agent, '')
  );
end;
$$;

comment on function public.grant_player_consent(uuid, public.consent_type, uuid, text, text) is
  'RV-3 — concede un consentimiento OPCIONAL (imagen interna, imagen en redes, datos de salud) insertando una fila granted=true contra el documento VIGENTE del club y la temporada ACTIVA. Exige el id del documento que la pantalla mostró y falla con document_changed si ya no es el vigente: el ledger prueba que se aceptó el texto que se leyó. Idempotente. terms_conditions y privacy_policy no se conceden aquí (not_grantable): son obligatorios y se aceptan en el alta o en el re-consentimiento anual, que sellan por temporada.';


-- ── LA REJILLA: lo que hay y lo que falta ───────────────────────────────────
create or replace function public.get_tutor_consent_options(p_club_id uuid)
returns table (
  player_id               uuid,
  player_name             text,
  consent_type            public.consent_type,
  state                   text,
  decided_at              timestamptz,
  signed_document_id      uuid,
  signed_document_title   text,
  current_document_id     uuid,
  current_document_title  text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Explícito y no cero filas: una rejilla vacía es legítima (quien no es tutor de
  -- nadie no tiene nada que decidir) y la pantalla necesita poder distinguirla de una
  -- sesión caducada. Es la misma razón por la que `getTutorConsentsFromClient` separa
  -- los dos motivos.
  if v_uid is null then
    raise exception 'no_session' using errcode = '42501';
  end if;

  return query
  with mios as (
    -- El universo son los vínculos de esta persona; quien decide es el GATE, aplicado
    -- tal cual. Sin copiar su interior: si mañana cambia, esta lista cambia con él.
    select distinct
      pl.id,
      nullif(btrim(pl.first_name || ' ' || coalesce(pl.last_name, '')), '') as nombre
    from public.player_accounts pa
    join public.players pl on pl.id = pa.player_id
    where pa.profile_id = v_uid
      and pl.club_id = p_club_id
      and public.user_manages_player_sensitive(pl.id)
  ),
  tipos as (
    select * from (values
      ('image_internal'::public.consent_type,  1),
      ('image_social',                         2),
      ('medical_data_processing',               3)
    ) as t(tipo, orden)
  ),
  -- Estado vigente POR TUTOR, igual que `get_tutor_consents` y que las dos escrituras:
  -- lo que se ofrece es lo que esta persona puede decidir. (El efecto sobre la foto y
  -- sobre la ficha médica, en cambio, es latest-wins sin mirar de quién es la fila: con
  -- dos tutores del mismo hijo, uno ve «sin decidir» sobre algo que el otro ya decidió.
  -- Es de RV-1, no de aquí, y hoy no hay ningún jugador con dos tutores.)
  vigente as (
    select distinct on (c.player_id, c.consent_type)
      c.player_id, c.consent_type, c.granted, c.accepted_at, c.legal_document_id
    from public.consents c
    join mios m on m.id = c.player_id
    where c.tutor_profile_id = v_uid
      and c.consent_type in (select tipo from tipos)
    order by c.player_id, c.consent_type, c.accepted_at desc, c.seq desc
  ),
  -- El texto VIGENTE de cada tipo en este club: la versión más alta.
  doc_vigente as (
    select distinct on (ld.doc_type) ld.doc_type, ld.id, ld.title
    from public.legal_documents ld
    where ld.club_id = p_club_id
      and ld.doc_type in (select public.consent_document_type(tipo) from tipos)
    order by ld.doc_type, ld.version desc
  )
  select
    m.id,
    m.nombre,
    tp.tipo,
    case
      when v.player_id is null then 'never'
      when v.granted           then 'granted'
      else                          'revoked'
    end,
    v.accepted_at,
    -- El documento FIRMADO (null si nunca se decidió): «el texto que aceptaste».
    v.legal_document_id,
    sd.title,
    -- El documento VIGENTE (null si el club no tiene ese texto): «el texto que
    -- aceptarías». Null aquí es lo que la pantalla usa para no ofrecer el botón.
    dv.id,
    dv.title
  from mios m
  cross join tipos tp
  left join vigente v on v.player_id = m.id and v.consent_type = tp.tipo
  left join public.legal_documents sd on sd.id = v.legal_document_id
  left join doc_vigente dv on dv.doc_type = public.consent_document_type(tp.tipo)
  order by m.nombre nulls last, m.id, tp.orden;
end;
$$;

comment on function public.get_tutor_consent_options(uuid) is
  'RV-3 — rejilla completa de los TRES consentimientos opcionales por cada jugador cuyos datos sensibles maneja quien pregunta (gate user_manages_player_sensitive, el mismo que escribe). Estado en tres valores: granted, revoked, never. Devuelve el documento firmado (el texto que aceptaste) y el vigente (el que aceptarías, y el que grant_player_consent exige). Existe porque get_tutor_consents es el ledger y no puede enseñar lo que nunca se decidió — y no se amplía porque la lee la exportación RGPD de acceso, donde una fila sin decisión se leería como denegada.';


-- ── Privilegios ─────────────────────────────────────────────────────────────
-- Patrón de la migración 20261075000000: nombrar `anon` EXPLÍCITAMENTE, porque el
-- default privilege de Supabase le concede EXECUTE por su nombre y un `revoke ... from
-- public` a secas no toca esa entrada de la ACL. Hay un censo (`anon_execute_cerrado`)
-- que se pone rojo si una función nueva se queda abierta.
revoke all on function public.consent_document_type(public.consent_type) from public;
revoke all on function public.consent_document_type(public.consent_type) from anon;
grant execute on function public.consent_document_type(public.consent_type) to authenticated;
grant execute on function public.consent_document_type(public.consent_type) to service_role;

revoke all on function public.grant_player_consent(uuid, public.consent_type, uuid, text, text) from public;
revoke all on function public.grant_player_consent(uuid, public.consent_type, uuid, text, text) from anon;
grant execute on function public.grant_player_consent(uuid, public.consent_type, uuid, text, text) to authenticated;
grant execute on function public.grant_player_consent(uuid, public.consent_type, uuid, text, text) to service_role;

revoke all on function public.get_tutor_consent_options(uuid) from public;
revoke all on function public.get_tutor_consent_options(uuid) from anon;
grant execute on function public.get_tutor_consent_options(uuid) to authenticated;
grant execute on function public.get_tutor_consent_options(uuid) to service_role;
