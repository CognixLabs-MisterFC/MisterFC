-- Cerrar el EXECUTE de anon en `public`, y cerrarlo para siempre.
--
-- ── EL FALLO, Y POR QUÉ NADIE LO VIO ────────────────────────────────────────
--
-- El patrón que llevamos usando, `revoke all on function ... from public`, NO cierra
-- el acceso de anon. Supabase concede `EXECUTE` a anon POR NOMBRE a través de los
-- privilegios por defecto del esquema:
--
--     pg_default_acl → public/funciones → anon=X/postgres
--                                       → anon=X/supabase_admin
--
-- Una concesión directa a un rol NO la quita un revoke a PUBLIC: son dos entradas
-- distintas de la ACL. Así que cada función creada por una migración nacía abierta a
-- anon, y el revoke de al lado daba la sensación contraria.
--
-- Medido hoy en producción: de 228 funciones en `public`, anon podía ejecutar 205.
-- 185 de ellas `SECURITY DEFINER`, o sea saltándose la RLS por diseño.
--
-- ── QUÉ ESTABA REALMENTE EN JUEGO ───────────────────────────────────────────
--
-- La mayoría tenían portero propio (`auth.uid() is null → no_session`) y aguantaban.
-- Veintiuna no tenían NINGUNA comprobación de identidad. Dos de ellas ESCRIBEN:
--
--   · seed_standard_categories(club_id) y seed_club_legal_documents(club_id), cuyo
--     `club_id` es PÚBLICO por `list_public_clubs()`. La cadena estaba completa:
--     cualquiera con la anon key listaba clubes y escribía en uno.
--   · match_assert_event(event_id) devolvía la fila ENTERA de `events` (comprobado
--     con un evento real: título, fechas, club, equipo, ubicación).
--   · team_chat_member_profile_ids(team_id) devolvía los perfiles del chat.
--   · y quince predicados que respondían sobre recursos ajenos: player_is_minor →
--     true, player_has_other_tutor → true, team_club_id → el club, etc.
--
-- Lo único que las protegía era que los uuid no se adivinan. Eso es opacidad, no
-- autorización.
--
-- ── EL PATRÓN CORRECTO, ESCRITO UNA VEZ ─────────────────────────────────────
--
-- Para una función nueva que NO deba ser pública:
--
--     revoke all on function public.f(args) from public;
--     revoke all on function public.f(args) from anon;          -- ← LA QUE FALTABA
--     revoke all on function public.f(args) from authenticated; -- si tampoco debe
--     grant execute on function public.f(args) to authenticated; -- a quien sí
--     grant execute on function public.f(args) to service_role;
--
-- La línea de `anon` es la que no estaba. Nombrar el rol es obligatorio: `public` es
-- otra entrada de la ACL y quitarla no toca las concesiones directas.
--
-- ── POR QUÉ NO SE TOCA `authenticated` ──────────────────────────────────────
--
-- Porque las policies se evalúan CON EL ROL QUE CONSULTA, y una policy que llama a
-- `team_club_id(...)` necesita que ese rol tenga EXECUTE. Las 226 policies del
-- esquema están acotadas a `authenticated`, y doce de ellas usan funciones de esta
-- lista. Quitarle el EXECUTE a `authenticated` rompería la lectura de esas tablas.
-- Comprobado: no hay ni una función usada en una policy de `authenticated` a la que
-- `authenticated` no tenga EXECUTE hoy.
--
-- ── DEPENDENCIAS: POR QUÉ ESTO NO ROMPE NADA ────────────────────────────────
--
-- Medido, no supuesto:
--   · 12 policies usan estas funciones. TODAS con roles={authenticated}. anon no
--     evalúa ninguna policy del esquema: cero la alcanzan.
--   · NINGUNA función `SECURITY INVOKER` ejecutable por anon llama a estas. Las
--     llamadas internas salen de funciones `SECURITY DEFINER`, donde el privilegio
--     se comprueba contra la DUEÑA (postgres), no contra quien llamó.
--   · Ningún DEFAULT de columna ni CHECK las invoca.
--   · De las 138 invocables por anon, 66 no las llama el código en ningún sitio, y
--     las dos únicas con llamada desde una página pública son las dos de F14J.
--
-- Y si algo se hubiera escapado, falla RUIDOSO: `permission denied for function`.
-- No hay degradación silenciosa.

-- ── 1 · La lista blanca ─────────────────────────────────────────────────────
--
-- Solo estas dos siguen abiertas a anon. Son de F14J y son intencionadas: el
-- selector de club y la página pública del club funcionan ANTES de identificarse.

-- ── 2 · Cerrar todo lo demás ────────────────────────────────────────────────
--
-- Se hace en bloque y no función a función: escribir 203 revokes a mano es una lista
-- que se queda corta el día que alguien añada la 204. El bloque describe la REGLA
-- —«todo menos estas dos»—, que es lo que de verdad queremos fijar.

-- HAY QUE QUITAR LAS DOS VÍAS, y esto es lo que hace que el patrón sea el que es.
-- `anon` llega al EXECUTE por dos caminos independientes de la ACL:
--
--     =X/postgres        ← PUBLIC. `CREATE FUNCTION` se lo concede por defecto.
--     anon=X/postgres    ← la concesión directa del default privilege de Supabase.
--
-- Quitar solo una deja la otra en pie. El `revoke ... from public` de siempre fallaba
-- por eso, y un `revoke ... from anon` a secas habría fallado igual, por el otro lado.
-- Lo comprobé escribiendo esta migración: con solo el revoke a anon, el test seguía
-- encontrando 150 funciones abiertas.
--
-- `authenticated` y `service_role` NO se ven afectados por el revoke a PUBLIC porque
-- tienen concesión PROPIA (`authenticated=X/postgres`), que es otra entrada distinta.
--
-- Solo las que posee `postgres`: un revoke sobre una función ajena no da error, se
-- limita a no hacer nada (ver el bloque de `unaccent` más abajo).

do $$
declare
  r record;
  v_cerradas integer := 0;
begin
  for r in
    select p.oid::regprocedure::text as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proname not in ('list_public_clubs', 'get_public_club_by_slug')
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke all on function %s from public', r.firma);
    execute format('revoke all on function %s from anon', r.firma);
    v_cerradas := v_cerradas + 1;
  end loop;

  raise notice 'EXECUTE de anon retirado en % funciones', v_cerradas;
end $$;

-- ── 2b · Lo que NO podemos cerrar, y por qué da igual ───────────────────────
--
-- `unaccent`, `unaccent_init` y `unaccent_lexize` las posee `supabase_admin` (vienen
-- de la extensión), así que `postgres` no puede revocarles nada: el revoke no falla,
-- simplemente no hace efecto. Quedan ejecutables por anon.
--
-- No es un agujero: son funciones de texto puras, sin acceso a ninguna tabla. Lo que
-- importa es que el test las nombre, para que una función ajena NUEVA no se cuele
-- escondida detrás de «bueno, esas son de la extensión».

-- Y las dos de F14J, explícitas: que se vea en el esquema que están abiertas a
-- propósito y no por herencia del default.
grant execute on function public.list_public_clubs() to anon;
grant execute on function public.get_public_club_by_slug(text) to anon;

comment on function public.list_public_clubs() is
  'PÚBLICA A PROPÓSITO (F14J): el selector de club corre ANTES de identificarse. Es una de las DOS funciones de public ejecutables por anon; la lista la fija el test anon_execute_cerrado.';
comment on function public.get_public_club_by_slug(text) is
  'PÚBLICA A PROPÓSITO (F14J): la página del club corre ANTES de identificarse. Es una de las DOS funciones de public ejecutables por anon; la lista la fija el test anon_execute_cerrado.';

-- ── 3 · Que las nuevas no nazcan abiertas ───────────────────────────────────
--
-- ESTO es lo que impide que el problema vuelva dentro de seis meses. Sin ello, el
-- bloque de arriba limpia el pasado y la siguiente migración abre un agujero nuevo
-- sin que nadie escriba una línea.
--
-- SOLO PARA `postgres`, Y NO ES UN OLVIDO. En `pg_default_acl` hay DOS entradas que
-- conceden `anon=X`: una por `postgres` y otra por `supabase_admin`. La segunda NO se
-- puede cambiar desde aquí —lo intenté y contesta `42501: permission denied to change
-- default privileges`: el rol que aplica migraciones es `postgres` y no es superusuario.
--
-- No hace falta, y conviene saber por qué: esa entrada solo gobierna lo que crea
-- `supabase_admin`, que es la propia plataforma (extensiones y objetos internos). Las
-- funciones de este proyecto las crea `postgres`, porque es el rol con el que conecta
-- `supabase db push`. Verificado: `current_user` = postgres en el camino de escritura.
--
-- Lo que queda descubierto —una función que Supabase cree en `public` por su cuenta—
-- lo caza el bloque [1] del test, que exige que la lista sea EXACTAMENTE esas dos.

-- LAS DOS VÍAS OTRA VEZ, y con una trampa que NO es evidente y que descubrí midiendo:
--
--   · La concesión a `anon` es del default de SUPABASE, y vive en el esquema. Se quita
--     con `IN SCHEMA public`.
--   · La concesión a `PUBLIC` es el default de POSTGRESQL, y es GLOBAL, no de esquema.
--     `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ... FROM PUBLIC` se acepta sin
--     rechistar y NO SIRVE: la función nueva sigue naciendo con `=X`. Hay que decirlo
--     SIN `IN SCHEMA`.
--
-- Medido, creando funciones de verdad y mirando su ACL:
--     IN SCHEMA public ... FROM public  → acl `=X/postgres | ...`   → anon puede
--     (global)          ... FROM public → acl `postgres=X | ...`    → anon NO puede
--
-- El bloque [3] del test lo comprueba creando una función y mirando quién la ejecuta.
-- La forma global alcanza a las funciones que `postgres` cree en CUALQUIER esquema,
-- no solo en `public`. Es más ancho de lo que pide el encargo y se asume a propósito:
-- este proyecto no crea funciones fuera de `public`, y el default de PostgreSQL —
-- «toda función nace ejecutable por todo el mundo»— no nos sirve en ningún esquema.

alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
