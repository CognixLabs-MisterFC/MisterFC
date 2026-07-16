-- ─────────────────────────────────────────────────────────────────────────────
-- FIX — La rama club-wide de las ALINEACIONES exige alineación OFICIAL y PUBLICADA.
--
-- BUG (destapado en F15-A2, confirmado por Jose como fallo, no decisión de producto):
-- la rama club-wide de lineups_select / lineup_positions_select
-- (`user_belongs_to_event_club`, F7B2 mig 20260830 / FIX-DIRECTO mig 20261004) era
-- INCONDICIONAL: solo comprobaba pertenencia al club, sin mirar is_official ni
-- visibility. Consecuencia:
--   · Cualquier miembro del club veía las alineaciones en BORRADOR (is_official=false)
--     de cualquier equipo (un entrenador probando un once lo exponía a todo el club).
--   · Cualquier miembro del club veía alineaciones con visibility='staff' (marcadas
--     explícitamente SOLO STAFF).
-- Lo destaparon rls_lineups_lote_b V5 (visibility='staff') y V6 (is_official=false).
--
-- DECISIÓN (Jose):
--   · Alineación OFICIAL y PUBLICADA (is_official=true AND visibility='team') → SÍ
--     visible a cualquier miembro del club (directo). Sin cambios (V4).
--   · BORRADOR (is_official=false) o SOLO-STAFF (visibility='staff') → SOLO el staff
--     del equipo (rama 1, user_can_manage_lineup). NI resto del club, NI jugadores,
--     NI familias, NI seguidores.
--
-- Cada policy se recrea desde su definición VIGENTE COMPLETA (mig 20261004). ÚNICO
-- cambio: las dos ramas club-wide (miembros del club y seguidor) pasan a exigir
-- `is_official AND visibility='team'`. Las ramas 1 (staff/manager) y 2 (equipo
-- propio) quedan IDÉNTICAS → el staff/admin/director/coord y el equipo propio no
-- cambian de acceso. No se pierde ninguna rama.
--
-- NO se tocan lineup_tactical_notes ni planned_substitutions: sus policies ya son
-- solo-staff (user_can_manage_lineup), sin rama club-wide.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── lineups_select ───────────────────────────────────────────────────────────
drop policy if exists lineups_select on public.lineups;
create policy lineups_select on public.lineups
  for select to authenticated
  using (
    -- (1) staff/manager del equipo (o admin/director/coord): ve TODO su ámbito,
    --     incluidos borradores y alineaciones solo-staff. Sin cambios.
    public.user_can_manage_lineup(event_id)
    -- (2) jugador/familia del equipo propio: solo la oficial compartida. Sin cambios.
    or (is_official and visibility = 'team' and public.user_can_see_shared_lineup(event_id))
    -- (3) club-wide (cualquier miembro del club): SOLO la oficial y publicada.
    --     ANTES: user_belongs_to_event_club(event_id) [incondicional → BUG].
    or (is_official and visibility = 'team' and public.user_belongs_to_event_club(event_id))
    -- (4) club-wide (seguidor): SOLO la oficial y publicada.
    --     ANTES: is_official and is_spectator_of_event_club(event_id) [faltaba visibility].
    or (is_official and visibility = 'team' and public.is_spectator_of_event_club(event_id))
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
          or (l.is_official and l.visibility = 'team' and public.user_belongs_to_event_club(l.event_id))
          or (l.is_official and l.visibility = 'team' and public.is_spectator_of_event_club(l.event_id))
        )
    )
  );
