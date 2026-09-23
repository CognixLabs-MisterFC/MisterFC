-- MURO M-2 · EL ESPEJO. Quien quedaria fuera si el interruptor se encendiera, y por que.
--
-- Sigue sin cerrarse nada. El interruptor sigue apagado y ninguna politica usa el
-- predicado (el pgTAP de M-1 lo comprueba y no se ha tocado).
--
-- POR QUE EXISTE. Medido al abrir la serie: de las 7 cuentas de produccion que
-- pagarian, NINGUNA tiene fila en `subscription_entitlements`. Encender el muro hoy deja
-- fuera a las 7 familias del club. El espejo es la lista que hay que mirar ANTES, y la
-- unica forma de que "deja fuera a quien paga" se vea antes de que pase y no despues.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL PROBLEMA DE DISENO, y como se resuelve.
--
-- El espejo tiene que contestar por OTRO perfil, y `has_paid_access()` contesta por
-- `auth.uid()`: no se le puede preguntar por un tercero. Copiar su cuerpo daria dos
-- implementaciones de la misma regla, y entonces el espejo podria decir una cosa y la
-- base hacer otra — que es exactamente el desastre que el espejo existe para evitar.
--
-- Asi que la regla BAJA a funciones por perfil y `has_paid_access()` pasa a ser una
-- entrada mas. Una implementacion, tres entradas:
--
--   subscription_access_state(perfil)   -> el PORQUE (los mismos seis estados que
--                                          ensena la app en `my_subscription_status`)
--   subscription_grants_access(perfil)  -> el VEREDICTO, derivado del estado
--   has_paid_access()                   -> interruptor + veredicto del que llama
--   subscription_wall_mirror()          -> estado y veredicto de TODOS
--
-- La prueba de que el reparto no cambio nada por fuera es que `muro_m1_predicado.sql`
-- pasa SIN TOCARLO, con sus 12 bloques y su careo contra `my_subscription_status`.
--
-- EL ESPEJO IGNORA EL INTERRUPTOR a proposito: su pregunta es "que pasaria SI", y con el
-- muro apagado la respuesta de `has_paid_access()` seria siempre `true` y no diria nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1 · El porque ────────────────────────────────────────────────────────────
--
-- Los MISMOS seis estados y el MISMO orden que `my_subscription_status()`, que es lo
-- que la persona ve en pantalla. El orden importa: `unlinked` va antes que la fecha
-- porque una cuenta desenganchada por borrado puede conservar una fecha viva, y lo que
-- manda es el desenganche.
create or replace function public.subscription_access_state(p_profile_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_ent public.subscription_entitlements%rowtype;
begin
  if p_profile_id is null then
    return 'no_session';
  end if;

  -- Staff, coordinacion, direccion y superadmin. GANA sobre el vinculo familiar: un
  -- entrenador que ademas es padre no paga.
  if not public.requires_subscription(p_profile_id) then
    return 'staff_free';
  end if;

  select * into v_ent from public.subscription_entitlements where profile_id = p_profile_id;

  if not found then
    return 'none';
  end if;

  if v_ent.unlinked_at is not null then
    return 'unlinked';
  end if;

  -- `access_until` es GENERADA como greatest(expires_at, grace_period_expires_at): la
  -- gracia DA acceso (decision de Jose, revision de ADR-0022 del 2026-09-11).
  if v_ent.access_until is null or v_ent.access_until <= now() then
    return 'expired';
  end if;

  return case when v_ent.billing_issue_detected_at is not null then 'grace' else 'active' end;
end;
$$;

revoke all on function public.subscription_access_state(uuid) from public;
revoke all on function public.subscription_access_state(uuid) from anon, authenticated;
grant execute on function public.subscription_access_state(uuid) to service_role;

comment on function public.subscription_access_state(uuid) is
  'MURO M-2 — el estado de acceso de UN perfil, con los mismos seis nombres y el mismo orden que my_subscription_status(). Cerrada a authenticated: nadie pregunta por el estado de un tercero.';

-- ── 2 · El veredicto ─────────────────────────────────────────────────────────
--
-- La lista de estados que dan acceso se escribe UNA VEZ, aqui. Si viviera tambien en el
-- espejo, el dia que cambie quedaria coja en uno de los dos.
create or replace function public.subscription_grants_access(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.subscription_access_state(p_profile_id) in ('staff_free', 'active', 'grace');
$$;

revoke all on function public.subscription_grants_access(uuid) from public;
revoke all on function public.subscription_grants_access(uuid) from anon, authenticated;
grant execute on function public.subscription_grants_access(uuid) to service_role;

comment on function public.subscription_grants_access(uuid) is
  'MURO M-2 — veredicto de UN perfil, derivado de subscription_access_state. La lista de estados que dan acceso vive SOLO aqui.';

-- ── 3 · `has_paid_access`, ahora una entrada mas ─────────────────────────────
--
-- Mismo comportamiento externo que en M-1; lo comprueba `muro_m1_predicado.sql` sin
-- tocarlo. Lo unico que cambia es que la regla ya no esta escrita aqui dentro.
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
    -- 2 · Y si esta encendido, la regla de siempre, ahora compartida con el espejo.
    else public.subscription_grants_access((select auth.uid()))
  end;
$$;

-- `create or replace` conserva la ACL, pero se reafirma: de este grant depende que las
-- policies de M-3 funcionen, y no quiero que dependa de un default que nadie ve.
revoke all on function public.has_paid_access() from public;
revoke all on function public.has_paid_access() from anon;
grant execute on function public.has_paid_access() to authenticated;
grant execute on function public.has_paid_access() to service_role;

comment on function public.has_paid_access() is
  'MURO M-1/M-2 — true si esta cuenta puede ver el producto. Con el interruptor apagado devuelve true SIEMPRE. La regla vive en subscription_grants_access, compartida con el espejo. Concedida a authenticated porque se usa DENTRO de policies.';

-- ── 4 · El espejo ────────────────────────────────────────────────────────────
--
-- TODOS los perfiles, no solo los que pagarian: un entrenador mal clasificado saldria
-- como `would_be_denied` y hay que poder verlo. Los negados primero, que es la parte que
-- hay que leer.
create or replace function public.subscription_wall_mirror()
returns table (
  profile_id       uuid,
  full_name        text,
  clubs            text,
  roles            text,
  state            text,
  would_be_denied  boolean,
  access_until     timestamptz,
  hijos            integer,
  sigue            integer,
  ultimo_evento_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
    se.access_until,
    (select count(*)::integer from public.player_accounts   pa where pa.profile_id = p.id),
    (select count(*)::integer from public.player_spectators ps where ps.spectator_profile_id = p.id),
    -- Distingue "nunca tuvo suscripcion" de "la tuvo y caduco": son dos problemas
    -- distintos y en la lista se parecen.
    se.last_event_at
  from public.profiles p
  left join public.subscription_entitlements se on se.profile_id = p.id
  order by (not public.subscription_grants_access(p.id)) desc, p.full_name nulls last, p.id;
$$;

revoke all on function public.subscription_wall_mirror() from public;
revoke all on function public.subscription_wall_mirror() from anon, authenticated;
grant execute on function public.subscription_wall_mirror() to service_role;

comment on function public.subscription_wall_mirror() is
  'MURO M-2 — quien quedaria fuera si el interruptor se encendiera, y por que. IGNORA el interruptor a proposito: la pregunta es "que pasaria SI". Cerrada a authenticated: lista el estado de suscripcion de todo el mundo.';
