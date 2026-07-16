-- ─────────────────────────────────────────────────────────────────────────────
-- FIX (corrige mig 20261022) — La rama club-wide de las ALINEACIONES exige SOLO
-- que la alineación sea OFICIAL (is_official). Se quita el `AND visibility='team'`.
--
-- POR QUÉ: en 20261022 (#364) acoté la rama club-wide a `is_official AND
-- visibility='team'` asumiendo que "oficial" y "publicada" eran lo mismo. NO lo son:
-- en la app son dos acciones independientes —
--   · setLineupOfficial  (alineacion/actions.ts:399-427) → is_official, NO visibility
--   · setLineupVisibility (alineacion/actions.ts:528-544) → visibility, NO is_official
-- — y el default de visibility es 'staff'. En prod 10 de 10 alineaciones oficiales
-- están en 'staff' y CERO en 'team' (nadie usa "compartir con el equipo"), así que
-- la condición de 20261022 dejaba el directo VACÍO (las 10 oficiales invisibles al
-- club).
--
-- DECISIÓN (Jose): marcar una alineación OFICIAL ya ES publicarla (es el once que
-- juega). La rama club-wide exige SOLO is_official:
--   · OFICIAL (is_official=true) → visible a cualquier miembro del club y al
--     seguidor (directo), con o sin visibility='team'.
--   · BORRADOR (is_official=false) → sigue oculto al club/jugadores/familias
--     (la fuga que importaba queda tapada igual).
--
-- Ambas policies se recrean desde su definición VIGENTE COMPLETA (mig 20261022).
-- ÚNICO cambio vs 20261022: en las ramas 3 (miembro del club) y 4 (seguidor) se
-- quita `visibility='team'`, quedando `is_official`. Ramas 1 (staff/manager) y 2
-- (equipo propio) IDÉNTICAS. Ninguna rama perdida. lineup_tactical_notes y
-- planned_substitutions NO se tocan (ya son solo-staff).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── lineups_select ───────────────────────────────────────────────────────────
drop policy if exists lineups_select on public.lineups;
create policy lineups_select on public.lineups
  for select to authenticated
  using (
    -- (1) staff/manager (o admin/director/coord): ve TODO su ámbito. Sin cambios.
    public.user_can_manage_lineup(event_id)
    -- (2) jugador/familia del equipo propio: solo la oficial compartida. Sin cambios.
    or (is_official and visibility = 'team' and public.user_can_see_shared_lineup(event_id))
    -- (3) club-wide (cualquier miembro del club): la OFICIAL (= publicada).
    --     20261022 exigía además visibility='team' [dejaba el directo vacío].
    or (is_official and public.user_belongs_to_event_club(event_id))
    -- (4) club-wide (seguidor): la OFICIAL, mismo criterio que un miembro del club.
    or (is_official and public.is_spectator_of_event_club(event_id))
  );

-- ── lineup_positions_select ──────────────────────────────────────────────────
drop policy if exists lineup_positions_select on public.lineup_positions;
create policy lineup_positions_select on public.lineup_positions
  for select to authenticated
  using (
    exists (
      select 1
      from public.lineups l
      where l.id = lineup_positions.lineup_id
        and (
          public.user_can_manage_lineup(l.event_id)
          or (l.is_official and l.visibility = 'team' and public.user_can_see_shared_lineup(l.event_id))
          or (l.is_official and public.user_belongs_to_event_club(l.event_id))
          or (l.is_official and public.is_spectator_of_event_club(l.event_id))
        )
    )
  );
