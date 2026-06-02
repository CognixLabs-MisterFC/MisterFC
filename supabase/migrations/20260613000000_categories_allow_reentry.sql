-- F7.6 — Cambios corridos (reentrada) por categoría.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.6 (ALCANCE 3).
--
-- En el fútbol base las sustituciones suelen ser "corridas": un jugador que sale
-- al banquillo puede VOLVER a entrar, sin límite (reparto de minutos). En el
-- fútbol adulto/competición rige la regla estándar: una vez sustituido, fuera.
--
-- Modelamos esa diferencia con un flag por categoría. El motor puro `deriveSquad`
-- (packages/core/src/match/squad.ts) lo lee para decidir la elegibilidad del que
-- ENTRA: con el flag ACTIVADO un jugador que ya jugó y salió puede reentrar; con
-- el flag DESACTIVADO no. Expulsados y ausentes NUNCA reentran (no cambia).
--
--   - Default `true`: la mayoría de categorías gestionadas en base son formativas
--     (querubín…cadete) → cambios corridos activados por defecto.
--   - Backfill a `false` para las categorías claramente ADULTAS por nombre
--     normalizado (amateur/senior/veterano): regla estándar sin reentrada.
--   - Editable por admin/coord (palanca; la UI de edición llega más adelante).

create extension if not exists unaccent;

alter table public.categories
  add column allow_reentry boolean not null default true;

comment on column public.categories.allow_reentry is
  'F7.6 — cambios corridos: ¿un jugador sustituido puede VOLVER a entrar? Default true (fútbol base). Backfill a false para categorías adultas (amateur/senior/veterano). Lo lee deriveSquad para la elegibilidad del que entra; expulsados/ausentes nunca reentran. Editable por admin/coord.';

-- Backfill: categorías adultas → sin reentrada (regla estándar).
do $$
declare
  c record;
  norm text;
begin
  for c in select id, name from public.categories loop
    norm := lower(unaccent(c.name));
    if norm like 'amateur%' or norm like 'senior%' or norm like 'veterano%' then
      update public.categories set allow_reentry = false where id = c.id;
    end if;
  end loop;
end $$;
