-- F14-1 — BASE de consentimientos RGPD/LOPDGDD (solo la fundación).
--
-- Puerta legal a la beta con familias reales. Esta migración crea ÚNICAMENTE la
-- base de datos: el registro versionado de textos legales y el LEDGER de
-- consentimientos. NO toca el wizard de alta, NO añade captura, NO añade gating
-- ni accesos de club/audit — eso es F14-2 en adelante.
--
-- Dos piezas:
--   1. legal_documents — versiones de cada texto legal. "Vigente" = mayor version
--      por doc_type (sin columna is_current). Cuerpo PLACEHOLDER hasta que el
--      asesor legal aporte los textos definitivos.
--   2. consents — ledger APPEND-ONLY (prueba legal). El estado actual de un
--      consentimiento es la ÚLTIMA fila por (tutor, jugador, tipo). Retirar un
--      consentimiento = insertar una fila nueva con granted=false, NUNCA UPDATE.
--      Un trigger bloquea UPDATE y DELETE incluso para service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

-- Tipos de documento legal (los textos que se versionan).
create type public.legal_document_type as enum (
  'privacy_policy',
  'terms_conditions',
  'image_internal',
  'image_social',
  'medical_informed_consent'
);

-- Tipos de consentimiento que un tutor otorga/retira. Nota: el consentimiento
-- médico se registra como 'medical_data_processing' (el tratamiento de los
-- datos), respaldado por el documento 'medical_informed_consent'.
create type public.consent_type as enum (
  'privacy_policy',
  'terms_conditions',
  'image_internal',
  'image_social',
  'medical_data_processing'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. legal_documents — versiones de textos legales
-- ─────────────────────────────────────────────────────────────────────────────

create table public.legal_documents (
  id            uuid primary key default gen_random_uuid(),
  doc_type      public.legal_document_type not null,
  version       integer not null check (version >= 1),
  title         text not null check (char_length(title) between 1 and 200),
  body          text not null,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint legal_documents_type_version_uniq unique (doc_type, version)
);

comment on table public.legal_documents is
  'F14-1 — versiones de los textos legales. La versión VIGENTE de cada doc_type es la de mayor `version` (no hay columna is_current). Cuerpos placeholder hasta que el asesor legal aporte los definitivos (F14-2+ los publicará como versiones nuevas).';
comment on column public.legal_documents.version is
  'Entero incremental por doc_type. Vigente = max(version) filtrando por doc_type.';

create index legal_documents_type_version_idx
  on public.legal_documents (doc_type, version desc);

-- Semilla: versión 1 de cada tipo con cuerpo PLACEHOLDER.
insert into public.legal_documents (doc_type, version, title, body) values
  ('privacy_policy',           1, 'Política de Privacidad',                       'Texto pendiente de asesor legal v1'),
  ('terms_conditions',         1, 'Términos y Condiciones',                       'Texto pendiente de asesor legal v1'),
  ('image_internal',           1, 'Consentimiento de imagen — uso interno',       'Texto pendiente de asesor legal v1'),
  ('image_social',             1, 'Consentimiento de imagen — redes sociales',    'Texto pendiente de asesor legal v1'),
  ('medical_informed_consent', 1, 'Consentimiento informado de datos médicos',    'Texto pendiente de asesor legal v1');

-- RLS: lectura para cualquier autenticado; escritura solo service_role
-- (operador de plataforma). Sin policies de INSERT/UPDATE/DELETE → deny por
-- defecto para authenticated; service_role hace bypass de RLS.
alter table public.legal_documents enable row level security;

create policy legal_documents_select_authenticated on public.legal_documents
  for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. consents — ledger append-only (prueba legal)
-- ─────────────────────────────────────────────────────────────────────────────
-- FK sin ON DELETE CASCADE a propósito: la prueba legal no debe borrarse en
-- silencio al eliminar un jugador/perfil (el borrado real es F14-7, deliberado).
-- Con el trigger de abajo, un cascade tampoco podría ejecutarse.

create table public.consents (
  id                      uuid primary key default gen_random_uuid(),
  tutor_profile_id        uuid not null references public.profiles(id),
  player_id               uuid not null references public.players(id),
  consent_type            public.consent_type not null,
  granted                 boolean not null,
  legal_document_version  integer not null check (legal_document_version >= 1),
  accepted_at             timestamptz not null default now(),
  ip                      inet,
  user_agent              text,
  created_at              timestamptz not null default now()
);

comment on table public.consents is
  'F14-1 — LEDGER append-only de consentimientos RGPD (prueba legal). Estado actual = ÚLTIMA fila por (tutor_profile_id, player_id, consent_type). Retirar = insertar fila nueva con granted=false; NUNCA UPDATE/DELETE (trigger lo bloquea, incluso service_role).';
comment on column public.consents.granted is
  'TRUE = otorgado; FALSE = retirado. Para los obligatorios (privacy/terms) siempre TRUE al aceptar; para los opcionales (imagen/médico) refleja el sí/no explícito.';
comment on column public.consents.legal_document_version is
  'Versión del legal_documents que el tutor aceptó (qué texto/versión consintió).';

-- Índice para resolver el estado actual: última fila por (tutor, jugador, tipo).
create index consents_state_idx
  on public.consents (tutor_profile_id, player_id, consent_type, accepted_at desc);

-- Trigger: bloquea UPDATE y DELETE (append-only). Los triggers se ejecutan para
-- TODOS los roles (service_role solo hace bypass de RLS, no de triggers).
create or replace function public.consents_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'consents es append-only (F14-1): % no permitido. Retirar un consentimiento = insertar una fila nueva con granted=false.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.consents_block_mutation() is
  'F14-1 — impide mutar/borrar el ledger de consentimientos. Cualquier UPDATE/DELETE lanza excepción, también bajo service_role.';

create trigger consents_block_update
  before update on public.consents
  for each row execute function public.consents_block_mutation();

create trigger consents_block_delete
  before delete on public.consents
  for each row execute function public.consents_block_mutation();

-- RLS: el tutor gestiona (INSERT/SELECT) SOLO sus propias filas. El operador de
-- plataforma (service_role) lee todo. Nada más por ahora (accesos de club/audit
-- se abren en F14-6/7). Sin UPDATE/DELETE policies (además el trigger los bloquea).
alter table public.consents enable row level security;

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (tutor_profile_id = auth.uid());

create policy consents_select_own on public.consents
  for select to authenticated
  using (tutor_profile_id = auth.uid());

-- Admin de plataforma = operador vía service_role. service_role ya hace bypass de
-- RLS; esta policy explícita documenta la intención "SELECT todo" (F14-6/7 abrirá
-- accesos de club con auditoría).
create policy consents_select_platform on public.consents
  for select to service_role
  using (true);
