-- Subfase 4.1 (bis) — Nueva capability `can_mark_attendance`.
--
-- Razón: el ayudante necesita permiso para registrar asistencia de
-- entrenamiento. `can_register_match_events` (F1.4) cubre OTRO contexto
-- (eventos durante el partido). Asistencia a entrenamiento es decisión
-- propia + puede incluir `lesionado`/`enfermo` con implicación médica —
-- amerita su propia capability separada. Ver spec 4.0 §D4.
--
-- Esta migración sigue el patrón de F3 (`can_manage_calendar`):
--   1. Extiende el CHECK de capabilities.capability_name. Postgres no
--      permite ALTER CHECK; DROP + ADD.
--   2. Actualiza `ensure_assistant_capabilities` para que nuevas
--      memberships de ayudante se siembren con la cap (granted = false).
--   3. Backfill para memberships de ayudante existentes (idempotente).
--
-- `can_manage_callups` (segunda capability F4) NO se añade aquí: pertenece
-- al Lote B (convocatorias). Una migración por lote, aislamos riesgo de
-- review.

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
    'can_mark_attendance'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger ensure_assistant_capabilities — añade can_mark_attendance al seed
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
    'can_mark_attendance'
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
select m.id, 'can_mark_attendance', false
  from public.memberships m
 where m.role = 'entrenador_ayudante'
on conflict (membership_id, capability_name) do nothing;
