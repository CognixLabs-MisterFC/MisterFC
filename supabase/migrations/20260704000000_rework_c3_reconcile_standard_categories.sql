-- Rework C · C3 MIGRATE — reconciliación de categorías que solapan un kind estándar.
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C3). ADR-0018.
-- NO destructiva: solo marca is_standard=true en las que casan CLARAMENTE con el
-- catálogo canónico. No borra, no renombra, no cambia kind.
--
-- Contexto: C1 sembró las estándar SALTANDO los kinds (o nombres) que el club ya
-- tenía (para no duplicar ni chocar con unique(club_id, lower(name))). Eso dejó
-- categorías preexistentes con kind canónico pero is_standard=false. Aquí:
--
--   · MATCH CLARO (kind canónico + nombre = nombre canónico, case-insensitive) →
--     se ADOPTA como estándar (is_standard=true). No hay conflicto unique porque
--     C1 no sembró ese kind (justo por existir ya esta fila).
--   · MATCH AMBIGUO (kind canónico, nombre distinto del canónico, p.ej.
--     "Infantiles") → NO se toca: queda custom y la UI lo avisa
--     (customOverlapsStandardKind). La adopción manual, si hace falta, será otra
--     subfase.
--
-- Idempotente: re-ejecutar no cambia nada (las ya estándar no entran).

update public.categories c
   set is_standard = true
  from (values
    ('querubin',    'Querubín'),
    ('prebenjamin', 'Prebenjamín'),
    ('benjamin',    'Benjamín'),
    ('alevin',      'Alevín'),
    ('infantil',    'Infantil'),
    ('cadete',      'Cadete'),
    ('juvenil',     'Juvenil'),
    ('amateur',     'Amateur'),
    ('senior',      'Sénior'),
    ('veterano',    'Veterano')
  ) as canon(kind, name)
 where c.is_standard = false
   and c.kind = canon.kind
   and lower(c.name) = lower(canon.name)
   -- Salvaguarda: no adoptar si el club ya tiene una estándar de ese kind.
   and not exists (
     select 1 from public.categories s
      where s.club_id = c.club_id
        and s.kind = c.kind
        and s.is_standard
   );
