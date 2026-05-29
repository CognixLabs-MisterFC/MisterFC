-- Subfase 4.3 (bis) — Nueva capability `can_manage_callups`.
--
-- Razón: gestión de convocatorias (publicar match_callup_meta + tomar
-- decisiones técnicas en callup_decisions) es decisión organizativa
-- sensible y no encaja en `can_register_match_events` (F1.4) ni en
-- `can_mark_attendance` (F4.1). Ver spec 4.0 §D4.
--
-- Sigue el patrón de F3 (`can_manage_calendar`) y F4.1 (`can_mark_attendance`):
--   1. Drop + recreate CHECK de capabilities.capability_name.
--   2. Actualiza trigger ensure_assistant_capabilities.
--   3. Backfill memberships de ayudante existentes (granted=false).

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
    'can_manage_callups'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger ensure_assistant_capabilities — añade can_manage_callups al seed
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
    'can_manage_callups'
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
-- 3. Backfill
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.capabilities (membership_id, capability_name, granted)
select m.id, 'can_manage_callups', false
  from public.memberships m
 where m.role = 'entrenador_ayudante'
on conflict (membership_id, capability_name) do nothing;
