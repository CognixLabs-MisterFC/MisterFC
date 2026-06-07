-- Fix — recrear la policy INSERT de capabilities (ausente en remoto).
--
-- Síntoma: `INSERT ... ON CONFLICT DO UPDATE` sobre public.capabilities (el
-- UPSERT de toggleCapability) falla con
--   "new row violates row-level security policy for table capabilities"
-- para CUALQUIER rol (pgTAP rls_capabilities_upsert [U1]).
--
-- Causa raíz: la policy `capabilities_insert_managers` (definida en
-- 20260530000002_capabilities_insert_policy.sql) NO existe en la BD remota
-- (pg_policies solo muestra capabilities_select + capabilities_update), aunque la
-- versión 20260530000002 figure como aplicada en schema_migrations → el
-- create policy nunca llegó a ejecutarse en este remoto. El UPSERT exige la
-- WITH CHECK de INSERT también en la rama de update; sin policy INSERT, se deniega.
--
-- Fix: recrear la policy de forma IDEMPOTENTE (drop if exists + create), con el
-- mismo predicado que la UPDATE (admin/coord/principal del club de la membership).
-- No se edita la migración aplicada; esta corre con versión nueva.

drop policy if exists capabilities_insert_managers on public.capabilities;

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
  'Permite UPSERT desde el cliente (INSERT ... ON CONFLICT DO UPDATE) para roles que también pueden UPDATE. Recreada en 20260620000001 porque la mig 20260530000002 no quedó aplicada en remoto.';
