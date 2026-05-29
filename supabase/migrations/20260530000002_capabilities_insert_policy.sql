-- Fix bug F2.7 detectado durante smoke de F3 — Policy INSERT en capabilities.
--
-- Síntoma reportado: admin_club no puede activar capabilities desde
-- /equipos/[teamId]/staff/[membershipId]/capabilities. El switch aparece
-- en la UI pero al pulsarlo el server action recibe 42501 (RLS denial).
--
-- Causa raíz: el server action `toggleCapability` usa `supabase.from('capabilities')
-- .upsert(..., { onConflict: 'membership_id,capability_name' })`. PostgREST lo
-- traduce a INSERT ... ON CONFLICT DO UPDATE. PostgreSQL evalúa la policy INSERT
-- WITH CHECK para todas las filas en el INSERT path, también cuando habrá
-- conflict + UPDATE.
--
-- La migración F1.7 (20260527133957_rls_policies.sql) creó policy UPDATE para
-- capabilities pero NO INSERT (comentario explícito: "INSERT/DELETE solo vía
-- trigger SECURITY DEFINER"). Por eso el UPSERT falla para CUALQUIER rol,
-- no solo admin. El bug pasó desapercibido porque:
--   - El pgTAP de F2.7 (rls_capabilities_update.sql T1–T6) usa UPDATE plano,
--     no UPSERT → no cazó el problema.
--   - El smoke manual de F2.7 lo hicimos en otro flujo (presumiblemente sin
--     trigger upsert real desde el cliente).
--
-- Fix de esta migración: añade policy `capabilities_insert_managers` con el
-- MISMO predicate que la UPDATE existente (admin_club / coordinador /
-- entrenador_principal del club al que pertenece la membership). El CHECK del
-- nombre de capability sigue siendo la barrera contra capabilities libres.
--
-- DELETE sigue restringido (sin policy DELETE → solo definer del trigger).
-- El server action paralelamente migra a UPDATE plano (más limpio); esta
-- policy aporta defensa en profundidad por si un futuro cambio vuelve a UPSERT.

create policy capabilities_insert_managers on public.capabilities
  for insert to authenticated
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and public.user_role_in_club(m.club_id) in (
          'admin_club', 'coordinador', 'entrenador_principal'
        )
    )
  );

comment on policy capabilities_insert_managers on public.capabilities is
  'Permite UPSERT desde el cliente: el trigger ensure_assistant_capabilities sigue siendo la vía normal de seed, pero esta policy evita que INSERT ... ON CONFLICT DO UPDATE falle con 42501 para roles que sí pueden UPDATE.';
