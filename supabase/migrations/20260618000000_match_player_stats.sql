-- F7.10 — Cierre y consolidación del partido.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §3.5 / §9 / §7.10.
--
-- `match_player_stats` se PREVIÓ en 7.1 y se DIFIRIÓ (se documentó el esquema,
-- no se creó la tabla). 7.10 la crea: al FINALIZAR el partido (match_state.status
-- = 'closed', §7.7b/7.7c) se materializa una fila por jugador NUESTRO que
-- participó, con sus totales DERIVADOS de match_events + match_starters +
-- match_periods (mismos motores de @misterfc/core que la tabla en vivo de 7.8 +
-- 7.4b + 7.7c; no se recalcula con lógica nueva). Reabrir → editar → re-cerrar
-- hace delete+reinsert de la cara del partido (consistente, sin filas obsoletas).
--
-- Respecto al esquema documentado en §3.5 se AMPLÍAN las columnas para cubrir el
-- alcance de 7.10 (faltas cometidas/recibidas por separado y penaltis
-- marcados/fallados); `fouls`/`shots` del boceto se concretan en estas.
--
-- Marcador FINAL: se guarda en match_state.goals_for/goals_against (ya existen);
-- la TANDA (si la hubo) en columnas nuevas shootout_for/shootout_against.

-- 1. Marcador de la tanda en la cabecera de sesión (el del partido ya está en
--    goals_for/goals_against). NULL si no hubo desempate por penaltis.
alter table public.match_state
  add column if not exists shootout_for     smallint check (shootout_for is null or shootout_for >= 0),
  add column if not exists shootout_against smallint check (shootout_against is null or shootout_against >= 0);

-- 2. Tabla de stats consolidadas por jugador (una fila por jugador propio que
--    participó). club_id/team_id DERIVADOS del evento en el trigger.
create table public.match_player_stats (
  event_id          uuid not null references public.events(id) on delete cascade,
  player_id         uuid not null references public.players(id) on delete cascade,
  club_id           uuid not null references public.clubs(id) on delete cascade,
  team_id           uuid not null references public.teams(id) on delete cascade,

  started           boolean  not null default false,
  minutes_played    smallint not null default 0 check (minutes_played >= 0),
  goals             smallint not null default 0 check (goals >= 0),
  assists           smallint not null default 0 check (assists >= 0),
  yellow_cards      smallint not null default 0 check (yellow_cards >= 0),
  red_cards         smallint not null default 0 check (red_cards >= 0),
  shots             smallint not null default 0 check (shots >= 0),
  fouls_committed   smallint not null default 0 check (fouls_committed >= 0),
  fouls_received    smallint not null default 0 check (fouls_received >= 0),
  penalties_scored  smallint not null default 0 check (penalties_scored >= 0),
  penalties_missed  smallint not null default 0 check (penalties_missed >= 0),

  computed_at       timestamptz not null default now(),
  primary key (event_id, player_id)
);

comment on table public.match_player_stats is
  'F7.10 — stats consolidadas por jugador al cerrar el partido (insumo por-partido de F9). Una fila por jugador propio que participó; valores DERIVADOS de match_events + match_starters + match_periods (motores de 7.8/7.4b/7.7c). Reabrir+re-cerrar borra y recalcula la cara del partido. F7 no construye el perfil agregado (eso es F9).';

create index match_player_stats_player_idx on public.match_player_stats (player_id);

-- 3. Validación/derivación (mismo patrón que match_events): club_id/team_id desde
--    el evento; el jugador debe pertenecer al equipo del partido.
create or replace function public.match_player_stats_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  v_event := public.match_assert_event(new.event_id);
  new.club_id := v_event.club_id;  -- derivado, autoritativo
  new.team_id := v_event.team_id;  -- derivado, autoritativo
  perform public.match_assert_player_in_team(new.player_id, v_event);

  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id
       or new.player_id is distinct from old.player_id then
      raise exception 'pk_immutable' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_match_player_stats_validate
  before insert or update on public.match_player_stats
  for each row execute function public.match_player_stats_validate();

-- 4. RLS — coherente con el resto de F7 (cuerpo técnico del equipo + admin/coord,
--    vía user_can_record_match). Lectura ampliada a jugador/familia es F9.
alter table public.match_player_stats enable row level security;

create policy match_player_stats_select on public.match_player_stats
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_player_stats_insert on public.match_player_stats
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_player_stats_update on public.match_player_stats
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_player_stats_delete on public.match_player_stats
  for delete to authenticated using (public.user_can_record_match(event_id));
