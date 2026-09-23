-- MURO M-1 · el predicado del muro de pago, SIN ENCHUFAR.
--
-- Esta migracion NO cierra nada. Pone la pieza y su interruptor, y los deja apagados.
-- Quien lo comprueba es el propio pgTAP: el bloque [12] falla si alguna politica la usa
-- ya. Enchufarla en las politicas es M-3.
--
-- POR QUE HACE FALTA. Medido contra produccion el 2026-09-23 con una cuenta de familia
-- real puesta como `authenticated`: ve 1.055 filas en 32 objetos —alineaciones,
-- convocatorias, titularidades, eventos de partido, calendario, mensajes, informes—.
-- El muro de SU-4/SU-5 es de PANTALLA, y ademas se envia apagado, asi que hoy nada lo
-- impide si se pregunta a la base directamente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DONDE NO VA EL CANDADO, y esto es lo que decide el diseno.
--
-- Casi todas las politicas de producto pasan por `user_role_in_club(club_id)`. La
-- tentacion es meter el candado ahi: una funcion y todo cerrado. Medido su alcance: 52
-- politicas, 33 tablas, 30 funciones. Y entre esas tablas estan `clubs`, `memberships`,
-- `players`, `player_accounts` e `invitations` — justo lo que la pantalla del muro
-- necesita para saber quien eres y que hijos tienes.
--
-- Un candado ahi CIERRA TAMBIEN LA SALIDA: la persona no podria ver el muro, ni borrar
-- su cuenta, ni llegar a pagar. Por eso va politica a politica en M-3, y por eso esta
-- migracion NO toca `user_role_in_club`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El interruptor.
--
--    En tabla y no en migracion: apagar el muro tiene que ser un UPDATE de un segundo,
--    no una migracion de vuelta. Es la unica marcha atras que sirve si resulta que deja
--    fuera a quien paga.
--
--    TABLA NUEVA, y no una columna de `club_settings`: esa la escriben `admin_club` y
--    `director` del propio club (policy `club_settings_write`). El interruptor ahi seria
--    un admin apagandose su propio muro y regalando el producto a su club entero.
--
--    SIN POLICIES a proposito: no la lee ni la escribe nadie desde el cliente. La ve
--    `has_paid_access()`, que es DEFINER y no pasa por RLS, y service_role, que tampoco.
--
--    GLOBAL y no por club. Lo de escalonar club a club se descarto al medir: muchas de
--    las tablas de producto no llevan `club_id` a mano y resolverlo obligaria a meter un
--    join en 23 politicas. Esa complejidad, en la pieza que puede dejar fuera a quien
--    paga, no compensa con dos clubes en produccion.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.subscription_wall (
  -- Singleton impuesto por el motor: `check (id)` solo admite `true`, y la PK solo
  -- admite una. Dos filas contradictorias no son un estado posible.
  id         boolean primary key default true check (id),
  enabled    boolean not null default false,
  enabled_at timestamptz,
  -- Para que quien lo encienda deje dicho por que, y quede en la fila.
  note       text,
  updated_at timestamptz not null default now()
);

alter table public.subscription_wall enable row level security;

-- Los privilegios por defecto de Supabase conceden a `anon` y `authenticated` POR
-- NOMBRE sobre las tablas nuevas de `public`. Un REVOKE de PUBLIC no basta.
revoke all on public.subscription_wall from public;
revoke all on public.subscription_wall from anon, authenticated;

comment on table public.subscription_wall is
  'MURO M-1 — interruptor del muro de pago en la base. Singleton. Sin fila o con enabled=false el muro NO existe: has_paid_access() deja pasar a todo el mundo. Sin policies: no se toca desde el cliente.';

-- La fila nace APAGADA. Se escribe aqui y no se deja ausente para que el estado sea
-- explicito y consultable, en vez de deducirse de una ausencia.
insert into public.subscription_wall (id, enabled, note)
values (true, false, 'M-1: nace apagado. Se enciende cuando esten las tiendas y el espejo de M-2 salga limpio.');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. has_paid_access — el predicado.
--
--    Sin argumentos: la suscripcion es por CUENTA y no por club (ADR-0022, decision 4),
--    y el interruptor es global. Asi se puede enchufar en cualquier politica sin
--    arrastrar el club hasta ella.
--
--    SECURITY DEFINER porque mira `subscription_entitlements` y llama a
--    `requires_subscription`, que esta cerrada a `authenticated` a proposito. Un INVOKER
--    veria solo un trozo y diria que no paga quien si paga.
--
--    Y SI se concede a `authenticated`: una funcion usada dentro de una policy la
--    ejecuta el rol que consulta. `user_role_in_club` la lleva por lo mismo. Sin este
--    grant, las politicas de M-3 fallarian con 42501 para todo el mundo.
--
--    ORDEN DE LAS RAMAS, que es donde estaria el fallo caro:
--      1) el interruptor primero, para que apagado no se mire nada mas;
--      2) sin sesion, no;
--      3) staff gratis — y GANA sobre el vinculo familiar, igual que en
--         `requires_subscription` (un entrenador que ademas es padre no paga);
--      4) el resto necesita acceso vivo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.has_paid_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- 1 · Interruptor. Sin fila tambien deja pasar: el modo de fallo benigno es el que
    --     NO deja fuera a quien paga.
    when not exists (
      select 1 from public.subscription_wall w where w.id and w.enabled
    ) then true

    -- 2 · Sin sesion no se pasa.
    when (select auth.uid()) is null then false

    -- 3 · Staff, coordinacion, direccion y superadmin: gratis.
    when not public.requires_subscription((select auth.uid())) then true

    -- 4 · Los demas —tutores y seguidores, que pagan igual (ADR-0022, decision 3)—
    --     necesitan acceso vivo. `access_until` es GENERADA como
    --     greatest(expires_at, grace_period_expires_at): la GRACIA DA ACCESO, y tiene
    --     que darlo tambien aqui o la app ensenaria una cosa y la base haria otra.
    else exists (
      select 1 from public.subscription_entitlements se
       where se.profile_id = (select auth.uid())
         and se.unlinked_at is null
         and se.access_until > now()
    )
  end;
$$;

revoke all on function public.has_paid_access() from public;
revoke all on function public.has_paid_access() from anon;
grant execute on function public.has_paid_access() to authenticated;
grant execute on function public.has_paid_access() to service_role;

comment on function public.has_paid_access() is
  'MURO M-1 — true si esta cuenta puede ver el producto. Con el interruptor apagado devuelve true SIEMPRE. Coincide con my_subscription_status().has_access cuando esta encendido: si divergen, la app ensena una cosa y la base hace otra. Concedida a authenticated porque se usa DENTRO de policies.';
