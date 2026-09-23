-- ════════════════════════════════════════════════════════════════════════════
-- Tercera desviación · un MENOR no puede ser tutor. Ni de otro, ni de sí mismo.
--
-- ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
-- MN-4 ya dejó escrito el agujero, y dejó escrito también lo que NO podía hacer:
--
--     «No detecta quién hay detrás de un correo. No es comprobable desde la base
--      de datos y cualquier promesa en esa dirección sería falsa.»
--
-- Sigue siendo verdad. Esta migración no intenta adivinar de quién es un correo.
-- Ataca el mismo daño por el otro lado: no por la dirección, sino por la EDAD de
-- quien acaba vinculado. Si `players.invite_email` llevaba el correo del propio
-- crío, el que aparece como tutor es un menor — y eso, cuando consta, sí se mide.
--
-- ── DOS VÍAS PARA SABERLO, Y BASTA CON UNA ──────────────────────────────────
-- (a) El perfil es la CUENTA PROPIA (`self`) de un jugador menor. Se apoya en
--     `players.date_of_birth`, que es NOT NULL y está al 100%: cuando esta vía
--     responde, responde con certeza. Cierra el caso del menor con cuenta propia
--     (MN-5) al que se hace tutor de su hermano pequeño.
--
-- (b) Su propia `profiles.date_of_birth`. Es la que hace falta para el caso que
--     nos trajo aquí —el crío cuyo correo puso el club en el campo del tutor—,
--     y hoy NO ESTÁ: medido, 0 de 9 tutores la tienen, y MN-1 ya midió que esa
--     columna va al 32% global. El flujo `quick` de la aceptación (el invitado
--     que ya tiene sesión) está documentado como «no toca contraseña ni perfil»,
--     así que ni la pide ni la guarda.
--
--     ⚠️ ESTE CANDADO NO MUERDE POR LA VÍA (b) HASTA QUE ESA FECHA SE RECOJA.
--     Queda puesto para que, el día que se recoja, no haya que acordarse de nada.
--
-- ── LA AUSENCIA NO AFIRMA NADA ──────────────────────────────────────────────
-- Sin fecha NO se dice que sea menor. Es la doctrina de la 219 de VERTEX —«sin
-- fecha NO se afirma que sea menor»— y aquí no es una elegancia: con 11 de 11
-- vínculos sin fecha, negar ante la ausencia rompería el alta de todo el mundo
-- mañana por la mañana.
--
-- ── LO QUE ESTO NO ARREGLA ──────────────────────────────────────────────────
-- Un club que ponga el correo del niño y cuya familia acepte por el flujo `quick`
-- seguirá pasando. No es un descuido del guard: es que ahí no hay ningún dato que
-- contradiga la historia. Lo que falta es recoger la fecha, y eso es código.
--
-- ── ORDEN DENTRO DE UNA MISMA SENTENCIA ─────────────────────────────────────
-- La vía (a) mira filas ya escritas. En un INSERT de varias filas a la vez, el
-- trigger de cada una ve solo las anteriores: si el `self` del menor va DESPUÉS
-- del `parent`, esta vía no lo ve. Es un límite real y no se disimula — el caso
-- que importa (un vínculo que se crea meses después de otro) no lo sufre.
--
-- ── DATOS ───────────────────────────────────────────────────────────────────
-- Cero reparación. Medido en producción: 0 tutores que consten menores por
-- cualquiera de las dos vías.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El predicado: ¿CONSTA que este perfil es menor?
-- ─────────────────────────────────────────────────────────────────────────────
-- Un solo sitio donde se responde esa pregunta, por la misma razón que
-- `invite_player_self` cita dos veces: un predicado en dos sitios acaba diciendo
-- dos cosas. Hermano de `player_is_minor` (MN-1), que responde por el JUGADOR;
-- este responde por el PERFIL, que es quien firma.
create or replace function public.profile_is_minor(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (a) Es la cuenta propia de un jugador menor. Dato al 100%.
    exists (
      select 1
        from public.player_accounts pa
       where pa.profile_id = p_profile_id
         and pa.relation = 'self'
         and public.player_is_minor(pa.player_id)
    )
    -- (b) Su propia fecha, SI consta. `is not null` explícito: sin él, la
    --     comparación con NULL daría NULL y el `or` lo trataría como falso —el
    --     mismo resultado por accidente, y no por decisión.
    or exists (
      select 1
        from public.profiles p
       where p.id = p_profile_id
         and p.date_of_birth is not null
         and p.date_of_birth > (current_date - interval '18 years')
    );
$$;

comment on function public.profile_is_minor(uuid) is
  'true si CONSTA que el perfil es menor de 18. Dos vías: es la cuenta propia '
  '(self) de un jugador menor —players.date_of_birth, NOT NULL, al 100%— o su '
  'profiles.date_of_birth lo dice. La AUSENCIA de fecha no afirma nada: devuelve '
  'false. Hermano de player_is_minor (MN-1), que responde por el jugador.';

revoke all on function public.profile_is_minor(uuid) from public;
revoke all on function public.profile_is_minor(uuid) from anon;
revoke all on function public.profile_is_minor(uuid) from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La regla, en trigger sobre la tabla
-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger aparte del de la 20261097000000 y no una rama más dentro de aquel: son
-- dos preguntas distintas —«¿este self tiene tutor?» y «¿este tutor es mayor?»— y
-- cada una tiene que poder leerse, fallar y retirarse por su cuenta.
create or replace function public.player_accounts_assert_tutor_mayor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.relation not in ('parent', 'guardian') then
    return new;
  end if;

  if public.profile_is_minor(new.profile_id) then
    raise exception 'tutor_menor_de_edad'
      using errcode = '23514',
            hint = 'Esa cuenta consta como menor de edad y no puede figurar como '
                   'tutor. Si es el propio jugador, el camino es la cuenta propia '
                   '(invite_player_self), no el campo del tutor.';
  end if;

  return new;
end;
$$;

comment on function public.player_accounts_assert_tutor_mayor() is
  'Tercera desviación: un perfil que CONSTA menor no se vincula como parent/guardian. '
  'La edad la da profile_is_minor (dos vías; la ausencia de fecha no afirma nada). '
  'Trigger separado del de la 20261097000000 a propósito: son dos reglas distintas.';

revoke all on function public.player_accounts_assert_tutor_mayor() from public;
revoke all on function public.player_accounts_assert_tutor_mayor() from anon;
revoke all on function public.player_accounts_assert_tutor_mayor() from authenticated;

-- `profile_id` va en la lista de columnas porque es el sujeto de la regla; `relation`
-- porque un `self` que pasa a `parent` es exactamente el caso que se quiere frenar.
-- `player_id` NO: mover un vínculo de tutor a otro jugador no cambia quién es el
-- tutor ni la edad que tiene.
drop trigger if exists player_accounts_tutor_mayor on public.player_accounts;
create trigger player_accounts_tutor_mayor
  before insert or update of relation, profile_id
  on public.player_accounts
  for each row execute function public.player_accounts_assert_tutor_mayor();
