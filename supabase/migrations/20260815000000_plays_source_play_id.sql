-- "Proponer cambios" sobre una jugada PUBLICADA (banco del club, ADR-0019).
--
-- Un no-aprobador (p.ej. el principal de un equipo) no puede editar en sitio el
-- diseño de una jugada publicada (ciclo de aprobación JR-0, banner #242). La salida
-- es PROPONER: se crea una COPIA NUEVA en estado 'proposed' con sus cambios, owner
-- = el coach; la ORIGINAL sigue 'published' e intacta. La copia entra en la cola de
-- revisión existente (status='proposed' + user_can_approve_plays).
--
-- Esta migración SOLO añade el enlace propuesta→original. NO toca RLS ni el trigger
-- ni el ciclo: la copia se inserta con las MISMAS reglas que cualquier alta
-- (plays_insert: owner = auth.uid() AND user_can_create_plays; el trigger permite
-- INSERT en 'proposed').

-- Enlace de una propuesta con la jugada publicada de la que nace. Nullable (las
-- altas normales no son propuestas). ON DELETE SET NULL: si la original llegara a
-- borrarse, la propuesta sobrevive como jugada independiente (no se borra en
-- cascada). Self-FK a plays.
alter table public.plays
  add column source_play_id uuid
    references public.plays(id) on delete set null;

comment on column public.plays.source_play_id is
  'Si la jugada nació como "proponer cambios" sobre una jugada PUBLICADA, apunta a esa original. NULL en altas normales. La original no se modifica; al aprobar la propuesta (status→published) quedan ambas (gestionar/archivar la vieja = decisión aparte). ON DELETE SET NULL.';

-- Índice para localizar las propuestas de una jugada dada (futuro: "ver propuestas").
create index plays_source_play_idx on public.plays (source_play_id)
  where source_play_id is not null;
