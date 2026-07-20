-- Reconciliación de categorías estándar — variante insensible a tildes/mayúsculas.
--
-- Contexto: C3 (20260704000000) ya adoptó como estándar las categorías cuyo nombre
-- casaba EXACTO con el catálogo canónico (lower(name) = lower(canon)). Pero se
-- quedaron fuera dos casos:
--   · Nombre con desajuste de tilde: "Alevin" (sin tilde) ≠ canónico "Alevín" →
--     C3 no lo cazó (lower('alevin') ≠ lower('alevín')). Sigue is_standard=false.
--   · Nombre ya canónico pero flag stale: p.ej. una categoría renombrada a
--     "Infantil" DESPUÉS de que C3 corriera → is_standard quedó en false y nada lo
--     recalcula (no hay trigger sobre categories).
--
-- Esta migración es GENÉRICA (por kind canónico, no por id ni club) e IDEMPOTENTE:
-- para cada fila con is_standard=false cuyo kind es canónico y cuyo nombre coincide
-- con el canónico SALVO tildes/mayúsculas (lower(unaccent(...)) igual), corrige el
-- nombre al canónico exacto y pone is_standard=true. NO toca half_duration_minutes,
-- NI las filas ya estándar, NI las custom reales (nombre libre que no unaccent-casa,
-- p.ej. "Alevín Élite", quedan intactas).
--
-- Criterio de adopción (el pedido): kind canónico Y
--   lower(public.unaccent(name)) = lower(public.unaccent(nombre_canónico)).
-- unaccent existe en el schema public de este proyecto (verificado).
--
-- El mapa canónico (kind → nombre) es EXACTAMENTE el de seed_standard_categories
-- (20260702000000_rework_c1_categories_standard_expand.sql:50-61); se replica aquí
-- literalmente. La duración NO se toca (Alevin/Infantil ya casan).

-- ── 1. Reporte de colisiones (defensivo) ───────────────────────────────────────
-- El unique es (club_id, lower(name)). Si al normalizar el nombre chocaríamos con
-- otra fila del mismo club que YA tiene ese lower(name), NO renombramos esa fila y
-- lo avisamos (con los datos actuales no hay ninguna, pero dejamos el guard).
do $$
declare
  r record;
begin
  for r in
    select c.id, c.club_id, c.name as nombre_actual, canon.name as nombre_canonico
      from public.categories c
      join (values
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
      ) as canon(kind, name) on canon.kind = c.kind
     where c.is_standard = false
       and lower(public.unaccent(c.name)) = lower(public.unaccent(canon.name))
       and c.name <> canon.name  -- requiere renombrado
       and exists (
         select 1 from public.categories o
          where o.club_id = c.club_id
            and o.id <> c.id
            and lower(o.name) = lower(canon.name)
       )
  loop
    raise warning 'reconcile categories: NO se renombra "%" (id=%) → "%" por colisión de nombre en el club %',
      r.nombre_actual, r.id, r.nombre_canonico, r.club_id;
  end loop;
end $$;

-- ── 2. Reconciliación ──────────────────────────────────────────────────────────
update public.categories c
   set name        = canon.name,
       is_standard = true
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
   and lower(public.unaccent(c.name)) = lower(public.unaccent(canon.name))
   -- Guard anti-colisión con el unique (club_id, lower(name)): si ya hay otra fila
   -- con ese nombre en el club, no renombramos (se reportó arriba).
   and not exists (
     select 1 from public.categories o
      where o.club_id = c.club_id
        and o.id <> c.id
        and lower(o.name) = lower(canon.name)
   );
