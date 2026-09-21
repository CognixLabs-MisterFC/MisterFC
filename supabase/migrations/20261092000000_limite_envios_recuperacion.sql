-- Correo-B · recuperación — límite de envíos del correo de restablecer contraseña.
--
-- ── POR QUÉ APARECE ESTO AHORA, SI LLEVA AÑOS SIN LÍMITE ────────────────────
--
-- Porque hoy el límite lo pone otro. `resetPasswordForEmail` manda el correo POR
-- SUPABASE, y GoTrue aplica su `rate_limit_email_sent` (30 correos/hora de
-- proyecto). Al pasar la recuperación a Resend —como los otros siete senders de
-- la serie Correo-B— ese tope deja de aplicar: hablamos con Resend directamente
-- y nadie cuenta. Lo dice ya el comentario de `apps/web/src/lib/email/resend.ts`.
--
-- Y la recuperación no es un sender cualquiera. Los siete de invitación exigen
-- sesión y rol: para mandar uno hay que estar dentro y ser staff. Este NO puede
-- exigir sesión — es justo el de quien ha perdido la contraseña—, así que la app
-- nativa necesitará un endpoint PÚBLICO. Un endpoint público que manda correo a
-- la dirección que le teclees, sin contador, es un cañón de spam a nuestra costa
-- y a nuestro dominio: quien lo use quema la reputación de misterfc.es y de paso
-- la entrega de TODOS los demás correos, invitaciones incluidas.
--
-- ── QUÉ FRENA ESTO DE VERDAD, Y QUÉ NO ─────────────────────────────────────
--
--   · NO protege el enlace de recuperación. Ese es un OTP de GoTrue con su propia
--     entropía y su propia caducidad; ningún contador mejora eso.
--   · NO es un gate de autorización. Es control de abuso: control de COSTE (cada
--     intento son una función de Vercel, una llamada admin a GoTrue y un correo
--     de Resend que se paga) y de REPUTACIÓN del dominio.
--   · NO decide quién puede restablecer. Eso lo decide tener acceso al buzón.
--
-- La diferencia con el contador de invitaciones (R-2, 20261074000000), del que
-- esto es hermano casi línea por línea: allí la clave de la regla 1 es un token
-- uuid v4 que el atacante tiene que ADIVINAR. Aquí la clave es un correo, que
-- cualquiera sabe. Por eso la regla por correo, que en R-2 era higiene, aquí es
-- LA REGLA PRINCIPAL: es la que impide reventar el buzón de una persona concreta
-- a base de «he olvidado mi contraseña».
--
-- ── EL EFECTO SECUNDARIO, QUE SE ASUME A SABIENDAS ─────────────────────────
--
-- Un límite por correo es también una palanca de denegación: alguien puede gastar
-- los diez huecos de una víctima para que ella no pueda pedir su enlace. Se acepta
-- por lo mismo que en R-2 se aceptó no quemar el token: la ventana RUEDA (quince
-- minutos y vuelve a haber hueco) y NO se marca nada como muerto. El daño máximo
-- es esperar; si el castigo fuese permanente, le habríamos regalado a cualquiera
-- una forma silenciosa de dejar a una familia fuera de su cuenta.
--
-- ── POR QUÉ EN POSTGRES Y NO EN MEMORIA ────────────────────────────────────
--
-- Igual que en R-2: las funciones de Vercel son multiinstancia, y un contador en
-- un Map local sería un límite que PARECE protección y no protege — peor que no
-- tener ninguno. Postgres es además el único almacén del que ya dependen web y
-- nativa: cero vendors nuevos, cero secretos nuevos, y entra por migración y
-- pgTAP como todo lo demás.

-- ── 1 · El registro de intentos ─────────────────────────────────────────────

create table public.password_recovery_attempts (
  id            bigint generated always as identity primary key,
  email         text        not null,
  ip            inet,
  account_known boolean     not null,
  allowed       boolean     not null,
  created_at    timestamptz not null default now()
);

comment on table public.password_recovery_attempts is
  'Intentos de pedir el correo de restablecer contraseña. Append-only, retención 25 h (ver purge_password_recovery_attempts). Alimenta register_password_recovery_attempt; no se lee desde ningún otro sitio.';

comment on column public.password_recovery_attempts.email is
  'Correo presentado, ya normalizado (lower+trim) por la función. EN CLARO y a propósito: es la clave de la regla 1 y solo se puede contar por igualdad exacta. Ojo a lo que esto es: una dirección que ha TECLEADO alguien sin sesión, no un dato de nuestro padrón. Por eso vive 25 h y no la lee nadie por PostgREST.';

comment on column public.password_recovery_attempts.ip is
  'IP del cliente, en claro (mismo criterio y mismo plazo que invite_accept_attempts). Nula si no se pudo derivar. RGPD: purga a 25 h.';

comment on column public.password_recovery_attempts.account_known is
  'Si ese correo tenía cuenta en auth.users. Lo decide ESTA función, no el cliente, y NO sale hacia el llamante: es lo que separa "alguien que se equivoca al teclear" de "alguien barriendo una lista de correos".';

comment on column public.password_recovery_attempts.allowed is
  'false = este intento se denegó. Los denegados TAMBIÉN cuentan para las ventanas: quien insiste extiende su propio bloqueo.';

create index password_recovery_attempts_email_idx
  on public.password_recovery_attempts (email, created_at desc);

create index password_recovery_attempts_ip_idx
  on public.password_recovery_attempts (ip, created_at desc)
  where ip is not null;

-- Para la purga: los dos índices de arriba no sirven para barrer por fecha sola.
create index password_recovery_attempts_created_idx
  on public.password_recovery_attempts (created_at);

alter table public.password_recovery_attempts enable row level security;

-- Sin policies: nadie llega a esta tabla por PostgREST. El único camino es la
-- función de abajo, SECURITY DEFINER.
revoke all on table public.password_recovery_attempts from public;
revoke all on table public.password_recovery_attempts from anon, authenticated;

-- ── 2 · El contador ─────────────────────────────────────────────────────────
--
-- Devuelve la decisión y, si deniega, cuántos segundos faltan para que se libere
-- un hueco de la regla que saltó (el Retry-After del 429).
--
-- LA RESPUESTA NO DISTINGUE CUENTA CONOCIDA DE DESCONOCIDA, y aquí importa más
-- que en R-2: `/forgot-password` ya contesta lo mismo exista o no la cuenta (la
-- action redirige SIEMPRE a `check-email`). Si el limitador devolviese algo
-- distinto para un correo sin cuenta, sería él quien filtrase «esta dirección
-- está registrada en MisterFC» — el oráculo que la pantalla evita. Quien decide
-- si la cuenta existe es este cuerpo, y solo se lo cuenta a la tabla, por
-- `account_known`.
--
-- LAS CUATRO REGLAS (ventanas deslizantes, las cuatro a la vez). Son las MISMAS
-- de R-2, decisión de producto: el flujo se parece (un humano, una vez, a veces
-- doce familias en el mismo wifi) y dos tablas de números distintas serían dos
-- cosas que mantener y una que se olvida.
--
--   correo                   10 / 15 min   LA PRINCIPAL. Un humano lo pide UNA vez;
--                                          diez deja margen para tropiezos —el
--                                          correo que tarda, el botón pulsado dos
--                                          veces— sin dejar reventar un buzón.
--   ip                       20 / 15 min   SUELTO A PROPÓSITO.
--   ip                       60 / 24 h     Ídem.
--   ip + cuenta desconocida   5 / 1 h      El freno de enumeración de verdad.
--
-- POR QUÉ EL LÍMITE POR IP VA SUELTO: un entrenador sentando a doce familias en
-- el wifi del club es un caso NORMAL de este producto, no un ataque, y a estas
-- alturas ya sabemos que apretarlo rompe flujos reales de forma invisible. El
-- peso lo lleva la regla de cuenta desconocida: una familia legítima presenta su
-- propio correo, que existe; quien barre una lista comprada falla casi siempre.
--
-- IP NULA → LAS REGLAS DE IP NO APLICAN, la del correo sí. No es un agujero: en
-- Vercel la IP la pone el edge y el cliente no puede anularla, así que una IP
-- nula es una anomalía de infraestructura y no un vector. Meterlas todas en un
-- mismo cubo habría convertido una cabecera rota en una caída global del
-- «he olvidado mi contraseña».
--
-- CORREO VACÍO → NI FILA NI CONSUMO. No hay destinatario, así que no hay correo
-- que mandar ni coste que frenar, y registrarlo solo serviría para que un bucle
-- de cadenas vacías gastase los huecos por IP de quien viniera detrás.
--
-- CONCURRENCIA: la regla del correo se serializa con un lock de transacción sobre
-- el propio correo, que es donde una avalancha haría daño. Las de IP quedan
-- aproximadas bajo concurrencia —dos peticiones simultáneas pueden colarse— y es
-- aceptable: son control de abuso, no un gate de autorización.
--
-- POR QUÉ SECURITY DEFINER: para responder `account_known` hay que leer
-- `auth.users`, que ningún cliente puede leer. Es el mismo motivo que en
-- `club_member_by_email`.

create or replace function public.register_password_recovery_attempt(
  p_email text,
  p_ip    inet default null
)
returns table (decision text, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  c_email_window   constant interval := interval '15 minutes';
  c_email_max      constant integer  := 10;
  c_ip_window      constant interval := interval '15 minutes';
  c_ip_max         constant integer  := 20;
  c_ip_day_window  constant interval := interval '24 hours';
  c_ip_day_max     constant integer  := 60;
  c_unknown_window constant interval := interval '1 hour';
  c_unknown_max    constant integer  := 5;

  v_email  text := nullif(lower(btrim(p_email)), '');
  v_known  boolean;
  v_count  integer;
  v_oldest timestamptz;
  v_retry  integer;
begin
  if v_email is null then
    return query select 'ok'::text, 0;
    return;
  end if;

  -- Serializa los intentos DEL MISMO correo. Se suelta al cerrar la transacción.
  perform pg_advisory_xact_lock(hashtextextended(v_email, 0));

  -- GoTrue guarda el correo ya en minúsculas, pero el `lower()` se queda: si
  -- alguna vez entrara una fila con mayúsculas, sin él la cuenta pasaría por
  -- desconocida y el usuario se comería la regla de enumeración siendo legítimo.
  select exists (
    select 1 from auth.users where lower(email) = v_email
  ) into v_known;

  -- Regla 1 · por correo.
  select count(*), min(created_at) into v_count, v_oldest
    from public.password_recovery_attempts
   where email = v_email
     and created_at > now() - c_email_window;

  if v_count >= c_email_max then
    v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_email_window - now())))::integer);
  end if;

  -- Regla 2 · por IP, ventana corta.
  if v_retry is null and p_ip is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.password_recovery_attempts
     where ip = p_ip
       and created_at > now() - c_ip_window;

    if v_count >= c_ip_max then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_ip_window - now())))::integer);
    end if;
  end if;

  -- Regla 3 · por IP, ventana de día.
  if v_retry is null and p_ip is not null then
    select count(*), min(created_at) into v_count, v_oldest
      from public.password_recovery_attempts
     where ip = p_ip
       and created_at > now() - c_ip_day_window;

    if v_count >= c_ip_day_max then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_ip_day_window - now())))::integer);
    end if;
  end if;

  -- Regla 4 · por IP, solo correos sin cuenta.
  if v_retry is null and p_ip is not null and not v_known then
    select count(*), min(created_at) into v_count, v_oldest
      from public.password_recovery_attempts
     where ip = p_ip
       and not account_known
       and created_at > now() - c_unknown_window;

    if v_count >= c_unknown_max then
      v_retry := greatest(1, ceil(extract(epoch from (v_oldest + c_unknown_window - now())))::integer);
    end if;
  end if;

  insert into public.password_recovery_attempts (email, ip, account_known, allowed)
  values (v_email, p_ip, v_known, v_retry is null);

  if v_retry is null then
    return query select 'ok'::text, 0;
  else
    return query select 'rate_limited'::text, v_retry;
  end if;
end;
$$;

revoke all on function public.register_password_recovery_attempt(text, inet) from public;
revoke all on function public.register_password_recovery_attempt(text, inet) from anon;
revoke all on function public.register_password_recovery_attempt(text, inet) from authenticated;
grant execute on function public.register_password_recovery_attempt(text, inet) to service_role;

comment on function public.register_password_recovery_attempt(text, inet) is
  'Registra una petición del correo de restablecer contraseña y decide si se atiende. Devuelve (ok|rate_limited, segundos). La respuesta NO revela si el correo tiene cuenta. Solo service_role: la puerta de la app no tiene sesión y se llama con el cliente admin.';

-- ── 3 · La purga ────────────────────────────────────────────────────────────
--
-- OJO, DEUDA CON FECHA: esta funcion NACE SIN CRON. Es deliberado —hoy no hay
-- quien escriba en la tabla, porque las puertas siguen llamando a
-- `resetPasswordForEmail`— pero deja de serlo en cuanto entre la primera. La
-- llamada va al cron horario que ya existe (`/api/cron/invite-attempts`, que
-- purga el registro hermano de R-2) y es REQUISITO del PR que estrene la puerta
-- web: sin ella la tabla guarda correos e IPs para siempre y la retencion
-- declarada de 26 h seria mentira.
--
-- 25 HORAS, NO 24, por lo mismo que en R-2: la regla de día mira una ventana de
-- 24 h, así que purgar justo a 24 h le iría recortando la cola por detrás y el
-- límite de 60/24 h quedaría más flojo de lo que dice, en silencio. La hora de
-- más es el margen.

create or replace function public.purge_password_recovery_attempts()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  delete from public.password_recovery_attempts
   where created_at < now() - interval '25 hours';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_password_recovery_attempts() from public;
revoke all on function public.purge_password_recovery_attempts() from anon;
revoke all on function public.purge_password_recovery_attempts() from authenticated;
grant execute on function public.purge_password_recovery_attempts() to service_role;

comment on function public.purge_password_recovery_attempts() is
  'Borra intentos de más de 25 h y devuelve cuántos. 25 y no 24 para no recortar por detrás la ventana de 24 h de register_password_recovery_attempt. PENDIENTE DE CRON: la llamada se añade al cron horario de /api/cron/invite-attempts en el PR que estrene la primera puerta — hasta entonces esta tabla no la escribe nadie.';
