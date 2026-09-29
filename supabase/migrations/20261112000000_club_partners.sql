-- ════════════════════════════════════════════════════════════════════════════
-- V-1 · PATROCINADORES Y COLABORADORES DEL CLUB (`club_partners`).
--
-- Una sola tabla con un campo que dice cuál es. La diferencia entre un patrocinador
-- y un colaborador es quién paga a quién, no qué datos tiene: los dos son un logo,
-- una línea de texto y un enlace a su web. Dos tablas gemelas —que es lo que hay en
-- VERTEX, donde la segunda se declara literalmente «clon de patrocinadores»— serían
-- el doble de policies, el doble de pgTAP y el doble de sitios donde olvidarse de
-- algo, para distinguir un `kind`.
--
-- DECISIONES DE PRODUCTO (Jose, esta serie), y cada una se ve en el SQL:
--   · el socio es DEL CLUB: `club_id not null` y todo el gate por `club_id`;
--   · lo gestionan admin_club y director;
--   · lo ven los miembros del club, DENTRO de la app. Nada público;
--   · va DETRÁS DEL MURO, como el resto del producto.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE ───────────────────────────────────────────
-- Ni una línea de app. No hay pantallas, ni tipos en `database.ts`, ni lectura. Es
-- la convención de esta casa y tiene precedente inmediato: la 20261109000000 viajó
-- sola con su pgTAP (#723), se aplicó, y los tipos y el código llegaron detrás
-- (#724). Aquí igual.
--
-- ── POR QUÉ NO HAY SECCIÓN DE GRANTS ────────────────────────────────────────
-- Medido, y es lo contrario de lo que haría falta en VERTEX (allí cada tabla lleva
-- sus grants explícitos, «patrón CI3/CI4»). Desde la 20261078000000 los DEFAULT
-- PRIVILEGES de este esquema están arreglados: una tabla nueva creada por `postgres`
-- en `public` nace SIN nada para `anon` y sin TRUNCATE para `authenticated`, y
-- conserva el SELECT/INSERT/UPDATE/DELETE que la RLS filtra fila a fila. Escribir
-- grants a mano aquí sería repetir lo que ya está resuelto, y un `grant` de más es
-- justo lo que el test `acl_tablas_cerradas` existe para cazar.
--
-- ── EL GATE NO SE INVENTA ───────────────────────────────────────────────────
-- `user_is_admin_or_director(club_id)` ya existe y ya está probada: es la que usa
-- `club_settings_write` desde la paridad del director (20260823000000) y la que la
-- 20261026000000 endureció contra el NULL. Y por el chokepoint de la 20260921000000,
-- `user_role_in_club` devuelve 'admin_club' para un superadmin en CUALQUIER club, así
-- que el superadmin gestiona socios sin una rama propia.
--
-- OJO, y queda escrito porque afecta a la lectura: `user_role_in_club` NO filtra
-- `left_at`, así que quien causó baja en el club sigue contando como miembro para
-- este gate. No se corrige aquí —es una propiedad de la función que gobierna decenas
-- de policies, incluida la de los anuncios de club— pero conviene saber que «solo
-- miembros» significa exactamente lo mismo que significa hoy para un anuncio.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La tabla.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.club_partners (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade` como el resto de lo que cuelga de un club
  -- (staff_conversations, notas de evaluación): si el club se va, sus socios no
  -- tienen dónde vivir.
  club_id uuid not null references public.clubs(id) on delete cascade,

  -- text + CHECK y no un enum: un enum nuevo es un objeto de esquema que hay que
  -- ampliar con ALTER TYPE (y en una transacción de migración eso tiene sus reglas),
  -- mientras que el dominio aquí son dos valores que se leen de un vistazo. Los
  -- valores van en castellano porque así están los roles de esta base
  -- ('admin_club', 'entrenador_principal'): el idioma del dominio no se mezcla.
  kind text not null check (kind in ('patrocinador', 'colaborador')),

  -- El nombre SÍ se pinta (a diferencia de VERTEX, donde en colaboradores es solo
  -- etiqueta interna): aquí los dos tipos llevan los mismos datos.
  name text not null check (char_length(btrim(name)) between 1 and 120),

  -- La línea de texto. Opcional: hay socios que solo quieren su logo.
  tagline text check (tagline is null or char_length(btrim(tagline)) between 1 and 160),

  -- PATH del objeto en el bucket, NO una URL. Es la convención de esta base
  -- (`clubs.logo_path`, `players.photo_url`, `profiles.avatar_url` guardan paths) y
  -- lo que impide que la fila quede atada a un dominio de Storage. Formato
  -- '{club_id}/{uuid}.{ext}', que es lo que la policy del bucket sabe leer.
  --
  -- NOT NULL a propósito: un socio sin logo no se puede pintar, y con la columna
  -- nullable cada una de las CUATRO superficies de inicio necesitaría una rama de
  -- marcador de posición para un estado que no queremos. El alta sube primero y
  -- escribe después. Contrapartida asumida: una subida cuya fila falle, o un logo
  -- reemplazado, dejan un objeto huérfano en el bucket — inofensivo (es el logo de
  -- una empresa, no un dato personal) y borrable por el mismo que lo subió.
  logo_path text not null check (
    char_length(logo_path) between 1 and 200
    and logo_path !~ '^https?://'
  ),

  -- El enlace a su web. El esquema exige http(s) explícito: sin esto cabría un
  -- `javascript:` o un `data:` en una columna que la app abre con `Linking.openURL`
  -- y pinta como enlace en la web.
  url text not null check (
    char_length(url) between 8 and 500
    and url ~* '^https?://'
  ),

  sort_order integer not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice parcial: la app solo pide los ACTIVOS de un club, ordenados. Los inactivos
-- no entran en el índice porque nadie los lista salvo el CRUD, que es de una persona
-- y de un club.
create index club_partners_club_active_sort_idx
  on public.club_partners (club_id, sort_order)
  where active;

-- `set_updated_at()` es el trigger reusable del esquema base (20260527110831).
create trigger club_partners_set_updated_at
  before update on public.club_partners
  for each row execute function public.set_updated_at();

comment on table public.club_partners is
  'V-1 — patrocinadores y colaboradores de un club. UNA tabla con `kind`: los datos son '
  'los mismos (logo, una línea, enlace) y lo que cambia es quién paga. Lectura: miembros '
  'del club Y detrás del muro de pago. Escritura: admin_club y director (superadmin por el '
  'chokepoint). Logos en el bucket PRIVADO club-partner-logos, servidos con URL firmada.';

comment on column public.club_partners.kind is
  'patrocinador | colaborador. Solo cambia el rótulo bajo el que se agrupa en la pantalla; '
  'los datos y los permisos son idénticos.';
comment on column public.club_partners.logo_path is
  'PATH en el bucket privado club-partner-logos, formato {club_id}/{uuid}.{ext} — NUNCA una '
  'URL (CHECK). La URL se firma al pintar, como las fotos de jugador.';
comment on column public.club_partners.active is
  'false = no se pinta en ningún inicio, pero la fila se conserva (un patrocinador vuelve la '
  'temporada siguiente). El filtro vive en la POLICY de lectura, no solo en la consulta: se '
  'pinta en cuatro superficies y un filtro olvidado en una de ellas no puede enseñar un socio '
  'retirado. Quien gestiona los ve todos por su policy de escritura.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS.
--
--    LECTURA = cualquier miembro del club, igual que un anuncio de club
--    (`announcements_select_club_member`, rama `team_id is null`). No se estrecha a
--    tutores ni se ensancha a `anon`: un socio es información del club para el club.
--
--    Y `and active`, que es una decisión y no un adorno: esto se pinta en CUATRO
--    superficies (familia —que cubre jugador—, staff, dirección y seguidor). Con el
--    filtro solo en la consulta, un `.eq('active', true)` olvidado en una de las
--    cuatro enseña un socio retirado, y nadie se entera. Con el filtro aquí, eso es
--    imposible: la fila no sale. El que gestiona SÍ los ve todos, porque su policy de
--    escritura es permisiva y se suma a esta para el SELECT — la misma forma que
--    resuelve VERTEX con `active = true or is_admin()`.
--
--    ESCRITURA = admin_club y director, con la misma función y la misma forma que
--    `club_settings_write`.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.club_partners enable row level security;

create policy club_partners_select_club_member
  on public.club_partners
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) is not null
    and active
  );

create policy club_partners_write_admin_or_director
  on public.club_partners
  for all
  to authenticated
  using (public.user_is_admin_or_director(club_id))
  with check (public.user_is_admin_or_director(club_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EL MURO. La tabla 19.
--
--    Decisión de producto: detrás del muro como todo lo demás. La forma es la de
--    M-3 (20261106000000) letra por letra: una policy RESTRICTIVE de SELECT, que se
--    suma a las permisivas en vez de sustituirlas, y solo para `authenticated`.
--
--    Con el interruptor apagado `has_paid_access()` devuelve true SIEMPRE, así que
--    esta línea no cambia nada hasta que el muro esté encendido — y hoy lo está.
--
--    Va solo en SELECT: al admin que escribe no se le pide estar al día para
--    gestionar (y de hecho no se le pediría nunca, porque el staff pasa gratis por
--    `requires_subscription`).
--
--    El candado está en la TABLA, no en el bucket: quien no paga no lee la fila, así
--    que no tiene `logo_path` que firmar. La policy del bucket se queda en «miembro
--    del club» a propósito, para no meter el muro en `storage.objects`, que es el
--    sitio donde una policy de más deja sin fotos a medio club.
--
--    OJO al actualizar: el test `muro_m3_politicas.sql` afirma la lista EXACTA de
--    tablas con candado. Esta migración la sube de 18 a 19 y ese test se actualiza en
--    el mismo PR; si no, falla con «estas tablas llevan candado y NO debían».
-- ─────────────────────────────────────────────────────────────────────────────
create policy muro_pago_select on public.club_partners
  as restrictive for select to authenticated using (public.has_paid_access());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El bucket de los logos.
--
--    PRIVADO, y esto es una decisión, no un descuido. Había dos patrones en casa:
--      · `club-logos` es PÚBLICO, pero por un motivo concreto que aquí no aplica —el
--        login por club (`/{slug}`) tiene que pintar el escudo SIN sesión;
--      · `player-photos` es PRIVADO y se sirve con `createSignedUrl` (8 sitios ya lo
--        hacen, incluida la versión en lote `createSignedUrls` para listas).
--    Con «nada público» sobre la mesa, el segundo es el que cumple: un bucket público
--    deja el objeto legible por cualquiera que tenga la URL. Cuesta firmar la URL en
--    las cuatro superficies, que es un patrón que esta app ya repite.
--
--    El gate es por CARPETA = club_id, como en club-logos y player-photos. La
--    escritura NO necesita la RPC con trigger que `club-logos` sí necesitó: allí hacía
--    falta porque `clubs_update_admin` deja escribir también al director y se quería
--    restringir a admin. Aquí admin y director son LOS DOS gestores, así que la policy
--    del bucket es el gate y no hay chokepoint que construir.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('club-partner-logos', 'club-partner-logos', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "club_partner_logos_select_member" on storage.objects;
create policy "club_partner_logos_select_member"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'club-partner-logos'
    and public.user_role_in_club(((storage.foldername(name))[1])::uuid) is not null
  );

drop policy if exists "club_partner_logos_insert_admin_or_director" on storage.objects;
create policy "club_partner_logos_insert_admin_or_director"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'club-partner-logos'
    and public.user_is_admin_or_director(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "club_partner_logos_update_admin_or_director" on storage.objects;
create policy "club_partner_logos_update_admin_or_director"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'club-partner-logos'
    and public.user_is_admin_or_director(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'club-partner-logos'
    and public.user_is_admin_or_director(((storage.foldername(name))[1])::uuid)
  );

-- DELETE: el mismo gate. Un logo reemplazado o un socio borrado lo limpia quien lo
-- gestiona. (No hay trigger de limpieza: el borrado de objetos de Storage por SQL
-- está prohibido en todos los proyectos de esta casa — trigger POR SENTENCIA.)
drop policy if exists "club_partner_logos_delete_admin_or_director" on storage.objects;
create policy "club_partner_logos_delete_admin_or_director"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'club-partner-logos'
    and public.user_is_admin_or_director(((storage.foldername(name))[1])::uuid)
  );
