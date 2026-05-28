-- Subfase 2.4 — Vincular invitación a un jugador (tutor familiar)
--
-- Extiende `public.invitations` con dos columnas opcionales:
--   * player_id        — uuid del jugador al que se vincula la cuenta del invitado.
--   * player_relation  — 'parent' | 'guardian'. Self no se usa aquí (la cuenta
--                         del propio jugador adulto se gestiona aparte; F2.4 cubre
--                         solo tutor/familia de menores).
--
-- Reglas de coherencia:
--   - Si role != 'jugador' → player_id y player_relation deben ser NULL.
--     Solo el rol "jugador" admite vinculación a un player (familia).
--   - Si role = 'jugador' Y player_id IS NOT NULL → player_relation debe estar.
--     Aceptamos role='jugador' SIN player_id (caso jugador adulto que se invita
--     él mismo); en ese caso no se crea player_accounts al aceptar.
--   - El jugador debe pertenecer al mismo club que la invitación.
--
-- Al aceptar la invitación, el server action `attachToClub` también insertará
-- una fila en `player_accounts (player_id, profile_id, relation)` cuando estos
-- campos estén. La policy de `player_accounts` (F1.7) permite el INSERT al
-- aceptante porque el user actual es el `profile_id` y la ficha del jugador
-- pertenece a su club tras la membership.

alter table public.invitations
  add column player_id uuid references public.players(id) on delete cascade,
  add column player_relation text check (
    player_relation is null or player_relation in ('parent', 'guardian')
  );

comment on column public.invitations.player_id is
  'Si el invitado se vincula como tutor (parent/guardian) de un jugador concreto. Solo aplicable cuando role=jugador.';
comment on column public.invitations.player_relation is
  '`parent` o `guardian` cuando hay player_id. NULL en cualquier otro caso.';

-- Constraint de coherencia rol/player_id/relation
alter table public.invitations
  add constraint invitations_player_role_consistency
  check (
    -- (a) Rol no jugador → ambos campos nulos.
    (role <> 'jugador' and player_id is null and player_relation is null)
    or
    -- (b) Rol jugador sin vinculación a player (jugador adulto auto-invitándose).
    (role = 'jugador' and player_id is null and player_relation is null)
    or
    -- (c) Rol jugador con vinculación: ambos campos presentes.
    (role = 'jugador' and player_id is not null and player_relation is not null)
  );

-- Trigger BEFORE INSERT/UPDATE para validar que player.club_id = invitation.club_id
-- (no expresable como CHECK por la referencia cross-table).
create or replace function public.invitations_assert_player_same_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  player_club uuid;
begin
  if new.player_id is null then
    return new;
  end if;

  select p.club_id into player_club
  from public.players p
  where p.id = new.player_id;

  if player_club is null then
    raise exception 'player not found' using errcode = '23503';
  end if;

  if player_club <> new.club_id then
    raise exception 'player belongs to a different club'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger invitations_player_same_club_check
  before insert or update of player_id, club_id
  on public.invitations
  for each row execute function public.invitations_assert_player_same_club();

create index invitations_player_idx on public.invitations (player_id)
  where player_id is not null;
