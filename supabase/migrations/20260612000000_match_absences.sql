-- F7.5 — "Quitar al que no viene": ausencia de última hora de un convocado.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.5 (añadido en 7.5; ver §3.4 ter).
--
-- Un convocado (titular o suplente de la alineación oficial) que finalmente NO
-- está disponible para ESTE partido (enfermo a última hora, no se presenta…).
-- Efecto en la captura en vivo: sale de los disponibles (campo/banquillo), NO
-- cuenta minutos (7.8 lo leerá como "no entra/sale ya"), NO puede entrar por
-- sustitución (7.5 lo excluye de elegibles) y queda registrado.
--
-- Modelo: 1 fila por (evento, jugador) ausente. Mismo patrón que match_starters
-- (§7 de 7.1): sin club_id (RLS por user_can_record_match), trigger de validación
-- reutilizando match_assert_event + match_assert_player_in_team, RLS de las 4
-- operaciones. Reversible: borrar la fila revierte la ausencia (el operador se
-- equivocó). FUERA: no toca minutos ni stats (eso es 7.8/7.10).

create table public.match_absences (
  event_id   uuid not null references public.events(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (event_id, player_id)
);

comment on table public.match_absences is
  'F7.5 — convocado AUSENTE de última hora para este partido (no disponible). Sale de campo/banquillo, no cuenta minutos (7.8) y no puede entrar por sustitución. Reversible borrando la fila.';

-- Validación por TRIGGER (igual que match_starters): evento match/friendly con
-- team y jugador del roster a la fecha; event_id/player_id inmutables en UPDATE.
create or replace function public.match_absences_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  v_event := public.match_assert_event(new.event_id);
  perform public.match_assert_player_in_team(new.player_id, v_event);

  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_match_absences_validate
  before insert or update on public.match_absences
  for each row execute function public.match_absences_validate();

-- RLS: igual que el resto de tablas de F7 (cuerpo técnico del partido).
alter table public.match_absences enable row level security;

create policy match_absences_select on public.match_absences
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_absences_insert on public.match_absences
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_absences_update on public.match_absences
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_absences_delete on public.match_absences
  for delete to authenticated using (public.user_can_record_match(event_id));
