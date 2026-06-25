-- F13.10g-GC — Publicación masiva de la campaña de un periodo.
--
-- RPC publish_campaign(season_id, period): en una operación pone visibility='team'
-- a TODOS los informes individuales COMPLETOS del club×season×period y marca la
-- campaña como 'published'. SECURITY DEFINER (bypassa RLS para el update masivo);
-- valida que auth.uid() es admin_club del club (D6a). Los INCOMPLETOS se quedan en
-- 'staff' (D3). Devuelve los player_id publicados para notificar a cada familia (D5).
--
-- "Completo" = todos los ítems del catálogo individual (v1, 22 ítems) presentes en
-- `scores`. Como el schema de escritura (core) garantiza que las claves de `scores`
-- ⊆ catálogo y los valores son enteros, basta comprobar que están TODAS las claves
-- con el operador jsonb `?&`. ⚠️ Esta lista debe reflejar DEVELOPMENT_REPORT_CATALOG
-- v1 (packages/core/.../development-report.ts); si cambia el catálogo, actualizar aquí.

create or replace function public.publish_campaign(p_season_id uuid, p_period text)
returns table (player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
  v_status text;
  v_items text[] := array[
    -- tecnico
    'control_orientado','pase','conduccion','regate','finalizacion','primer_toque',
    -- tactico
    'comprension_juego','toma_decisiones','ocupacion_espacios','lectura_tactica','juego_sin_balon',
    -- fisico
    'coordinacion','agilidad','velocidad','resistencia','explosividad',
    -- actitud
    'compromiso','motivacion','concentracion','companerismo','liderazgo','evolucion'
  ];
begin
  select s.club_id into v_club from public.seasons s where s.id = p_season_id;
  if v_club is null then
    raise exception 'season_not_found' using errcode = 'foreign_key_violation';
  end if;

  -- Autoridad: solo admin_club del club (D6a).
  if public.user_role_in_club(v_club) is distinct from 'admin_club' then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  -- La campaña debe estar lanzada (guard de transición launched→published).
  select c.status into v_status
    from public.assessment_campaigns c
   where c.season_id = p_season_id and c.period = p_period;
  if v_status is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'launched' then
    raise exception 'campaign_not_launched' using errcode = 'check_violation';
  end if;

  -- Publica SOLO los informes COMPLETOS (todos los ítems puntuados) que aún no
  -- estaban compartidos. Devuelve sus player_id (para la notificación masiva).
  return query
  update public.development_reports dr
     set visibility = 'team'
   where dr.club_id = v_club
     and dr.season_id = p_season_id
     and dr.period = p_period
     and dr.visibility <> 'team'
     and dr.scores ?& v_items
  returning dr.player_id;

  -- Marca la campaña como publicada (el guard del trigger permite launched→published).
  update public.assessment_campaigns
     set status = 'published', published_at = now()
   where season_id = p_season_id and period = p_period;
end;
$$;

comment on function public.publish_campaign(uuid, text) is
  'F13.10g — publica en masa los informes COMPLETOS del club×season×period (visibility=team) y marca la campaña published. Solo admin_club. Devuelve los player_id publicados (para notificar). Los incompletos quedan en staff.';

grant execute on function public.publish_campaign(uuid, text) to authenticated;
