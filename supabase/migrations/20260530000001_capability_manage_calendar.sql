-- Subfase 3.1 (bis) — Nueva capability `can_manage_calendar`.
--
-- Razón: F3 introduce el calendario y necesita una capability que permita al
-- principal delegar al ayudante la gestión de eventos del equipo (crear,
-- editar, borrar) sin darle el resto de plenipotencias.
--
-- Esta migración:
--   1. Extiende el CHECK de capabilities.capability_name para aceptar el
--      nuevo nombre. Postgres no permite ALTER CHECK; hay que DROP + ADD.
--   2. Actualiza el trigger `ensure_assistant_capabilities` para que
--      futuras memberships de ayudante se siembren también con esta cap.
--   3. Backfill: para cada membership existente con role='entrenador_ayudante',
--      inserta `can_manage_calendar` con granted=false. Idempotente vía
--      ON CONFLICT.
--
-- La policy `capabilities_update` (F1.7) no depende del nombre concreto y ya
-- cubre la nueva. La UI `/equipos/[teamId]/staff/[m]/capabilities` itera el
-- array CAPABILITY_NAMES exportado desde packages/core; al añadir la nueva
-- al array, el switch aparece automáticamente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CHECK actualizado
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.capabilities
  drop constraint if exists capabilities_capability_name_check;

alter table public.capabilities
  add constraint capabilities_capability_name_check
  check (capability_name in (
    'can_evaluate',
    'can_create_lineups',
    'can_register_match_events',
    'can_create_sessions',
    'can_create_plays',
    'can_see_medical',
    'can_message_families',
    'can_manage_squad',
    'can_manage_calendar'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger ensure_assistant_capabilities — añade can_manage_calendar al seed
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ensure_assistant_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap text;
  caps text[] := array[
    'can_evaluate',
    'can_create_lineups',
    'can_register_match_events',
    'can_create_sessions',
    'can_create_plays',
    'can_see_medical',
    'can_message_families',
    'can_manage_squad',
    'can_manage_calendar'
  ];
begin
  if new.role = 'entrenador_ayudante' then
    foreach cap in array caps loop
      insert into public.capabilities (membership_id, capability_name, granted)
      values (new.id, cap, false)
      on conflict (membership_id, capability_name) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill para memberships de ayudante existentes
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.capabilities (membership_id, capability_name, granted)
select m.id, 'can_manage_calendar', false
  from public.memberships m
 where m.role = 'entrenador_ayudante'
on conflict (membership_id, capability_name) do nothing;
