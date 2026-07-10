-- F14-8 — DERECHO DE ACCESO (export PDF). El tutor descarga, de sus propios
-- hijos, un PDF con lo que YA VE en la app (identidad, foto, médica, histórico
-- deportivo, informes formales, evaluaciones si el club las comparte, logros).
-- El PDF se genera al vuelo (no se guarda). ESTA migración solo aporta la puerta
-- de AUDITORÍA: una entrada 'data.export' por descarga.
--
-- Regla de producto 8 (Jose): UNA sola entrada por descarga, action='data.export'.
-- NO se usa la reservada 'medical.export' (el export no es solo médico).
--
-- audit_log no tiene policy de INSERT de cliente (F5 / F14-6): la única escritura
-- legal es vía SECURITY DEFINER. Se sigue el patrón de get_player_medical /
-- audit_get_conversation: función owner que inserta en nombre del caller validado.
-- NO se abre ninguna policy de escritura.

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC record_data_export — registra la descarga del expediente por el tutor.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_data_export(
  p_player_id uuid,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_club uuid;
  v_erased timestamptz;
  v_ip inet;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  -- Solo el tutor (parent/guardian) del jugador puede registrar el export. Misma
  -- puerta de identidad que F14-6/F14-7 (user_is_tutor_of_player), NO el rol de club.
  if not public.user_is_tutor_of_player(p_player_id) then
    raise exception 'forbidden';
  end if;

  select club_id, erased_at into v_club, v_erased from public.players where id = p_player_id;
  if v_club is null then
    raise exception 'player_invalid';
  end if;
  -- Jugador suprimido (F14-7): su ficha es inaccesible → tampoco se audita/exporta.
  if v_erased is not null then
    raise exception 'erased';
  end if;

  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;

  -- UNA sola entrada por descarga (regla 8). reason NULL (evento automático).
  insert into public.audit_log (
    actor_profile_id, action, target_kind, target_id, club_id, ip, user_agent, reason
  ) values (
    v_uid, 'data.export', 'player', p_player_id, v_club,
    v_ip, nullif(btrim(p_user_agent), ''), null
  );
end;
$$;

comment on function public.record_data_export(uuid, text, text) is
  'F14-8 — registra la descarga del expediente (derecho de acceso) por el tutor. Exige user_is_tutor_of_player y jugador no suprimido. Inserta UNA fila audit_log action=data.export (reason NULL). NO usa medical.export. Owner-write (audit_log cerrada al cliente).';

revoke all on function public.record_data_export(uuid, text, text) from public;
grant execute on function public.record_data_export(uuid, text, text) to authenticated;
