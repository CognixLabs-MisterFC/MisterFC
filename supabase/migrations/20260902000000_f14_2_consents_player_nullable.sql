-- F14-2 — consents.player_id NULLABLE para consentimientos a NIVEL DE CUENTA.
--
-- T&C y Política de Privacidad se aceptan UNA vez por cuenta de tutor, NO por
-- hijo → esas filas del ledger van con player_id NULL. El resto del modelo de
-- F14-1 (ledger append-only, trigger, RLS) no cambia. ALTER de columna no lo
-- afecta el trigger de mutación (es DDL, no UPDATE/DELETE de filas).
alter table public.consents alter column player_id drop not null;

comment on column public.consents.player_id is
  'FK al jugador. NULL = consentimiento a NIVEL DE CUENTA del tutor (T&C, privacidad), que se aceptan una vez por cuenta y no por hijo (F14-2). Con hijo = consentimientos por jugador (F14-3+).';
