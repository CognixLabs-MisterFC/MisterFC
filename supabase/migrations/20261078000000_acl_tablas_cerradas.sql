-- Cerrar las tablas de `public` a anon, y quitarle el TRUNCATE a authenticated.
--
-- ── EL FALLO ────────────────────────────────────────────────────────────────
--
-- Salió anotado en RV-1: `anon` tenía TRUNCATE sobre `consents`, la tabla de solo
-- añadido cuyos triggers rechazan UPDATE y DELETE incluso con service_role. TRUNCATE
-- no pasa por esos triggers ni por la RLS: es una operación de tabla, no de fila.
--
-- Medido hoy en producción, NO era solo `consents`. De las 76 tablas de `public`,
-- **70** conceden a `anon` Y a `authenticated` el juego entero:
--
--     arwdDxtm = SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN
--
-- Y la raíz es la misma que cazó la 20261075000000 con las funciones —
-- `pg_default_acl`, esquema `public`, objetos de tipo tabla:
--
--     postgres → anon=arwdDxtm  authenticated=arwdDxtm
--
-- O sea: cada tabla que crea una migración NACE ABIERTA. Las 6 excepciones
-- (`player_medical`, las tres de suscripción, `invite_accept_attempts`,
-- `revenuecat_deletion_queue`) son las que alguna serie posterior cerró a mano.
--
-- ── POR QUÉ NO ERA EXPLOTABLE HOY, Y POR QUÉ SE CIERRA IGUAL ────────────────
--
-- Comprobado, no supuesto, antes de escribir esto:
--
--   · NINGUNA política de `public` nombra a `anon` ni a `PUBLIC`. Así que la RLS
--     corta SELECT/INSERT/UPDATE/DELETE aunque el privilegio esté concedido.
--   · TRUNCATE sí se salta la RLS, pero PostgREST no lo emite. La otra vía sería
--     una función: NINGUNA función de `public` contiene TRUNCATE en su cuerpo, y
--     NINGUNA función ejecutable por anon usa SQL dinámico. anon puede ejecutar
--     exactamente dos funciones nuestras, las dos SECURITY DEFINER (mig 75).
--
-- Es defensa en profundidad, entonces. Se cierra porque lo que hoy sostiene el
-- candado es una coincidencia de tres condiciones —ninguna policy para anon, ningún
-- TRUNCATE en un cuerpo, ningún EXECUTE dinámico— y las tres las puede romper sin
-- querer el próximo PR que escriba una función nueva. El privilegio no debería estar.
--
-- ── QUÉ SE CIERRA ───────────────────────────────────────────────────────────
--
-- `anon` pierde TODO en `public`: las 76 tablas, la vista `players_sporting` y las
-- 2 secuencias. Son las 79 cosas que hay en el esquema. Es seguro porque ninguna
-- página pública lee una tabla como anon: `/invite/{token}`, `/clubes`, `/[slug]` y
-- las legales van por el cliente admin o por esas dos RPC SECURITY DEFINER.
--
-- `authenticated` CONSERVA SELECT, INSERT, UPDATE y DELETE —sin ellos la RLS no
-- tendría nada que gobernar y el síntoma serían tablas vacías, que es la lección que
-- dejó escrita la mig 75— y pierde las cuatro que no usa ninguna policy:
-- TRUNCATE, REFERENCES, TRIGGER y MAINTAIN.
--
-- `service_role` no se toca: lo usan los crons y los route handlers.
--
-- ── LO QUE AQUÍ NO HACE FALTA, Y EN LA MIG 75 SÍ ────────────────────────────
--
-- Allí la vía de PUBLIC no se podía cerrar sin tumbar el CI, porque PostgreSQL
-- concede EXECUTE a PUBLIC por defecto en cada función nueva y `pg_temp` está lleno
-- de helpers de la suite. Con las TABLAS no pasa: PostgreSQL no concede nada a PUBLIC
-- al crearlas. Medido: 0 de las 77 relaciones de `public` tienen una entrada de ACL
-- para PUBLIC. Así que cerrar a anon y a authenticated POR NOMBRE cierra del todo.
--
-- Y como allí, el default se cambia SOLO para `postgres`: la otra entrada de
-- `pg_default_acl` es de `supabase_admin` y contesta 42501 —el rol que aplica
-- migraciones no es superusuario—. No hace falta: gobierna lo que crea la
-- plataforma, no lo que crea `supabase db push`.

-- ── 1 · anon: fuera de `public` ─────────────────────────────────────────────

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ── 2 · authenticated: conserva el DML, pierde lo demás ─────────────────────
--
-- En bucle y solo sobre tablas de verdad (`relkind in ('r','p')`): TRUNCATE y
-- MAINTAIN no son privilegios de una vista, y `ON ALL TABLES IN SCHEMA` incluye la
-- vista. Escribirlo así también deja el recuento en el log del despliegue.

do $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select c.oid::regclass::text as tabla
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
    order by 1
  loop
    execute format(
      'revoke truncate, references, trigger, maintain on table %s from authenticated',
      r.tabla);
    v_n := v_n + 1;
  end loop;

  raise notice 'TRUNCATE/REFERENCES/TRIGGER/MAINTAIN retirados a authenticated en % tablas', v_n;
end $$;

-- ── 3 · Que las nuevas no nazcan abiertas ───────────────────────────────────

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;
