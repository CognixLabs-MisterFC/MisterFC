-- B1 (v2 de propuestas) — SUSTITUIR la original con una propuesta, de forma ATÓMICA.
--
-- Contexto: una "propuesta de cambios" (#243) es una jugada 'proposed' con
-- `source_play_id` → la jugada PUBLICADA original. Al aprobarla, el coordinador
-- elige (B1): (A) SUSTITUIR la original, o (B) publicar como jugada nueva.
--
-- Esta RPC implementa (A) en UNA transacción: vuelca los datos de la propuesta SOBRE
-- la original (mismo registro published; su id/owner/club/estado se mantienen) y
-- CONSUME la propuesta (delete). Los `team_plays` de los equipos que tienen la
-- original NO se tocan (vínculo + signal_id por equipo intactos) → todos quedan con
-- la versión nueva automáticamente. (B) NO usa esta RPC: es el approve de siempre.
--
-- SECURITY DEFINER: salta la RLS para hacer las dos mutaciones atómicas, así que el
-- gate de aprobador es EXPLÍCITO aquí (user_can_approve_plays del club de la jugada).
-- No cambia ninguna policy. Las notificaciones las emite la app (notify-bus) con los
-- datos que devuelve esta función.

create or replace function public.replace_play_with_proposal(p_proposal_id uuid)
returns table (original_id uuid, play_name text, proposal_owner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop public.plays%rowtype;
  v_orig public.plays%rowtype;
begin
  select * into v_prop from public.plays where id = p_proposal_id;
  if not found then
    raise exception 'proposal_not_found' using errcode = 'no_data_found';
  end if;
  if v_prop.status <> 'proposed' then
    raise exception 'not_a_proposal' using errcode = 'check_violation';
  end if;
  if v_prop.source_play_id is null then
    raise exception 'no_source' using errcode = 'check_violation';
  end if;

  -- Gate de aprobador (SECURITY DEFINER salta la RLS → autorización explícita).
  if not public.user_can_approve_plays(v_prop.club_id) then
    raise exception 'not_approver' using errcode = 'insufficient_privilege'; -- 42501
  end if;

  select * into v_orig from public.plays where id = v_prop.source_play_id;
  if not found then
    raise exception 'original_not_found' using errcode = 'no_data_found';
  end if;
  if v_orig.club_id <> v_prop.club_id then
    raise exception 'cross_club' using errcode = 'check_violation';
  end if;
  if v_orig.status <> 'published' then
    raise exception 'original_not_published' using errcode = 'check_violation';
  end if;

  -- (A) Volcado de la propuesta SOBRE la original (mismo registro published). El
  -- trigger plays_validate corre en este UPDATE: owner/club inmutables (no cambian),
  -- status sin transición. Los team_plays no se tocan.
  update public.plays
     set play          = v_prop.play,
         name          = v_prop.name,
         description   = v_prop.description,
         strategy_type = v_prop.strategy_type,
         approved_by   = auth.uid(),
         approved_at   = now()
   where id = v_orig.id;

  -- Consumir la propuesta: no debe quedar como jugada published aparte.
  delete from public.plays where id = v_prop.id;

  original_id := v_orig.id;
  play_name := v_prop.name;
  proposal_owner_id := v_prop.owner_profile_id;
  return next;
end;
$$;

comment on function public.replace_play_with_proposal(uuid) is
  'B1 — Aprueba una propuesta de cambios SUSTITUYENDO la original: vuelca play/name/description/strategy_type de la propuesta sobre la jugada published de source_play_id (mismo registro; team_plays intactos) y borra la propuesta. Atómico. Gate: user_can_approve_plays del club. Devuelve (original_id, play_name, proposal_owner_id) para las notificaciones.';

grant execute on function public.replace_play_with_proposal(uuid) to authenticated;
