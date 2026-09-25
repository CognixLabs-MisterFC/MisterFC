-- ════════════════════════════════════════════════════════════════════════════
-- D-2 · La DECLARACIÓN de mayoría de edad del tutor, pegada al vínculo.
--
-- ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
-- La mig 20261099000000 decide con `profiles.date_of_birth` si alguien puede
-- figurar como tutor. Para alimentarla, la pantalla de aceptar empezó a pedir esa
-- fecha (#720). Lo que llegó a producción fue `2020-01-01` en dos perfiles —un
-- relleno, ni siquiera la fecha de un niño—, y con ella dentro el trigger
-- rechazaba el alta desde la base de datos. Nadie pone su edad en un formulario
-- de alta, así que el campo se retiró y en su lugar hay una casilla: «Declaro que
-- soy mayor de 18 años» (#722).
--
-- Una casilla que no se guarda en ninguna parte no es una declaración: es un
-- trámite. Esto es donde queda.
--
-- ── POR QUÉ EN `player_accounts` Y NO EN `consents` ─────────────────────────
-- `consents` es el ledger de consentimientos RGPD y exige dos cosas que esto no
-- tiene: un valor del enum `consent_type` y un `legal_document_version NOT NULL`
-- —la versión del texto que se aceptó—. La declaración no es un documento con
-- versiones: es un hecho sobre quien firma. Y lo que se quiere probar es «este
-- vínculo de tutor se creó con una declaración», que es una propiedad DEL VÍNCULO.
--
-- Los Términos declaran la mayoría de edad solo para CONTRATAR la suscripción
-- (§3), y su §6.2 dice expresamente que los menores sí pueden tener cuenta. Así
-- que aceptar los Términos no prueba esto. El día que el abogado meta la cláusula,
-- la prueba pasará a ser la aceptación de esa versión y esta columna sobrará.
--
-- ── QUÉ NO ES ──────────────────────────────────────────────────────────────
-- Una comprobación. Es una AFIRMACIÓN de quien acepta, y nada en la base de datos
-- la contradice. El candado que sigue midiendo es la vía (a) de la 20261099000000
-- —la cuenta propia de un jugador menor, sobre `players.date_of_birth`, que es
-- NOT NULL y está al 100%—. Esta columna no lo sustituye: lo acompaña.
--
-- ── CERO REPARACIÓN, Y ES LO HONESTO ───────────────────────────────────────
-- Las filas que ya existen se quedan en NULL. Los 6 vínculos de tutor vivos se
-- crearon sin que nadie declarara nada, y escribirles una fecha ahora sería
-- inventar una prueba. NULL significa «no consta», que es la verdad.
--
-- ── QUIÉN PUEDE ESCRIBIRLA, DICHO SIN ADORNOS ──────────────────────────────
-- La policy `player_accounts_write_admin` es `for all to authenticated` para
-- admin_club/director/coordinador, así que el personal del club PUEDE anotar la
-- declaración en una fila que esté a NULL. No se cierra, y no por descuido:
--   · cerrarlo pediría distinguir al `service_role` dentro de SQL, y el único
--     patrón sería `auth.role()`, que NO se usa en ninguna migración de este repo
--     (la 20261091000000 dejó escrito por qué estrenarlo es más riesgo del que
--     quita);
--   · es la misma confianza que el club ya tiene sobre el vínculo entero: puede
--     crearlo y borrarlo. Quien puede crear la fila no gana nada pudiendo anotarla.
-- Lo que SÍ se cierra es reescribir la historia: una declaración hecha no se
-- cambia ni se borra, y eso vale para todos, service_role incluido. Es la misma
-- doctrina del ledger `consents` (append-only por trigger) aplicada a una columna.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.player_accounts
  add column adult_declared_at timestamptz;

comment on column public.player_accounts.adult_declared_at is
  'D-2 — cuándo declaró quien acepta que es mayor de 18 años, al crear este vínculo '
  'de tutor. NULL = no consta (los vínculos anteriores a #722 y los de relation=self). '
  'Es una AFIRMACIÓN de quien firma, no una comprobación: lo que se mide sigue siendo '
  'la vía (a) de la mig 20261099000000. Una vez escrita no se cambia ni se borra '
  '(trigger player_accounts_declaracion_inmutable, también para service_role).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna significa UNA cosa: solo cabe en un vínculo de tutor.
-- ─────────────────────────────────────────────────────────────────────────────
-- En un `self` no tiene sentido —es el propio jugador, y puede ser menor: la app
-- ni la pide ahí—. Sin este CHECK, una declaración en un `self` sería un dato que
-- no quiere decir nada, y los datos que no quieren decir nada acaban leyéndose.
--
-- Es seguro ponerlo ahora: hoy TODAS las filas están a NULL, y nada en el repo
-- actualiza `player_accounts.relation` (medido: ni una sentencia en SQL ni una en
-- código). Si algún día algo convierte un `parent` declarado en `self`, saltará
-- aquí — y saltar es lo correcto: esa transición tiene que ser deliberada.
alter table public.player_accounts
  add constraint player_accounts_declaracion_solo_tutor
  check (adult_declared_at is null or relation in ('parent', 'guardian'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Una declaración hecha no se cambia ni se borra.
-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger y no policy, por la misma razón que en `consents`: los triggers corren
-- para TODOS los roles, y el `service_role` se salta la RLS. Una prueba que el
-- servidor puede reescribir no prueba nada.
--
-- Solo mira la transición de ESTA columna. Anotarla (NULL → valor) se permite:
-- es lo que hace la web justo después de aceptar. Reescribirla o vaciarla, no.
-- Escribir el MISMO valor otra vez se deja pasar (`is distinct from`): un reintento
-- idempotente no es reescribir la historia.
create or replace function public.player_accounts_declaracion_inmutable()
returns trigger
language plpgsql
as $$
begin
  if old.adult_declared_at is not null
     and new.adult_declared_at is distinct from old.adult_declared_at then
    raise exception 'declaracion_mayoria_inmutable'
      using errcode = '23514',
            hint = 'La declaración de mayoría de edad de este vínculo ya está hecha: '
                   'no se puede cambiar ni borrar. Si el vínculo no debe existir, '
                   'bórrese el vínculo.';
  end if;
  return new;
end;
$$;

comment on function public.player_accounts_declaracion_inmutable() is
  'D-2 — una declaración de mayoría de edad ya hecha no se cambia ni se borra, ni con '
  'service_role (los triggers corren para todos los roles y service_role se salta la '
  'RLS). Anotarla NULL → valor sí se permite: es lo que hace la web tras aceptar.';

-- Nadie la llama por su nombre: la despierta el trigger, y un trigger no comprueba el
-- EXECUTE de quien hizo el UPDATE. Así que se cierra a los tres, como su hermana
-- `player_accounts_assert_tutor_mayor` de la 20261099000000.
--
-- Los DOS revokes hacen falta, y no es redundancia: una función nueva nace con la ACL
-- por defecto, donde PUBLIC tiene EXECUTE, y eso basta para que `anon` pueda llamarla.
-- Un `revoke ... from public` no quita una concesión directa a un rol, y un
-- `revoke ... from anon` no quita la de PUBLIC: son dos entradas distintas (la
-- 20261075000000 lo dejó medido y escrito). Sin esto, el bloque [1] del test
-- `anon_execute_cerrado` se pone rojo nombrando esta función — que es justo lo que pasó.
revoke all on function public.player_accounts_declaracion_inmutable() from public;
revoke all on function public.player_accounts_declaracion_inmutable() from anon;
revoke all on function public.player_accounts_declaracion_inmutable() from authenticated;

-- `update of adult_declared_at`: el trigger solo se despierta cuando esa columna
-- aparece en el SET. Un UPDATE de cualquier otra cosa no paga nada.
drop trigger if exists player_accounts_declaracion_inmutable on public.player_accounts;
create trigger player_accounts_declaracion_inmutable
  before update of adult_declared_at
  on public.player_accounts
  for each row execute function public.player_accounts_declaracion_inmutable();
