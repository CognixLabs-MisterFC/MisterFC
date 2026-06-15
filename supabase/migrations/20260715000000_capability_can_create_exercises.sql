-- Subfase 11.1b — Nueva capability `can_create_exercises`.
--
-- Razón: F11 (biblioteca de ejercicios) necesita una capability que permita al
-- principal delegar al ayudante la CREACIÓN/PROPUESTA de ejercicios. La
-- aprobación/publicación NO es capability: la gatea el rol Admin del club.
--
-- Patrón existente (F3.1/F4.1/F4.3), aditivo:
--   1. EXPAND del CHECK de capabilities.capability_name (DROP + ADD).
--   2. Trigger ensure_assistant_capabilities: añade la cap al seed de futuras
--      memberships de ayudante (granted=false → el principal decide).
--   3. Backfill de memberships de ayudante existentes.
--
-- BACKFILL: seed con granted=FALSE para los ENTRENADORES AYUDANTES EXISTENTES,
-- coherente con el resto de capabilities. El principal/admin concede a mano a
-- quién quiere que pueda proponer ejercicios. Las memberships de ayudante FUTURAS
-- siguen el mismo flujo (seed granted=false en el trigger).
-- admin/coord/principal NO necesitan esta fila: su autoridad para crear sale del
-- rol (ver user_can_create_exercises en la migración de la tabla).

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
    'can_manage_calendar',
    'can_mark_attendance',
    'can_manage_callups',
    'can_create_exercises'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger ensure_assistant_capabilities — añade can_create_exercises al seed
--    (futuras memberships de ayudante: granted=false, el principal decide)
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
    'can_manage_calendar',
    'can_mark_attendance',
    'can_manage_callups',
    'can_create_exercises'
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
-- 3. Backfill: seed can_create_exercises (granted=FALSE) en los ayudantes
--    EXISTENTES. Idempotente: si ya existe la fila, NO la toca (respeta una
--    concesión manual previa).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.capabilities (membership_id, capability_name, granted)
select m.id, 'can_create_exercises', false
  from public.memberships m
 where m.role = 'entrenador_ayudante'
on conflict (membership_id, capability_name)
  do nothing;
