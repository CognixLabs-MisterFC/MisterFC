-- Subfase 1.6 — Invitaciones
--
-- Modelo:
--   admin_club / coordinador genera una invitación con (email, role, team opcional).
--   Se envía un magic link a `email` que tras la verificación lleva a
--   /invite/{token}. Al aceptar:
--     - se crea la membership (profile_id, club_id, role)
--     - el trigger ensure_assistant_capabilities (1.4) siembra capabilities si role=ayudante
--     - accepted_at = now()
--
-- token: UUID público que viaja en el email. Único + indexable.
-- created_by: profile que envió la invitación. SET NULL si ese profile se borra
--   (no queremos cascade borrar la invitación si el creador se va).
-- team_id: opcional. Sirve para que en Fase 2 el sistema sepa qué equipo
--   asignar al ayudante/principal al aceptar. En 1.6 lo guardamos sin actuar.

create table public.invitations (
  id            uuid primary key default gen_random_uuid(),
  token         uuid not null unique default gen_random_uuid(),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  club_id       uuid not null references public.clubs(id) on delete cascade,
  role          text not null check (role in (
    'admin_club',
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador'
  )),
  team_id       uuid references public.teams(id) on delete set null,
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.invitations is
  'Invitaciones a unirse a un club con un rol concreto. El token viaja en el email; aceptar crea la membership.';
comment on column public.invitations.token is
  'UUID público que se incluye en la URL del email de invitación: /invite/{token}.';
comment on column public.invitations.team_id is
  'Equipo asociado a la invitación (opcional). Útil para invitar a entrenador_principal/ayudante de un equipo concreto. En 1.6 se guarda; el flow de asignación a equipo llega en Fase 2.';
comment on column public.invitations.expires_at is
  'Por defecto +7 días desde creación. /invite/{token} rechaza tokens caducados.';

create index invitations_club_idx on public.invitations (club_id);
create index invitations_email_idx on public.invitations (lower(email));

alter table public.invitations enable row level security;
