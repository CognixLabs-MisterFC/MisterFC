-- BC-1 · MODELO del borrado de cuenta (Apple Guideline 2.1 / 5.1.1 v).
--
-- Decisión de fondo en ADR-0021: el borrado es ANONIMIZACIÓN, y no es una preferencia
-- de estilo — `profiles.id` referencia `auth.users(id) ON DELETE CASCADE` y sobre
-- `profiles` cuelgan 5 FK `RESTRICT` (audit_log, messages, announcements, team_messages,
-- staff_messages) y una veintena `NO ACTION` (consents, erasure_requests, toda la autoría
-- del histórico). `auth.admin.deleteUser()` sobre un usuario con UN solo mensaje falla.
--
-- Esta migración NO borra nada ni cambia comportamiento: solo pone el modelo. El motor
-- (RPCs) va en la migración hermana `20261059000000_bc1_account_deletion_engine`.
--
-- Se aplica ANTES que la hermana por dos motivos:
--   1. `ALTER TYPE ... ADD VALUE` no puede USARSE en la misma transacción en que se añade.
--      Los valores nuevos NO se usan aquí ni en la hermana: los consume BC-7 (avisos),
--      sobre tipos ya regenerados. Mismo patrón que 20261044 → 20261045 (erasure_requested).
--   2. La hermana referencia la tabla y las columnas que se crean aquí.
--
-- Tras aplicarla: añadir a mano las firmas nuevas a `packages/core/src/supabase/database.ts`
-- (NO `pnpm db:types` completo — borra los `| null` escritos a mano, ver PR #404).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tipos de notificación (los consume BC-7, aquí solo se declaran).
--    ALTER TYPE ADD VALUE es IRREVERSIBLE. Los nombres son definitivos.
-- ─────────────────────────────────────────────────────────────────────────────
alter type public.notification_type add value if not exists 'account_deletion_requested';
alter type public.notification_type add value if not exists 'account_deletion_completed';
alter type public.notification_type add value if not exists 'tutor_unlinked';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. account_deletion_requests — la solicitud y su ciclo de vida.
--
--    Espeja el idiom de `erasure_requests` (F14-7): RLS con SELECT para el dueño,
--    CERO policies de escritura → solo se escribe desde RPC SECURITY DEFINER.
--
--    `profile_id` va con NO ACTION a propósito: la fila es la PRUEBA de que el
--    usuario ejerció su derecho, y debe sobrevivir a la anonimización del perfil.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.account_deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id),
  status        text not null default 'pending'
                  check (status in ('pending', 'cancelled', 'completed')),
  requested_at  timestamptz not null default now(),
  -- Plazo duro (decisión de Jose): a los 30 días naturales la cuenta se anonimiza
  -- apruebe, rechace o ignore el club las supresiones de menor asociadas.
  deadline_at   timestamptz not null,
  cancelled_at  timestamptz,
  completed_at  timestamptz,
  -- EXACTAMENTE las memberships que esta solicitud puso de baja. Cancelar revierte
  -- solo estas: si el club ya le había dado de baja de un club ANTES de pedir el
  -- borrado, esa baja no se resucita.
  affected_membership_ids uuid[] not null default '{}'::uuid[],
  -- HUECO RESERVADO para la suscripción anual de 3 €/familia (aún sin diseñar, ver
  -- spec BC.0 §8). Cuando exista el entitlement, aquí se sella su suspensión. BC-1
  -- lo deja siempre NULL y ninguna RPC lo escribe.
  entitlement_suspended_at timestamptz,
  reason        text check (reason is null or char_length(reason) <= 500),

  constraint account_deletion_requests_status_coherence check (
       (status = 'pending'   and cancelled_at is null     and completed_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
  )
);

comment on table public.account_deletion_requests is
  'BC-1 — solicitudes de borrado de cuenta (Apple 5.1.1 v / RGPD art. 17). Una sola pendiente por persona. El borrado es ANONIMIZACIÓN (ADR-0021). Escritura SOLO vía RPC SECURITY DEFINER; sin policies de INSERT/UPDATE/DELETE.';
comment on column public.account_deletion_requests.deadline_at is
  'Fecha límite dura: 30 días naturales desde la solicitud. Llegada esa fecha el cron anonimiza la cuenta aunque el club no haya decidido las supresiones de menor asociadas.';
comment on column public.account_deletion_requests.affected_membership_ids is
  'Las memberships que ESTA solicitud puso de baja. Cancelar revierte solo estas: nunca resucita una baja que el club hubiera dado por su cuenta antes.';
comment on column public.account_deletion_requests.entitlement_suspended_at is
  'HUECO RESERVADO para la suscripción anual (spec BC.0 §8). BC-1 no lo escribe nunca.';

-- Una única solicitud pendiente por persona (idempotencia). Parcial: las canceladas
-- y las completadas quedan FUERA del índice, así que una persona que canceló puede
-- volver a solicitar el borrado sin tocar nada.
create unique index account_deletion_requests_one_pending
  on public.account_deletion_requests (profile_id) where status = 'pending';

-- Barrido del cron de los 30 días (BC-6).
create index account_deletion_requests_due_idx
  on public.account_deletion_requests (deadline_at) where status = 'pending';

alter table public.account_deletion_requests enable row level security;

-- SELECT: el interesado ve las suyas; el superadmin de plataforma, todas (necesita
-- verlas para el escalado cuando quien se borra es el admin_club de un club).
-- Sin policies de escritura: todo pasa por las RPC de la migración hermana.
create policy account_deletion_requests_select on public.account_deletion_requests
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_superadmin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. erasure_requests — estado `cancelled` + enlace con el borrado de cuenta.
--
--    NO hace falta tocar `erasure_requests_one_pending`: verificado contra la BD viva
--    que es un índice PARCIAL `WHERE status = 'pending'`, así que una fila cancelada
--    sale sola del índice y el jugador vuelve a admitir una solicitud nueva.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.erasure_requests
  drop constraint erasure_requests_status_check;

alter table public.erasure_requests
  add constraint erasure_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'cancelled'));

alter table public.erasure_requests
  add column account_deletion_id uuid references public.account_deletion_requests(id);

comment on column public.erasure_requests.account_deletion_id is
  'BC-1 — no nulo si la solicitud NACIÓ de un borrado de cuenta (el tutor era el único de ese jugador). Permite al servidor saber cuándo se puede completar el borrado y al club entender de dónde sale la solicitud.';

create index erasure_requests_account_deletion_idx
  on public.erasure_requests (account_deletion_id) where account_deletion_id is not null;

-- `decide_player_erasure` NO se toca: ya rechaza con `already_decided` cualquier fila
-- cuyo status no sea 'pending', así que una cancelada queda fuera de su alcance sola.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. memberships_one_admin_per_club — el índice tiene que mirar `left_at`.
--
--    HALLAZGO (leído de la BD viva): el índice es `WHERE role = 'admin_club'` a secas,
--    sin mirar la baja. Con la decisión de Jose de PERMITIR que un admin_club se borre
--    (se escala al superadmin, él designa nuevo admin), la fila del admin borrado
--    seguiría ocupando el hueco y el INSERT del admin nuevo fallaría con violación de
--    unicidad — el club quedaría bloqueado para siempre.
--
--    La invariante correcta es "un admin ACTIVO por club". Es la misma corrección que
--    ya se hizo en los helpers en 20261050 (enforcement de la baja de miembros).
--
--    `protect_club_owner_membership` NO estorba: es BEFORE DELETE, y aquí nunca se
--    borra la fila, solo se marca `left_at`.
-- ─────────────────────────────────────────────────────────────────────────────
drop index public.memberships_one_admin_per_club;

create unique index memberships_one_admin_per_club
  on public.memberships (club_id) where (role = 'admin_club' and left_at is null);

comment on index public.memberships_one_admin_per_club is
  'Un admin_club ACTIVO por club. El `left_at is null` lo añade BC-1: sin él, un admin que borra su cuenta deja el hueco ocupado y el club no puede recibir un admin nuevo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. profiles.deleted_at — la marca que la app necesita para pintar "Usuario
--    eliminado" (i18n es/en/va; el literal NO se guarda en la base).
--
--    Hace falta una marca porque tras anonimizar `full_name` queda NULL, y eso es
--    indistinguible de un usuario recién invitado que aún no ha puesto su nombre.
--
--    CANDADO DE PRIVILEGIOS (esto es lo delicado): `authenticated` y `anon` tienen
--    UPDATE a NIVEL DE TABLA sobre `profiles` (`relacl` = ...awdDxtm...), y la policy
--    `profiles_update_self` deja escribir cualquier columna de la propia fila. Una
--    columna nueva sería, por tanto, escribible desde el cliente: cualquiera podría
--    marcarse o desmarcarse como borrado con un PATCH a PostgREST.
--
--    Se cierra igual que ya está cerrado el SELECT (que es por columnas: por eso
--    `phone` no es legible): se revoca el UPDATE de tabla y se vuelve a conceder
--    columna a columna, EXACTAMENTE sobre las 8 que hoy son escribibles. `deleted_at`
--    se queda fuera. El SELECT sí se concede: la app tiene que poder leer la marca.
--
--    `service_role` y `postgres` no se tocan: conservan el UPDATE de tabla.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'BC-1 — fecha de anonimización de la cuenta (ADR-0021). NULL = cuenta viva. La app pinta "Usuario eliminado" desde i18n cuando no es nulo. NO escribible por el cliente: el UPDATE de `profiles` es por columnas y esta queda fuera.';

revoke update on public.profiles from authenticated, anon;

grant update (
  id, full_name, avatar_url, locale, date_of_birth, phone, created_at, updated_at
) on public.profiles to authenticated, anon;

grant select (deleted_at) on public.profiles to authenticated, anon;
