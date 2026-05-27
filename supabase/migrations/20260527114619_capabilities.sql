-- Subfase 1.4 — Capabilities configurables del entrenador ayudante
--
-- Diseño:
-- El entrenador_principal de un equipo decide qué puede hacer su ayudante en él.
-- Las capabilities se guardan por membership (no por user): cuando un user es
-- ayudante en varios clubs, cada club controla sus propias capabilities.
--
-- 8 capabilities estándar:
--   can_evaluate              — valorar a jugadores
--   can_create_lineups        — crear alineaciones
--   can_register_match_events — registrar eventos en directo (live)
--   can_create_sessions       — crear sesiones de entrenamiento
--   can_create_plays          — crear jugadas tácticas
--   can_see_medical           — ver notas médicas de jugadores
--   can_message_families      — escribir a familias
--   can_manage_squad          — gestionar plantilla (altas/bajas/dorsales)
--
-- Trigger ensure_assistant_capabilities: al crear una membership con
-- role='entrenador_ayudante' se inserta automáticamente la fila de capabilities
-- con granted=false para cada una. El principal después las marca true desde la UI.

-- ─────────────────────────────────────────────────────────────────────────────
-- capabilities
-- ─────────────────────────────────────────────────────────────────────────────

create table public.capabilities (
  id                uuid primary key default gen_random_uuid(),
  membership_id     uuid not null references public.memberships(id) on delete cascade,
  capability_name   text not null check (capability_name in (
    'can_evaluate',
    'can_create_lineups',
    'can_register_match_events',
    'can_create_sessions',
    'can_create_plays',
    'can_see_medical',
    'can_message_families',
    'can_manage_squad'
  )),
  granted           boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (membership_id, capability_name)
);

comment on table public.capabilities is
  'Capabilities por membership. Solo aplica a memberships con role=entrenador_ayudante. Las filas se crean automáticamente vía trigger ensure_assistant_capabilities.';
comment on column public.capabilities.granted is
  'true = el principal autorizó al ayudante a usar esta capability. Por defecto false.';

create index capabilities_membership_idx on public.capabilities (membership_id);

alter table public.capabilities enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper SQL: ¿este membership tiene la capability concedida?
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_has_capability(
  p_membership_id uuid,
  p_capability text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.capabilities c
    where c.membership_id = p_membership_id
      and c.capability_name = p_capability
      and c.granted is true
  );
$$;

comment on function public.user_has_capability(uuid, text) is
  'true si el membership tiene la capability concedida. Útil dentro de policies RLS y de checks server-side.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: al crear una membership con rol entrenador_ayudante, sembrar las
-- 8 capabilities con granted=false. Si el rol cambia a/desde ayudante en un
-- UPDATE, también sincronizamos.
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
    'can_manage_squad'
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

comment on function public.ensure_assistant_capabilities() is
  'Para memberships con role=entrenador_ayudante, garantiza que existan las 8 filas en capabilities (granted=false). Se ejecuta tras INSERT y UPDATE.';

create trigger memberships_ensure_assistant_capabilities
  after insert or update of role on public.memberships
  for each row execute function public.ensure_assistant_capabilities();
