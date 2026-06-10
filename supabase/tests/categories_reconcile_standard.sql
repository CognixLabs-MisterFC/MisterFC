-- Rework C · C3 — verifica la reconciliación (auto-adopción de match claro).
-- Migración 20260704000000_rework_c3_reconcile_standard_categories.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. El test
-- replica el UPDATE de la migración sobre fixtures controladas.
--
-- Casos:
--   A1. MATCH CLARO ("Infantil"/infantil, is_standard=false) → adoptada (true).
--   A2. MATCH AMBIGUO ("Infantiles"/infantil) → NO adoptada (sigue false).
--   A3. Custom sin kind ("Escuela"/null) → NO adoptada.
--   A4. Otro casing ("cadete"/cadete) también casa (case-insensitive) → adoptada.

begin;

insert into public.clubs (id, name, slug) values
  ('c3000000-0000-4000-8000-000000000001', 'Club C3', 'club-c3');

insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('c3000000-0dd0-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'Infantil',    'infantil', 35, false),
  ('c3000000-0dd0-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000001', 'Infantiles',  'infantil', 35, false),
  ('c3000000-0dd0-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000001', 'Escuela',      null,      30, false),
  ('c3000000-0dd0-4000-8000-000000000004', 'c3000000-0000-4000-8000-000000000001', 'cadete',      'cadete',   40, false);

-- Réplica EXACTA del UPDATE de la migración.
update public.categories c
   set is_standard = true
  from (values
    ('querubin','Querubín'),('prebenjamin','Prebenjamín'),('benjamin','Benjamín'),
    ('alevin','Alevín'),('infantil','Infantil'),('cadete','Cadete'),
    ('juvenil','Juvenil'),('amateur','Amateur'),('senior','Sénior'),('veterano','Veterano')
  ) as canon(kind, name)
 where c.is_standard = false
   and c.kind = canon.kind
   and lower(c.name) = lower(canon.name)
   and not exists (
     select 1 from public.categories s
      where s.club_id = c.club_id and s.kind = c.kind and s.is_standard
   );

do $$
declare v_a1 boolean; v_a2 boolean; v_a3 boolean; v_a4 boolean;
begin
  select is_standard into v_a1 from public.categories where id = 'c3000000-0dd0-4000-8000-000000000001';
  select is_standard into v_a2 from public.categories where id = 'c3000000-0dd0-4000-8000-000000000002';
  select is_standard into v_a3 from public.categories where id = 'c3000000-0dd0-4000-8000-000000000003';
  select is_standard into v_a4 from public.categories where id = 'c3000000-0dd0-4000-8000-000000000004';

  if not v_a1 then raise exception 'FAIL [A1]: "Infantil"/infantil debería adoptarse como estándar'; end if;
  if v_a2 then raise exception 'FAIL [A2]: "Infantiles" (ambiguo) NO debería adoptarse'; end if;
  if v_a3 then raise exception 'FAIL [A3]: "Escuela" (sin kind) NO debería adoptarse'; end if;
  if not v_a4 then raise exception 'FAIL [A4]: "cadete"/cadete (otro casing) debería adoptarse'; end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C3: reconciliación adopta solo los match claros.'
\echo '──────────────────────────────────────────────'
