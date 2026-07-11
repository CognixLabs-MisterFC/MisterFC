-- F14B-4 — Auditar como acción de PLATAFORMA los accesos del superadmin a la médica.
--
-- Decisión de producto (Jose): SOLO se audita lo que YA se audita (la lectura de
-- la médica en get_player_medical, F14-6). No se añaden puntos de auditoría
-- nuevos (ni PII ni gestión). Lo único nuevo: DISTINGUIR cuándo quien lee es el
-- superadmin, para que su rastro sea diferenciable del de un admin del club.
--
-- Enfoque: un valor de `action` distinto — 'medical.read.platform' — cuando
-- is_superadmin(); en otro caso sigue siendo 'medical.read'. `action` es el
-- discriminador natural del evento y es texto libre (sin CHECK/enum → no hay
-- constraint que ampliar). `reason` queda para justificación humana, no para
-- clasificar la acción.
--
-- ALCANCE ESTRICTO: se recrea get_player_medical idéntica a F14-6/F14-7 salvo la
-- ETIQUETA del action en la rama que YA audita (no-tutor). NO cambia el CUÁNDO se
-- audita, ni el gate de consentimiento, ni los datos devueltos, ni nada más. El
-- superadmin llega a esta rama por el gate admin (user_can_access_player_medical
-- → user_is_admin_or_director → user_role_in_club='admin_club' vía el chokepoint
-- F14B-2) y por no ser tutor.

CREATE OR REPLACE FUNCTION public.get_player_medical(p_player_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS TABLE(allergies text, medication text, medical_conditions text, emergency_contact text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.player_medical%rowtype;
  v_club uuid;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- F14-7 — jugador suprimido: sin médica (además la fila ya se borró al aprobar).
  if exists (select 1 from public.players where id = p_player_id and erased_at is not null) then
    return;
  end if;

  if not (
    public.user_can_access_player_medical(p_player_id)
    and public.user_has_medical_consent_read(p_player_id)
  ) then
    raise exception 'forbidden';
  end if;

  select * into v_row from public.player_medical where player_id = p_player_id;

  if v_row.player_id is null or (
       v_row.allergies is null
   and v_row.medication is null
   and v_row.medical_conditions is null
   and v_row.emergency_contact is null
  ) then
    return;
  end if;

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
      v_uid,
      -- F14B-4: distingue el acceso del superadmin (acción de plataforma) del
      -- de un admin/staff del club. Solo cambia la ETIQUETA; el cuándo (solo si
      -- hay datos y no es tutor) y el gate de consentimiento no se tocan.
      case when public.is_superadmin() then 'medical.read.platform' else 'medical.read' end,
      'player_medical', p_player_id, v_club,
      v_ip, nullif(btrim(p_user_agent), ''), null
    );
  end if;

  return query
    select v_row.allergies, v_row.medication, v_row.medical_conditions, v_row.emergency_contact;
end;
$function$;
