-- F14 — DESEMPATE del ledger de consentimientos (RGPD).
--
-- PROBLEMA: `consents.accepted_at` es `default now()`, y `now()` es CONSTANTE
-- dentro de una transacción (es `transaction_timestamp()`). Las cuatro lecturas
-- que resuelven "estado actual = ÚLTIMA fila" lo hacían con
-- `order by accepted_at desc limit 1`, SIN desempate: dos filas de la misma clave
-- selladas en la misma transacción empatan SIEMPRE, y entonces la respuesta la
-- decide el orden físico de la tabla, no el ledger. Con una concesión y una
-- revocación empatadas, el sistema puede responder `granted = true` DESPUÉS de que
-- la persona haya revocado. Es el ledger que existe para la auditoría de RGPD.
--
-- POR QUÉ IMPORTA AHORA (decisión Jose): `player_photo_visible` mira TODAS las
-- filas del jugador sin filtrar por tutor —"el último que contesta decide", sea la
-- madre o el padre— y eso deja el ORDEN como único criterio.
--
-- NO HABÍA COLUMNA MONÓTONA: `id` es `gen_random_uuid()` (v4 aleatorio) y
-- `created_at` es el MISMO `now()` que `accepted_at`, así que empata igual.
--
-- SOLUCIÓN: columna `seq` (identity). Estrictamente creciente por INSERT, también
-- dentro de una misma transacción → el empate deja de existir por construcción, y
-- el ledger pasa a poder ordenarse a sí mismo para una auditoría.
--
-- POR QUÉ `GENERATED ALWAYS AS IDENTITY` Y NO "columna nullable + UPDATE":
-- `consents` es append-only DURO (triggers `consents_block_update` /
-- `consents_block_delete` que lanzan excepción incluso bajo service_role), así que
-- rellenar con UPDATE es IMPOSIBLE sin desactivar la garantía. `ADD COLUMN ...
-- GENERATED ALWAYS AS IDENTITY` reescribe la tabla como DDL: NO dispara triggers de
-- fila, rellena las filas existentes y deja el append-only intacto (verificado en
-- ensayo BEGIN...ROLLBACK contra producción).
--
-- EFECTO SOBRE LOS DATOS ACTUALES: NINGUNO. Comprobado en producción antes de
-- escribir esto: 12 filas, 0 empates de (player_id, consent_type, accepted_at). El
-- relleno de las filas existentes sigue el orden físico (que en una tabla que nunca
-- se actualiza ni se borra coincide con el de inserción); es una CONVENCIÓN, no una
-- prueba, y por eso solo se acepta sabiendo que hoy no desempata ninguna respuesta.
--
-- Las cuatro funciones se recrean VERBATIM desde `pg_get_functiondef` de la base
-- viva (no desde las migraciones: `f14_14_revert` había revertido cuerpos), con el
-- ÚNICO cambio de añadir `, c.seq desc` al ORDER BY. Diff: 1 línea por función.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columna de desempate.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consents
  add column seq bigint generated always as identity;

comment on column public.consents.seq is
  'F14 — desempate del ledger. Estrictamente creciente por INSERT, TAMBIÉN dentro de una misma transacción (a diferencia de accepted_at/created_at, que son now() y empatan). El estado actual se resuelve con order by accepted_at desc, seq desc. GENERATED ALWAYS: nadie lo escribe a mano.';

comment on table public.consents is
  'F14-1 — LEDGER append-only de consentimientos RGPD (prueba legal). Estado actual = ÚLTIMA fila por (tutor_profile_id, player_id, consent_type), resuelta con order by accepted_at desc, seq desc (accepted_at empata dentro de una misma transacción; seq desempata). Retirar = insertar fila nueva con granted=false; NUNCA UPDATE/DELETE (trigger lo bloquea, incluso service_role).';

-- Los índices de estado llevaban `accepted_at desc` como última columna; se
-- extienden con `seq desc` para que el orden siga saliendo del índice.
drop index if exists public.consents_state_idx;
create index consents_state_idx
  on public.consents (tutor_profile_id, player_id, consent_type, accepted_at desc, seq desc);

drop index if exists public.consents_season_state_idx;
create index consents_season_state_idx
  on public.consents (tutor_profile_id, player_id, consent_type, season_id, accepted_at desc, seq desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las CUATRO lecturas de "última fila" (inventario de la base VIVA), recreadas
--    verbatim con el único cambio del ORDER BY.
--
--    Inventario (pg_get_functiondef, no migraciones): son 4, no 6. Las dos que
--    faltan de la cuenta inicial vivían en `tutor_pending_reconsent_docs`, que NO
--    EXISTE en producción (f14_14 fue revertida). `tutor_needs_reconsent` sí existe
--    pero resuelve con `exists(... granted ...)`, insensible al empate.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── player_photo_visible ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.player_photo_visible(p_player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when exists (
      select 1 from public.players p where p.id = p_player_id and p.erased_at is not null
    ) then false
    else coalesce((
      select c.granted
      from public.consents c
      where c.player_id = p_player_id and c.consent_type = 'image_internal'
      order by c.accepted_at desc, c.seq desc
      limit 1
    ), true)
  end;
$function$

;

-- ── user_has_medical_consent_read ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_has_medical_consent_read(p_player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select c.granted
    from public.consents c
    where c.player_id = p_player_id
      and c.consent_type = 'medical_data_processing'
    order by c.accepted_at desc, c.seq desc
    limit 1
  ), false);
$function$

;

-- ── user_has_medical_consent_write ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_has_medical_consent_write(p_player_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select c.granted
    from public.consents c
    where c.player_id = p_player_id
      and c.consent_type = 'medical_data_processing'
      and c.season_id = public.active_season_id(
        (select club_id from public.players where id = p_player_id)
      )
    order by c.accepted_at desc, c.seq desc
    limit 1
  ), false);
$function$

;

-- ── get_tutor_consents ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tutor_consents(p_club_id uuid)
 RETURNS TABLE(player_id uuid, player_name text, consent_type consent_type, granted boolean, accepted_at timestamp with time zone, legal_document_id uuid, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  order by c.player_id, c.consent_type, c.accepted_at desc, c.seq desc;
$function$

;

