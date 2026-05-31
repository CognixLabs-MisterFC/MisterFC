-- F6 Lote B' — Rediseño del modelo convocatoria ↔ alineación.
--
-- DECISIÓN ARQUITECTÓNICA: la CONVOCATORIA (callup_decisions) es la única
-- fuente de verdad del roster. La alineación trabaja SOBRE los convocados:
-- solo los distribuye en campo (titular) / banquillo. Ya NO existe la zona
-- "Fuera" dentro de la alineación — descartar a un jugador es una decisión de
-- convocatoria, no de alineación.
--
-- Por eso esta migración:
--   1. Migra cada fila lineup_positions con location='out' a una decisión de
--      convocatoria callup_decisions{decision='discarded', reason=out_reason},
--      sin pisar una decisión ya existente para ese (evento, jugador).
--   2. Borra las filas location='out' de lineup_positions.
--   3. Elimina la columna out_reason y sus checks, y restringe el check de
--      location a ('field','bench').
--
-- Aditiva-corrigiendo: no recrea tablas; solo limpia datos y endurece el
-- modelo. lineup_positions_coords_only_field se mantiene intacto.
--
-- Idempotencia / seguridad de datos:
--   - El INSERT a callup_decisions usa ON CONFLICT DO NOTHING sobre la PK
--     (event_id, player_id): si el cuerpo técnico ya tomó una decisión para
--     ese jugador en ese partido, NO la sobrescribimos.
--   - DISTINCT ON colapsa el caso "mismo jugador 'out' en varias alineaciones
--     del mismo partido" a una sola decisión (la más antigua).
--   - Deshabilitamos trg_callup_decisions_validate solo durante el INSERT de
--     migración: esas filas ya pasaron la validación de roster cuando se
--     crearon como 'out', y un cambio posterior de roster (team_members.left_at)
--     no debe hacer fallar la migración de datos históricos. decided_by se
--     toma de lineups.created_by (un profiles.id válido, el técnico autor).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Migrar filas 'out' → callup_decisions (discarded)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.callup_decisions disable trigger trg_callup_decisions_validate;

insert into public.callup_decisions (event_id, player_id, decision, reason, decided_by)
select distinct on (l.event_id, lp.player_id)
       l.event_id,
       lp.player_id,
       'discarded'::public.callup_decision_kind,
       lp.out_reason,
       l.created_by
  from public.lineup_positions lp
  join public.lineups l on l.id = lp.lineup_id
 where lp.location = 'out'
 order by l.event_id, lp.player_id, lp.created_at
on conflict (event_id, player_id) do nothing;

alter table public.callup_decisions enable trigger trg_callup_decisions_validate;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Borrar las filas 'out' de lineup_positions
-- ─────────────────────────────────────────────────────────────────────────────

delete from public.lineup_positions where location = 'out';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Quitar out_reason + restringir location a ('field','bench')
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lineup_positions
  drop constraint if exists lineup_positions_out_reason_coherent,
  drop constraint if exists lineup_positions_out_reason_check,
  drop constraint if exists lineup_positions_field_has_position,
  drop constraint if exists lineup_positions_location_check;

alter table public.lineup_positions
  drop column if exists out_reason;

alter table public.lineup_positions
  add constraint lineup_positions_location_check
    check (location in ('field', 'bench')),
  -- field exige position_code; bench NO lo lleva.
  add constraint lineup_positions_field_has_position check (
    (location = 'field' and position_code is not null)
    or (location = 'bench' and position_code is null));

comment on table public.lineup_positions is
  'F6 (rediseño Lote B'') — distribución del jugador en la alineación: field (titular) / bench (suplente). NO hay zona "out": descartar a un convocado es decisión de convocatoria (callup_decisions), no de alineación. La alineación solo distribuye a los jugadores convocados (called_up). Un jugador, una zona (unique lineup_id+player_id).';
