-- R-2 — límite de intentos del endpoint público de aceptación.
--
-- R-2 expone `/invite/{token}` como route handler sin sesión, con el token como
-- credencial, para que la pantalla nativa pueda usar el mismo flujo que la web. Esto
-- es el contador que lo frena.
--
-- QUÉ FRENA ESTO DE VERDAD, Y QUÉ NO. Conviene que quede escrito aquí y no en la
-- cabeza de quien lo revise dentro de un año:
--
--   · NO protege contra fuerza bruta del token. `invitations.token` es un uuid v4:
--     122 bits. No hay límite que mejore lo que ya da la entropía.
--   · NO protege contra quien YA tiene el token. Ese es el dueño de la cuenta por
--     diseño — el token ES la credencial.
--   · NO es lo que impide reusar una invitación. Eso lo hace el uso único
--     (`accept_pending_invitations` pone `accepted_at`) y la caducidad de 7 días.
--
-- Lo que sí compra: coste (cada intento son una función de Vercel, hasta dos llamadas
-- admin a GoTrue y un sign-in), ruido de escáneres, y —la que importa— un freno el día
-- que alguien ensanche el endpoint. Hoy solo atiende `set_password`. Si un día atendiera
-- la rama `sign_in`, pasaría a ser un ORÁCULO DE VERIFICACIÓN DE CONTRASEÑAS sin
-- autenticar, y entonces esto dejaría de ser higiene para ser lo único que hay.
--
-- POR QUÉ EN POSTGRES Y NO EN MEMORIA. Las funciones de Vercel son multiinstancia: un
-- contador en un Map local sería un límite que PARECE protección y no protege, que es
-- peor que no tener ninguno. Postgres es además el único almacén del que ya dependen web
-- y nativa: cero vendors nuevos, cero secretos nuevos, y entra por migración y pgTAP como
-- todo lo demás.
--
-- EL TOKEN NO SE QUEMA NUNCA. Aquí solo corre una ventana de tiempo. Marcar la
-- invitación como muerta por exceso de intentos le regalaría a cualquiera una forma
-- silenciosa de dejar sin alta a una familia concreta.

-- ── 1 · El registro de intentos ─────────────────────────────────────────────

create table public.invite_accept_attempts (
  id          bigint generated always as identity primary key,
  token       uuid        not null,
  ip          inet,
  token_known boolean     not null,
  allowed     boolean     not null,
  created_at  timestamptz not null default now()
);

comment on table public.invite_accept_attempts is
  'Intentos contra el endpoint público de aceptación de invitaciones (R-2). Append-only, retención 25 h (ver purge_invite_accept_attempts). Alimenta register_invite_accept_attempt; no se lee desde ningún otro sitio.';

comment on column public.invite_accept_attempts.token is
  'Token presentado. SIN clave ajena a invitations A PROPÓSITO: los tokens que NO existen son justo los que hay que poder registrar, y son la señal de la regla de enumeración.';

comment on column public.invite_accept_attempts.ip is
  'IP del cliente, en claro (decisión aprobada: el dato ya vive en audit_log para esta misma acción, aquí solo cambia el plazo). Nula si no se pudo derivar. RGPD: purga a 25 h.';

comment on column public.invite_accept_attempts.token_known is
  'Si el token existía en invitations. Lo decide ESTA función, no el cliente: es lo que separa "familia dándose de alta" de "alguien barriendo".';

comment on column public.invite_accept_attempts.allowed is
  'false = este intento se denegó. Los denegados TAMBIÉN cuentan para las ventanas: quien insiste extiende su propio bloqueo.';

create index invite_accept_attempts_token_idx
  on public.invite_accept_attempts (token, created_at desc);

create index invite_accept_attempts_ip_idx
  on public.invite_accept_attempts (ip, created_at desc)
  where ip is not null;

-- Para la purga: los dos índices de arriba no sirven para barrer por fecha sola.
create index invite_accept_attempts_created_idx
  on public.invite_accept_attempts (created_at);

alter table public.invite_accept_attempts enable row level security;

-- Sin policies: nadie llega a esta tabla por PostgREST. El único camino es la
-- función de abajo, SECURITY DEFINER.
revoke all on table public.invite_accept_attempts from public;
revoke all on table public.invite_accept_attempts from anon, authenticated;

-- ── 2 · El contador ─────────────────────────────────────────────────────────
--
-- Devuelve la decisión y, si deniega, cuántos segundos faltan para que se libere un
-- hueco de la regla que saltó (el Retry-After del 429).
--
-- LA RESPUESTA NO DISTINGUE TOKEN CONOCIDO DE DESCONOCIDO. Si lo hiciera, el
-- limitador sería justo el oráculo de enumeración que viene a evitar. El que decide si
-- el token existe es este cuerpo, y no se lo cuenta a nadie: sale por `token_known`
-- hacia la tabla, nunca hacia el llamante.
--
-- LAS CUATRO REGLAS (ventanas deslizantes, las cuatro a la vez):
--
--   token                 10 / 15 min   Un humano fija su contraseña UNA vez. Diez deja
--                                       margen para tropiezos sin castigar a nadie.
--   ip                    20 / 15 min   SUELTO A PROPÓSITO.
--   ip                    60 / 24 h     Ídem.
--   ip + token desconocido 5 / 1 h      El freno de enumeración de verdad.
--
-- POR QUÉ EL LÍMITE POR IP VA SUELTO: un entrenador sentando a doce familias en el wifi
-- del club a darse de alta el mismo sábado es un caso NORMAL de este producto, no un
-- ataque. Un límite por IP apretado rompería exactamente el flujo que estamos
-- construyendo, y lo rompería de forma invisible. El peso lo lleva la regla de token
-- desconocido, que es la que sí distingue las dos situaciones: un usuario legítimo no
-- presenta un token inexistente cinco veces.
--
-- IP NULA → LAS REGLAS DE IP NO APLICAN, la de token sí. No es un agujero: en Vercel la
-- IP la pone el edge, el cliente no puede anularla, así que una IP nula es una anomalía
-- de infraestructura y no un vector. Meterlas todas en un mismo cubo habría convertido
-- una cabecera rota en una caída global de las altas.
--
-- CONCURRENCIA: la regla de token se serializa con un lock de transacción sobre el
-- propio token, que es donde una avalancha haría daño. Las de IP quedan aproximadas
-- bajo concurrencia —dos peticiones simultáneas pueden colarse— y es aceptable: son
-- control de abuso, no un gate de autorización.

create or replace function public.register_invite_accept_attempt(
  p_token uuid,
  p_ip    inet default null
)
returns table (decision text, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  c_token_window   constant interval := interval '15 minutes';
  c_token_max      constant integer  := 10;
  c_ip_window      constant interval := interval '15 minutes';
  c_ip_max         constant integer  := 20;
  c_ip_day_window  constant interval := interval '24 hours';
  c_ip_day_max     constant integer  := 60;
  c_unknown_window constant interval := interval '1 hour';
  c_unknown_max    constant integer  := 5;

  v_known  boolean;
  v_count  integer;
  v_oldest timestamptz;
  v_retry  integer;
begin
  -- Serializa los intentos DEL MISMO token. Se suelta al cerrar la transacción.
  perform pg_advisory_xact_lock(hashtextextended(p_token::text, 0));

  select exists (select 1 from public.invitations where token = p_token) into v_known;

  -- Regla 1 · por token.
  select count(*), min(created_at) into v_count, v_oldest
    from public.invite_accept_attempts
   where token = p_token
     and created_at > now() - c_token_window;

  if v_count >= c_token_max then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_token_window - now())))::integer);
  end if;

  -- Regla 2 · por IP, ventana corta.
  if v_retry is null and p_ip is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.invite_accept_attempts
     where ip = p_ip
       and created_at > now() - c_ip_window;

    if v_count >= c_ip_max then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_ip_window - now())))::integer);
    end if;
  end if;

  -- Regla 3 · por IP, ventana de día.
  if v_retry is null and p_ip is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.invite_accept_attempts
     where ip = p_ip
       and created_at > now() - c_ip_day_window;

    if v_count >= c_ip_day_max then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_ip_day_window - now())))::integer);
    end if;
  end if;

  -- Regla 4 · por IP, solo tokens que no existen.
  if v_retry is null and p_ip is not null and not v_known then
    select count(*), min(created_at) into v_count, v_oldest
      from public.invite_accept_attempts
     where ip = p_ip
       and not token_known
       and created_at > now() - c_unknown_window;

    if v_count >= c_unknown_max then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_unknown_window - now())))::integer);
    end if;
  end if;

  insert into public.invite_accept_attempts (token, ip, token_known, allowed)
  values (p_token, p_ip, v_known, v_retry is null);

  if v_retry is null then
    return query select 'ok'::text, 0;
  else
    return query select 'rate_limited'::text, v_retry;
  end if;
end;
$$;

revoke all on function public.register_invite_accept_attempt(uuid, inet) from public;
revoke all on function public.register_invite_accept_attempt(uuid, inet) from anon;
revoke all on function public.register_invite_accept_attempt(uuid, inet) from authenticated;
grant execute on function public.register_invite_accept_attempt(uuid, inet) to service_role;

comment on function public.register_invite_accept_attempt(uuid, inet) is
  'Registra un intento contra el endpoint público de aceptación y decide si se atiende. Devuelve (ok|rate_limited, segundos). La respuesta NO revela si el token existe. Solo service_role: el endpoint no tiene sesión y llama con el cliente admin.';

-- ── 3 · La purga ────────────────────────────────────────────────────────────
--
-- 25 HORAS, NO 24, y no es un número al azar: la regla de día mira una ventana de 24 h,
-- así que purgar justo a 24 h le iría recortando la cola por detrás y el límite de
-- 60/24 h quedaría más flojo de lo que dice, en silencio. La hora de más es el margen.

create or replace function public.purge_invite_accept_attempts()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  delete from public.invite_accept_attempts
   where created_at < now() - interval '25 hours';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_invite_accept_attempts() from public;
revoke all on function public.purge_invite_accept_attempts() from anon;
revoke all on function public.purge_invite_accept_attempts() from authenticated;
grant execute on function public.purge_invite_accept_attempts() to service_role;

comment on function public.purge_invite_accept_attempts() is
  'Borra intentos de más de 25 h y devuelve cuántos. La llama un cron de los que ya existen. 25 y no 24 para no recortar por detrás la ventana de 24 h de register_invite_accept_attempt.';
