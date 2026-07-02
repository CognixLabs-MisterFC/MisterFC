-- F13B — Torneo (T-0 · modelo). Agrupación de partidos bajo un torneo.
--
-- Modelo (decisiones cerradas del diseño):
--   - La CABECERA del torneo es un evento `type='tournament'` (aloja la única
--     convocatoria del torneo). tournament_id = NULL, round = NULL.
--   - Cada PARTIDO del torneo es un evento `type='match'` con
--     tournament_id = id de la cabecera y round = 1,2,3… Su stack (alineación,
--     directo, marcador, valoraciones) sigue colgando 1:1 de su propio event_id.
--   - La convocatoria es ÚNICA en la cabecera y se hereda POR REFERENCIA (T-2);
--     aquí SOLO se añade el esquema de agrupación, sin lógica de herencia.
--
-- `tournament_id` es DISTINTA de `parent_event_id` (esta última está ocupada por
-- la recurrencia semanal, ver 20260530). Migración NUEVA y ADITIVA: no edita las
-- ya aplicadas. Columnas nullable → las filas existentes (todas con ambas NULL)
-- cumplen los CHECK sin backfill.

alter table public.events
  add column tournament_id uuid null references public.events(id) on delete cascade,
  add column round smallint null;

comment on column public.events.tournament_id is
  'F13B — si NOT NULL, este evento es un PARTIDO de un torneo y apunta a la '
  'cabecera del torneo (evento type=''tournament''). NULL en cualquier otro '
  'evento (incluida la propia cabecera). Distinta de parent_event_id (recurrencia).';
comment on column public.events.round is
  'F13B — orden/ronda del partido dentro del torneo (1,2,3…). NOT NULL sii '
  'tournament_id NOT NULL.';

-- Un partido de torneo (tournament_id NOT NULL) es siempre type='match': la
-- cabecera nunca cuelga de otra cabecera y el stack del partido usa la pila de
-- 'match' sin relajar triggers.
alter table public.events
  add constraint events_tournament_child_is_match
    check (tournament_id is null or type = 'match');

-- round y tournament_id van juntos: ambos NULL (evento normal / cabecera) o
-- ambos NOT NULL (partido de torneo). Biconditional seguro para las filas
-- existentes (ambas NULL → true).
alter table public.events
  add constraint events_round_iff_tournament
    check ((tournament_id is null) = (round is null));

-- Búsqueda de los partidos de un torneo por su cabecera.
create index events_tournament_idx
  on public.events (tournament_id) where tournament_id is not null;
