-- ════════════════════════════════════════════════════════════════════════════
-- MURO E-1 · LA CONCESIÓN MANUAL. Acceso dado a mano, con fecha de caducidad.
--
-- ── PARA QUÉ ────────────────────────────────────────────────────────────────
-- El muro tiene que encenderse ANTES de enviar a las tiendas: Apple revisa el paywall,
-- y un revisor que entra y ve la app entera sin pagar la rechaza. Pero medido hoy con el
-- espejo de M-2, encender el interruptor deja fuera a las 8 cuentas de familia de
-- producción: las 8 en estado `none`, ninguna con fila en `subscription_entitlements`, y
-- no por no pagar sino porque no hay tienda viva donde pagar.
--
-- Hoy no existe forma de darles acceso. `subscription_access_state` tiene seis estados
-- —`no_session`, `staff_free`, `none`, `unlinked`, `expired`, `grace`/`active`— y ninguno
-- significa «concedido».
--
-- ── POR QUÉ NO A MANO EN `subscription_entitlements` ────────────────────────
-- Es la vía tentadora y tiene tres consecuencias medidas:
--   · esa tabla dice de sí misma que NO es la verdad —la verdad es RevenueCat— y que se
--     escribe SOLO vía `apply_subscription_event()`;
--   · el barrido nocturno de SU-6b recogería esas filas como `priority='never'`
--     (`reconciled_at` nulo) y preguntaría por ellas a RevenueCat. Y
--     `GET /subscribers/{id}` devuelve 201 y CREA el cliente si no existe: el cron
--     crearía 8 clientes fantasma;
--   · cada pasada registraría `reconcile_no_entitlement`. Ocho falsas alarmas por noche
--     es como se entrena a la gente para ignorar la de verdad.
-- Lo único bueno de esa vía es que el barrido NO revoca cuando RevenueCat no tiene nada.
-- No compensa.
--
-- Darles un rol de staff tampoco: `requires_subscription` los dejaría gratis, pero eso no
-- regala acceso, regala PERMISOS.
--
-- ── LA FORMA, copiada de `subscription_test_profiles` (SU-8) ─────────────────
-- Ese problema ya se resolvió una vez con la doctrina correcta y esto es su gemela:
-- tabla propia, `motivo` obligatorio, `valid_until` obligatorio y sin default, sin
-- policies, y la comprobación es `> now()` para que CADUQUE SOLA. Una concesión olvidada
-- puesta es producto regalado para siempre; una que caduca se cierra sin que nadie tenga
-- que acordarse.
--
-- ── LA DECISIÓN QUE MÁS IMPORTA, Y ES CONTRAINTUITIVA ───────────────────────
-- El estado nuevo `granted` entra en el espejo, que es del servidor, y NO en lo que lee
-- la app. `my_subscription_status()` devuelve la concesión como `active`.
--
-- No es pereza. `reads.ts` (SU-2) hace esto, a propósito y escrito:
--
--     hasAccess: state === 'none' && row.state !== 'none' ? false : row.has_access
--
-- Un estado que el cliente no conoce se convierte en `none` y FUERZA `hasAccess=false`:
-- «un estado que no conocemos NO puede abrir la puerta». Con un nombre nuevo, el build
-- que hoy está en la tienda enseñaría el muro precisamente a las familias concedidas — y
-- `EXPO_PUBLIC_SUBSCRIPTION_GATE` se incrusta al construir y este proyecto NO tiene
-- `expo-updates`: no habría forma de arreglarlo sin pasar otra vez por Apple.
--
-- Esta tabla existe para ser la ÚNICA palanca remota que quede cuando el build ya esté
-- enviado. Una palanca que necesita el build correcto no es una palanca. Así que la app
-- ve `active` —que es verdad: tiene acceso, y hasta la fecha que se le dice— y el porqué
-- vive en el espejo y en `motivo`, que es donde lo lee quien opera.
--
-- Consecuencia asumida: `subscription_access_state` y `my_subscription_status` dejan de
-- llamar igual al mismo caso. Lo que NO puede divergir es el ACCESO, y eso lo sigue
-- atando el bloque [9] del pgTAP de M-1 (`has_paid_access()` = `has_access`), que compara
-- booleanos. El bloque [3] de este fichero lo comprueba para un perfil concedido.
--
-- ── QUÉ NO HACE ─────────────────────────────────────────────────────────────
-- No gana a los candados de ADR-0022: una cuenta desenganchada por borrado (`unlinked_at`)
-- sigue sin acceso aunque tenga concesión vigente, y el orden de las ramas es lo que lo
-- garantiza. Y no toca ni una fila de producción: la tabla nace VACÍA, así que hasta que
-- el operador meta a alguien, las tres funciones se comportan como hoy.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. subscription_grants — la lista.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.subscription_grants (
  -- FK NO ACTION, como todo lo que apunta a `profiles` (ADR-0021): las filas de perfil
  -- no se borran nunca, se anonimizan.
  profile_id   uuid primary key references public.profiles(id),
  -- Obligatorio, igual que en SU-8: una lista de UUID sin motivo es una lista que nadie
  -- se atreve a limpiar. Aquí se escribe para qué («E-1: sin tiendas vivas donde pagar»).
  motivo       text not null check (length(btrim(motivo)) > 0),
  -- Sin default, y es lo que impide que esto se convierta en producto gratis: el
  -- operador tiene que decir hasta cuándo.
  valid_until  timestamptz not null,
  created_at   timestamptz not null default now()
);

comment on table public.subscription_grants is
  'MURO E-1 — acceso CONCEDIDO a mano, con caducidad. Para encender el muro sin dejar fuera a quien no tiene tienda donde pagar. Nace VACÍA. La concesión caduca por `valid_until` (> now()), no hay que acordarse de quitarla. Se borra con un DELETE.';
comment on column public.subscription_grants.valid_until is
  'Fin de la concesión. La comprobación es `> now()`: una concesión caducada NO da acceso. Es lo que evita que una lista olvidada regale el producto para siempre.';

-- La lista de concesiones no es dato de usuario. `revoke` explícito a `anon` y
-- `authenticated` porque las default privileges de Supabase otorgan POR NOMBRE en cada
-- tabla nueva del esquema public — un revoke a PUBLIC no basta.
alter table public.subscription_grants enable row level security;
revoke all on table public.subscription_grants from public;
revoke all on table public.subscription_grants from anon, authenticated;

-- Sin políticas, como `subscription_wall` y `subscription_test_profiles`: con RLS activada
-- y ninguna policy, nadie que pase por PostgREST la lee ni la escribe. Solo el dueño (las
-- funciones SECURITY DEFINER) y el service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscription_access_state — el PORQUÉ, con la concesión dentro.
--
--    Va `create or replace` sobre su definición VIVA de producción
--    (`pg_get_functiondef`, contrastada contra la 20261105000000: idéntica salvo espacios
--    y la etiqueta del dollar-quote). Nadie la había parcheado en caliente.
--
--    EL ORDEN ES TODO EL DISEÑO:
--
--     1) `unlinked` va ANTES de la concesión. Una cuenta desenganchada por borrado no se
--        reabre por nada (ADR-0022 §4), y una concesión no es un «nada» distinto.
--     2) El entitlement REAL va antes de la concesión. Quien paga sale `active`/`grace`,
--        no `granted`: la concesión es un RESPALDO, no un atajo que tape la verdad.
--     3) La concesión va antes de `none`/`expired`, que son los dos estados que niegan.
--
--    La cola se reordena (`not found` ya no es lo primero que se mira tras `unlinked`),
--    y con la tabla VACÍA el resultado es el mismo en los seis casos — lo mide el bloque
--    [1] del pgTAP, caso por caso, antes de conceder nada.
--
--    `found` se guarda en una variable: entre el `select into` del entitlement y el final
--    hay otras consultas, y `found` habla siempre de la ÚLTIMA. Ese es el error que
--    habría convertido «no tiene fila» en «tiene fila caducada».
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscription_access_state(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ent        public.subscription_entitlements%rowtype;
  v_tiene_fila boolean;
begin
  if p_profile_id is null then
    return 'no_session';
  end if;

  -- Staff, coordinacion, direccion y superadmin. GANA sobre el vinculo familiar: un
  -- entrenador que ademas es padre no paga. Y gana también sobre la concesión: a quien no
  -- le hace falta, no se le concede nada.
  if not public.requires_subscription(p_profile_id) then
    return 'staff_free';
  end if;

  select * into v_ent from public.subscription_entitlements where profile_id = p_profile_id;
  v_tiene_fila := found;

  -- El desenganche del borrado de cuenta manda sobre todo lo demás, concesión incluida.
  if v_tiene_fila and v_ent.unlinked_at is not null then
    return 'unlinked';
  end if;

  -- La suscripción de verdad, si da acceso. `access_until` es GENERADA como
  -- greatest(expires_at, grace_period_expires_at): la gracia DA acceso (decision de Jose,
  -- revision de ADR-0022 del 2026-09-11).
  if v_tiene_fila and v_ent.access_until is not null and v_ent.access_until > now() then
    return case when v_ent.billing_issue_detected_at is not null then 'grace' else 'active' end;
  end if;

  -- E-1 · LA CONCESIÓN. Solo si la suscripción no da acceso, y solo vigente: la
  -- comprobación es `> now()` para que una concesión olvidada se cierre sola.
  if exists (
    select 1 from public.subscription_grants g
     where g.profile_id = p_profile_id
       and g.valid_until > now()
  ) then
    return 'granted';
  end if;

  if not v_tiene_fila then
    return 'none';
  end if;

  return 'expired';
end;
$function$;

comment on function public.subscription_access_state(uuid) is
  'MURO M-2/E-1 — el estado de acceso de UN perfil. Siete estados: los seis de siempre más `granted` (concesión manual de E-1, que es RESPALDO: quien paga sale active/grace). `unlinked` gana a la concesión. OJO: `my_subscription_status` presenta la concesión como `active`, a propósito — ver la cabecera de la 20261110000000. Cerrada a authenticated.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. subscription_grants_access — el VEREDICTO. La lista de estados que dan acceso
--    sigue viviendo SOLO aquí, y ahora tiene cuatro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscription_grants_access(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.subscription_access_state(p_profile_id)
         in ('staff_free', 'active', 'grace', 'granted');
$function$;

comment on function public.subscription_grants_access(uuid) is
  'MURO M-2/E-1 — veredicto de UN perfil, derivado de subscription_access_state. La lista de estados que dan acceso vive SOLO aqui: staff_free, active, grace y granted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. my_subscription_status — lo que lee la APP. La concesión se presenta como `active`.
--
--    ESTO ES LO CONTRAINTUITIVO DE LA MIGRACIÓN, y la razón está medida en `reads.ts`:
--
--        hasAccess: state === 'none' && row.state !== 'none' ? false : row.has_access
--
--    El cliente convierte un estado que no conoce en `none` y FUERZA `hasAccess=false`.
--    Está escrito a propósito —«un estado que no conocemos NO puede abrir la puerta»— y
--    contempla exactamente este caso: «pasaría si el SQL añadiera un estado y el cliente
--    fuera viejo».
--
--    Así que devolver `granted` aquí pondría el muro justo a las familias concedidas en
--    todo build ya publicado. Y `EXPO_PUBLIC_SUBSCRIPTION_GATE` se incrusta al construir,
--    y este proyecto NO tiene `expo-updates`: no se arregla sin volver a pasar por Apple.
--
--    La concesión existe para ser la ÚNICA palanca remota cuando el build ya está
--    enviado. Una palanca que necesita el build correcto no es una palanca. Se devuelve
--    `active`, que además es verdad para quien lo lee: tiene acceso, y hasta la fecha que
--    se le dice. El PORQUÉ vive en `subscription_grants.motivo` y en el espejo.
--
--    Lo que NO puede divergir es el ACCESO. Eso lo ata el bloque [9] del pgTAP de M-1
--    (`has_paid_access()` = `my_subscription_status().has_access`) y, para un perfil
--    concedido, el bloque [3] del pgTAP de este fichero.
--
--    `billing_issue` sale `false`: una concesión no tiene impago, no tiene cobro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_subscription_status()
 RETURNS TABLE(requires_subscription boolean, has_access boolean, state text, access_until timestamp with time zone, billing_issue boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid        uuid := (select auth.uid());
  v_req        boolean;
  v_ent        public.subscription_entitlements%rowtype;
  v_tiene_fila boolean;
  v_concedida  timestamptz;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  v_req := public.requires_subscription(v_uid);

  if not v_req then
    return query select false, true, 'staff_free'::text, null::timestamptz, false;
    return;
  end if;

  select * into v_ent from public.subscription_entitlements where profile_id = v_uid;
  v_tiene_fila := found;

  if v_tiene_fila and v_ent.unlinked_at is not null then
    return query select true, false, 'unlinked'::text, null::timestamptz, false;
    return;
  end if;

  -- La suscripción de verdad, si da acceso. Mismo orden que subscription_access_state.
  if v_tiene_fila and v_ent.access_until is not null and v_ent.access_until > now() then
    return query select
      true,
      true,
      case when v_ent.billing_issue_detected_at is not null then 'grace' else 'active' end,
      v_ent.access_until,
      v_ent.billing_issue_detected_at is not null;
    return;
  end if;

  -- E-1 · la concesión, presentada como `active` por el motivo de arriba.
  select g.valid_until into v_concedida
    from public.subscription_grants g
   where g.profile_id = v_uid
     and g.valid_until > now();

  if v_concedida is not null then
    return query select true, true, 'active'::text, v_concedida, false;
    return;
  end if;

  if not v_tiene_fila then
    return query select true, false, 'none'::text, null::timestamptz, false;
    return;
  end if;

  return query select true, false, 'expired'::text, v_ent.access_until,
                      v_ent.billing_issue_detected_at is not null;
end;
$function$;

comment on function public.my_subscription_status() is
  'SU-1/E-1 — el estado de la PROPIA cuenta, lo que lee el gate de la app. Una concesión manual vigente (E-1) se devuelve como `active` con su fecha, y NO como un estado nuevo: el cliente trata un estado desconocido como `none` y niega el acceso (reads.ts), así que un nombre nuevo pondría el muro a quien tiene acceso concedido en todo build ya publicado. El porqué vive en subscription_grants.motivo y en subscription_wall_mirror().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. subscription_wall_mirror — que la fecha no mienta.
--
--    El espejo ya dice `granted` solo, porque su columna `state` sale de
--    `subscription_access_state` y el veredicto de `subscription_grants_access`. Lo que
--    NO diría es hasta cuándo: `access_until` venía solo del entitlement, y una familia
--    concedida sin compra lo tiene nulo. Quien opera vería «no se le niega» sin ver
--    cuándo se le cierra.
--
--    `greatest` y no `coalesce`, por lo mismo que la columna generada de
--    `subscription_entitlements`: con las dos fechas puestas manda la más lejana, y
--    `greatest` ignora los nulos. El `join` solo trae concesiones VIGENTES, así que la
--    columna sigue significando «hasta cuándo hay acceso» y no «hasta cuándo lo tuvo».
--
--    NO se añade columna, y no por gusto: `create or replace` NO puede cambiar el tipo de
--    retorno de una función, así que una columna nueva —el `motivo`, por ejemplo— exigiría
--    un DROP y recrear, perdiendo la ACL. El motivo se lee en su tabla.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.subscription_wall_mirror()
 RETURNS TABLE(profile_id uuid, full_name text, clubs text, roles text, state text, would_be_denied boolean, access_until timestamp with time zone, hijos integer, sigue integer, ultimo_evento_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    p.id,
    p.full_name,
    (select string_agg(distinct c.name, ', ' order by c.name)
       from public.memberships m join public.clubs c on c.id = m.club_id
      where m.profile_id = p.id and m.left_at is null),
    (select string_agg(distinct m.role::text, ', ' order by m.role::text)
       from public.memberships m where m.profile_id = p.id and m.left_at is null),
    public.subscription_access_state(p.id),
    -- El veredicto sale de la MISMA funcion que usa `has_paid_access`. Si el espejo
    -- reimplementara la regla, podria decir que no pasa nada y que pasara.
    not public.subscription_grants_access(p.id),
    -- E-1 · la fecha, venga de la compra o de la concesion vigente. `greatest` ignora
    -- los nulos, asi que con una sola de las dos puestas devuelve esa.
    greatest(se.access_until, g.valid_until),
    (select count(*)::integer from public.player_accounts   pa where pa.profile_id = p.id),
    (select count(*)::integer from public.player_spectators ps where ps.spectator_profile_id = p.id),
    -- Distingue "nunca tuvo suscripcion" de "la tuvo y caduco": son dos problemas
    -- distintos y en la lista se parecen.
    se.last_event_at
  from public.profiles p
  left join public.subscription_entitlements se on se.profile_id = p.id
  left join public.subscription_grants g
         on g.profile_id = p.id and g.valid_until > now()
  order by (not public.subscription_grants_access(p.id)) desc, p.full_name nulls last, p.id;
$function$;

comment on function public.subscription_wall_mirror() is
  'MURO M-2/E-1 — quien quedaria fuera si el interruptor se encendiera, y por que. IGNORA el interruptor a proposito: la pregunta es "que pasaria SI". `state` distingue `granted` (concesion manual), que es lo que la app NO ve. `access_until` es la fecha de acceso venga de la compra o de la concesion. Cerrada a authenticated.';
