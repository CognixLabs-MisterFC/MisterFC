-- F14-6 — AUDIT LOG de accesos a datos sensibles (médica).
--
-- Un SELECT no dispara triggers en Postgres → para auditar LECTURAS de la médica
-- se obliga a leerla por una RPC SECURITY DEFINER que valida, audita y devuelve, y
-- se CIERRA la lectura directa de player_medical. Réplica del patrón ya existente
-- `audit_get_conversation` (F5 D4.bis). Se REUTILIZA la tabla audit_log (su propio
-- comentario ya anticipa "Ampliado en F14 RGPD"); no se crea tabla nueva.
--
-- Reglas de producto (Jose):
--   1. Se auditan lecturas de STAFF y DIRECCIÓN. El TUTOR sobre su propio hijo NO.
--   2. Se audita SOLO cuando se devuelven datos (abrir ficha sin médica no registra).
--   3. Se auditan TAMBIÉN las escrituras del tutor (INSERT/UPDATE) — trivial por trigger.
--   4. La foto NO se audita por ninguna vía (aquí no se toca).
--   5. Retención: NO se implementa borrado automático (plazo lo fija el abogado).
--   6. Sin pantalla; solo registro en BD.
--
-- Alcance: NO se construye export (F14-8) ni borrado (F14-7). Las actions
-- 'medical.export' / 'medical.delete' quedan RESERVADAS, no se usan todavía.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. audit_log: aditivo. ip/user_agent + reason NULLABLE.
--    OJO (verificado): audit_get_conversation valida su razón DENTRO de la función
--    (messaging.sql: `if p_reason is null or char_length(trim(p_reason)) < 5`), NO
--    solo en el CHECK de la columna → relajar la columna NO rompe ese contrato. El
--    CHECK `char_length(reason) between 5 and 500` tolera NULL (un CHECK pasa en
--    NULL), así que basta con quitar el NOT NULL: una razón provista sigue 5..500.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.audit_log alter column reason drop not null;
alter table public.audit_log add column ip inet;
alter table public.audit_log add column user_agent text;

comment on column public.audit_log.reason is
  'Razón del acceso privilegiado. Obligatoria (>=5) para accesos con justificación humana (audit_get_conversation, que la valida en la función). NULL para eventos automáticos (F14-6: medical.read / medical.write).';
comment on column public.audit_log.ip is
  'F14-6 — ip del acceso (RPC de lectura; pasada como parámetro server-side). NULL en eventos de trigger (no la ven).';
comment on column public.audit_log.user_agent is
  'F14-6 — user-agent del acceso (RPC de lectura). NULL en eventos de trigger.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC get_player_medical — ÚNICA puerta de lectura. Valida (reusa los helpers,
--    NO reescribe el gate), audita si procede y devuelve.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_player_medical(
  p_player_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns table (
  allergies text,
  medication text,
  medical_conditions text,
  emergency_contact text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.player_medical%rowtype;
  v_club uuid;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate IDÉNTICO a la antigua policy SELECT (F14-4/F14-5): acceso por equipo +
  -- consentimiento de LECTURA. SECURITY DEFINER bypassa RLS, así que el gate se
  -- reaplica aquí con los MISMOS helpers (sin reescribir la lógica → sin drift).
  if not (
    public.user_can_access_player_medical(p_player_id)
    and public.user_has_medical_consent_read(p_player_id)
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.player_medical where player_id = p_player_id;

  -- Regla 2: sin fila o todos los campos NULL → vacío y NO se audita.
  if v_row.player_id is null or (
       v_row.allergies is null
   and v_row.medication is null
   and v_row.medical_conditions is null
   and v_row.emergency_contact is null
  ) then
    return;
  end if;

  -- Regla 1: solo se audita si el llamante NO es tutor de ese jugador.
  if not public.user_is_tutor_of_player(p_player_id) then
    select club_id into v_club from public.players where id = p_player_id;
    begin
      v_ip := nullif(btrim(p_ip), '')::inet;
    exception when others then
      v_ip := null;
    end;
    insert into public.audit_log (
      actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
    ) values (
      v_uid, 'medical.read', 'player_medical', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return query
    select v_row.allergies, v_row.medication, v_row.medical_conditions, v_row.emergency_contact;
end;
$$;

comment on function public.get_player_medical(uuid, text, text) is
  'F14-6 — ÚNICA vía de lectura de player_medical. Valida user_can_access_player_medical AND user_has_medical_consent_read (mismos helpers que la antigua policy). Audita medical.read solo si hay datos Y el llamante no es tutor (reglas 1 y 2). ip/user_agent server-side por parámetro.';

revoke all on function public.get_player_medical(uuid, text, text) from public;
grant execute on function public.get_player_medical(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. RPC set_player_medical — ÚNICA vía de ESCRITURA. El upsert por cliente no
--     puede sobrevivir al cierre de la tabla: ON CONFLICT DO UPDATE necesita
--     visibilidad SELECT de la fila, incompatible con "cerrar player_medical". Se
--     mueve la escritura a esta RPC (corre como OWNER → no depende de RLS). El
--     trigger de §4 sigue auditando medical.write; NO se duplica aquí.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_player_medical(
  p_player_id uuid,
  p_allergies text,
  p_medication text,
  p_medical_conditions text,
  p_emergency_contact text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Gate de ESCRITURA: tutor + consentimiento de la temporada ACTIVA. Mismos
  -- helpers que la antigua policy INSERT/UPDATE (sin reescribir la lógica).
  if not (
    public.user_is_tutor_of_player(p_player_id)
    and public.user_has_medical_consent_write(p_player_id)
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.player_medical (
    player_id, allergies, medication, medical_conditions, emergency_contact
  ) values (
    p_player_id,
    nullif(btrim(coalesce(p_allergies, '')), ''),
    nullif(btrim(coalesce(p_medication, '')), ''),
    nullif(btrim(coalesce(p_medical_conditions, '')), ''),
    nullif(btrim(coalesce(p_emergency_contact, '')), '')
  )
  on conflict (player_id) do update set
    allergies = excluded.allergies,
    medication = excluded.medication,
    medical_conditions = excluded.medical_conditions,
    emergency_contact = excluded.emergency_contact;
  -- updated_by/updated_at los pone player_medical_touch; la auditoría medical.write
  -- la pone player_medical_audit_write (AFTER INSERT/UPDATE). No se duplica.
end;
$$;

comment on function public.set_player_medical(uuid, text, text, text, text) is
  'F14-6 — ÚNICA vía de escritura de player_medical. Valida user_is_tutor_of_player AND user_has_medical_consent_write (mismos helpers que la antigua policy). Upsert de los 4 campos como owner. La auditoría medical.write la pone el trigger.';

revoke all on function public.set_player_medical(uuid, text, text, text, text) from public;
grant execute on function public.set_player_medical(uuid, text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CIERRE TOTAL de player_medical: una sola puerta (get_/set_player_medical).
--    Un ON CONFLICT DO UPDATE del cliente exige visibilidad SELECT de la fila, así
--    que "tutor no lee directo" y "tutor escribe por cliente" son incompatibles en
--    Postgres → la escritura pasa a RPC (§2b) y se cierra la tabla por completo:
--    · DROP de TODAS las policies de cliente (select/insert/update/delete).
--    · REVOKE de TODO privilegio a authenticated/anon/service_role. Ni tutor, ni
--      staff, ni service_role tocan la tabla directamente. Las RPC y los triggers
--      corren como OWNER (SECURITY DEFINER) → no dependen de estos privilegios.
--    · accept_pending_invitations ya escribe como owner → NO se toca (punto k).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy player_medical_select on public.player_medical;
drop policy player_medical_insert_tutor on public.player_medical;
drop policy player_medical_update_tutor on public.player_medical;
drop policy player_medical_delete_tutor on public.player_medical;
revoke all on public.player_medical from authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Auditar ESCRITURAS (regla 3): trigger AFTER INSERT OR UPDATE. Cubre el upsert
--    del tutor y el INSERT de accept_pending_invitations sin tocar la app. ip/ua
--    NULL (un trigger no ve la petición HTTP; no se inventan). SECURITY DEFINER
--    para poder escribir en audit_log (RLS sin policy de INSERT). Se omite si no
--    hay actor (escritura de sistema sin sesión) → nada que auditar como acceso.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_medical_audit_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
begin
  if v_uid is null then
    return null;  -- AFTER trigger: valor ignorado; sin actor no se audita.
  end if;
  select club_id into v_club from public.players where id = new.player_id;
  insert into public.audit_log (
    actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
  ) values (
    v_uid, 'medical.write', 'player_medical', new.player_id, v_club, null, null, null
  );
  return null;
end;
$$;

comment on function public.player_medical_audit_write() is
  'F14-6 — audita cada INSERT/UPDATE de player_medical (medical.write). Cubre el upsert del tutor y el INSERT de accept_pending_invitations. ip/user_agent NULL (trigger no los ve). SECURITY DEFINER para escribir en audit_log.';

create trigger player_medical_audit_write
  after insert or update on public.player_medical
  for each row execute function public.player_medical_audit_write();
