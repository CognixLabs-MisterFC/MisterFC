-- Rework C · C11a — modelo de "baja" de jugador (aditivo, no destructivo).
--
-- Spec/audit: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C11).
--
-- Hasta ahora un jugador pertenece al club por players.club_id y "sin equipo" se
-- deriva (no team_members abiertos). Faltaba representar que un jugador DEJA el
-- club sin destruir su histórico (team_members/stats/eventos). Se añade, con el
-- mismo idiom que team_members.left_at / team_staff.left_at:
--
--   players.left_club_at     date    NULL = miembro activo; fecha = de baja.
--   players.left_club_reason text    razón opcional de la baja.
--
-- set_player_left_club(club, player, left_at, reason): única operación, REVERSIBLE
-- e idempotente. left_at no nulo = baja (con razón); left_at NULL = reactivar
-- (limpia también la razón). Cero borrado: el histórico queda intacto.

alter table public.players
  add column left_club_at date,
  add column left_club_reason text
    check (left_club_reason is null or char_length(left_club_reason) <= 500);

comment on column public.players.left_club_at is
  'Rework C (C11a) — NULL = jugador activo en el club; una fecha = baja (dejó el club). No borra histórico: team_members/stats/eventos se conservan. "Sin equipo" sigue siendo derivado (sin team_members abiertos) y excluye a las bajas.';
comment on column public.players.left_club_reason is
  'Rework C (C11a) — razón opcional de la baja. Se limpia al reactivar.';

-- Índice parcial: el listado oculta bajas por defecto (left_club_at IS NULL).
create index players_active_club_idx on public.players (club_id) where left_club_at is null;

create or replace function public.set_player_left_club(
  p_club_id   uuid,
  p_player_id uuid,
  p_left_at   date,
  p_reason    text
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con el resto de Rework C).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El jugador debe pertenecer al club.
  if not exists (
    select 1 from public.players p
     where p.id = p_player_id and p.club_id = p_club_id
  ) then
    raise exception 'player_invalid' using errcode = 'P0001';
  end if;

  -- Baja (left_at no nulo) o reactivar (left_at NULL → limpia la razón). Solo
  -- toca estas dos columnas: nunca team_members/stats/eventos. Idempotente.
  update public.players
     set left_club_at     = p_left_at,
         left_club_reason = case when p_left_at is null then null else p_reason end,
         updated_at       = now()
   where id = p_player_id and club_id = p_club_id;

  return p_left_at;
end;
$$;

comment on function public.set_player_left_club(uuid, uuid, date, text) is
  'Rework C (C11a) — baja/reactivar de jugador, no destructivo. left_at no nulo = baja (+ razón); left_at NULL = reactivar (limpia razón). Solo admin_club, idempotente, reversible. No toca team_members/stats/eventos.';
