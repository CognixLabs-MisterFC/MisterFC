-- F7.11 — Rivales destacados (solo de ESTE partido).
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.11.
--
-- Marcar jugadores RIVALES a seguir por DORSAL con una nota (rápido, duro,
-- peligroso…), a nivel de un partido concreto. El rival no tiene roster (§3.4):
-- se identifica por dorsal (1–99). No hace falta que el dorsal tenga eventos.
-- Añadir/editar/borrar → upsert/delete por (event_id, dorsal).
--
-- Las NOTAS GENERALES del partido reusan match_state.post_match_notes (ya existe,
-- previsto en 7.1 para 7.11) → no necesitan tabla ni columna nueva.
--
-- RLS coherente con el resto de F7: cuerpo técnico del equipo + admin/coord, vía
-- user_can_record_match(event_id). Trigger de validación = mismo patrón (el
-- evento debe existir, ser match/friendly y tener equipo).

create table public.match_rival_highlights (
  event_id    uuid not null references public.events(id) on delete cascade,
  dorsal      smallint not null check (dorsal between 1 and 99),
  note        text not null check (char_length(note) between 1 and 200),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (event_id, dorsal)
);

comment on table public.match_rival_highlights is
  'F7.11 — rivales destacados de un partido: dorsal rival (1–99) + nota libre. Solo a nivel de este partido (no hay ficha del rival entre partidos). Notas generales del partido → match_state.post_match_notes.';

create index match_rival_highlights_event_idx on public.match_rival_highlights (event_id);

-- Validación/derivación: el evento debe ser match/friendly con equipo (espejo del
-- resto de tablas de F7); mantiene updated_at en UPDATE.
create or replace function public.match_rival_highlights_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.match_assert_event(new.event_id);
  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id
       or new.dorsal is distinct from old.dorsal then
      raise exception 'pk_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_match_rival_highlights_validate
  before insert or update on public.match_rival_highlights
  for each row execute function public.match_rival_highlights_validate();

alter table public.match_rival_highlights enable row level security;

create policy match_rival_highlights_select on public.match_rival_highlights
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_rival_highlights_insert on public.match_rival_highlights
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_rival_highlights_update on public.match_rival_highlights
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_rival_highlights_delete on public.match_rival_highlights
  for delete to authenticated using (public.user_can_record_match(event_id));
