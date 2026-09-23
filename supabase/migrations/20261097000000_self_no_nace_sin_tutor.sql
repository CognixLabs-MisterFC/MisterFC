-- ════════════════════════════════════════════════════════════════════════════
-- Punto 7 · «NUNCA al revés»: una cuenta propia de menor no existe sin tutor.
--
-- ── QUÉ SE MIDIÓ ────────────────────────────────────────────────────────────
-- La regla existe y es correcta, pero vive SOLO en `invite_player_self`, que
-- exige `user_is_tutor_of_player`. Medido contra producción (BEGIN…ROLLBACK, sin
-- dejar rastro), la misma consecuencia se escribe por dos caminos que no pasan
-- por esa función:
--
--   A · `invitations`     — `invitations_insert_admin` deja a cualquier
--       admin_club/director insertar `role='jugador'`, `player_relation='self'`
--       sin comprobar que haya tutor. Ensayado: invitación → cuenta → aceptada →
--       menor con cuenta propia, membresía viva y CERO tutores.
--
--   B · `player_accounts` — más corto todavía: la tabla no tiene ni un trigger y
--       su policy de escritura es `cmd=*` para admin_club, director Y coordinador
--       del equipo. Un `INSERT … relation='self'` a pelo pasa, sin invitación,
--       sin correo y sin ninguna de las precondiciones de MN.
--
-- Esta migración cierra el camino B. El A va en la siguiente, y no al revés: el
-- candado de verdad es la tabla donde ATERRIZA el vínculo, porque por ahí pasan
-- todos los caminos —la RPC, PostgREST y un admin con SQL—. El guard sobre
-- `invitations` es para que el error caiga sobre quien crea la invitación y no
-- sobre el niño que pulsa un enlace condenado a fallar.
--
-- Es la misma lección que MN-4 ya dejó escrita («un guard en cada llamante habría
-- dejado fuera al que se escriba mañana») y la que VERTEX tiene en su mig 196:
-- «la RPC es la ergonomía, pero dirección puede escribir la tabla directamente.
-- Una regla que viva solo en la RPC no los alcanza.»
--
-- ── SOBRE QUÉ `self` MANDA ESTA REGLA, Y POR QUÉ NO SOBRE TODOS ─────────────
-- `relation='self'` significa DOS cosas y las dos son legítimas. Lo dice la
-- cabecera de MN-1: la mig 20261038 lo añadió para que el jugador ADULTO
-- vinculado a su propia ficha gestionara sus cuatro secciones, y MN-5 le sumó
-- después la cuenta propia del MENOR — «con la cuenta propia del menor, un
-- `self` puede tener 11 años».
--
-- El invariante es solo sobre el segundo. Un adulto vinculado a su propia ficha
-- NO necesita tutor y nunca lo tuvo: negárselo rompería lo que la 20261038 vino
-- a permitir. La primera versión de esta migración no distinguía y lo prohibía;
-- lo cazó la suite pgTAP entera, que es donde vive ese caso.
--
-- La edad se pregunta con `player_is_minor`, el helper que MN-1 ya dejó hecho, y
-- no con una comparación escrita aquí: es la lección que el propio
-- `invite_player_self` cita dos veces —«un predicado en dos sitios acaba diciendo
-- dos cosas»—. Se calcula en vivo sobre `players.date_of_birth` (NOT NULL), así
-- que el 18º cumpleaños cambia la respuesta sin trigger ni cron: ese día el tutor
-- de un `self` ya puede retirarse, que es justo lo que se quiere.
--
-- ── LAS DOS MITADES DE LA MISMA REGLA ───────────────────────────────────────
-- 1. ENTRAR — el `self` de un MENOR exige que ya tenga tutor.
-- 2. SALIR  — no se retira al ÚLTIMO tutor de un MENOR con cuenta propia.
--
-- La segunda no es un extra. Un candado que solo vale al entrar no es un
-- invariante: bastaría crear el `self` con tutor y borrar el tutor después para
-- quedarse exactamente donde estábamos.
--
-- ── LA EXCEPCIÓN, Y POR QUÉ ES ESTA Y NO OTRA ───────────────────────────────
-- `finalize_account_deletion` borra los vínculos de quien se va
-- (`delete from player_accounts where profile_id = …`, paso 5.4). Sin excepción,
-- un tutor cuyo hijo tenga cuenta propia NO PODRÍA BORRAR SU CUENTA: la
-- anonimización entera fallaría. Eso es Apple 5.1.1 (v) y toda la serie BC, y no
-- se negocia contra este invariante. Hoy mismo los dos únicos menores con cuenta
-- dependen de un solo tutor cada uno, así que el caso no es teórico.
--
-- La excepción se ancla en un HECHO de la fila, no en «si viene del backend» ni
-- en `auth.uid() is null`: el paso 5.1 de esa misma función pone
-- `profiles.deleted_at = now()` ANTES del 5.4 y en la MISMA transacción, así que
-- cuando el DELETE llega aquí la marca ya está puesta y el trigger la ve. A una
-- cuenta que se está borrando no se le niega la salida.
--
-- ⚠️ LO QUE ESTO DEJA ABIERTO, DICHO AQUÍ PARA QUE NO SE PIERDA: por esa puerta
-- el menor puede quedarse sin tutor de forma legítima —el último tutor borra su
-- cuenta—. No es este el sitio donde se decide qué hacer entonces (cerrar también
-- la cuenta del menor, avisar a dirección, o aceptarlo); es una decisión de
-- producto y está sin tomar.
--
-- ── SEGURIDAD ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER no es adorno: la RLS de `player_accounts` solo deja ver a cada
-- cual sus propias filas (`profile_id = auth.uid()`) salvo staff. Un trigger
-- INVOKER, cuando el que acepta es el MENOR, no vería la fila del tutor y
-- concluiría «no hay tutor» — negaría justo el caso bueno.
--
-- ── DATOS ───────────────────────────────────────────────────────────────────
-- Cero reparación. Comprobado en producción antes de escribir esto: 0 filas
-- `self` sin tutor. Las dos que hay tienen su tutor.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.player_accounts_assert_self_con_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- La fila que se está escribiendo o retirando. Se excluye de los conteos: en un
  -- BEFORE trigger la versión VIEJA sigue en la tabla, así que sin esto una fila
  -- de tutor que pasara a 'self' se contaría a sí misma como su propio tutor.
  --
  -- Se asigna con IF y no con `coalesce(new.id, old.id)`: en un trigger de DELETE
  -- la variable NEW no está asignada, y leerla —aunque sea dentro de un coalesce
  -- que "no la necesita"— revienta con `record "new" is not assigned yet`.
  v_esta_fila uuid;
begin
  if tg_op = 'DELETE' then
    v_esta_fila := old.id;
  else
    v_esta_fila := new.id;
  end if;

  -- ── 1) LO QUE ENTRA ───────────────────────────────────────────────────────
  if tg_op in ('INSERT', 'UPDATE') and new.relation = 'self'
     and public.player_is_minor(new.player_id) then
    if not exists (
      select 1 from public.player_accounts pa
       where pa.player_id = new.player_id
         and pa.relation in ('parent', 'guardian')
         and pa.id <> v_esta_fila
    ) then
      raise exception 'self_sin_tutor'
        using errcode = '23514',
              hint = 'La cuenta propia de un jugador MENOR exige que ya tenga tutor. '
                     'El camino es invite_player_self, que lo comprueba. Un jugador '
                     'mayor de edad vinculado a su propia ficha no pasa por aquí.';
    end if;
  end if;

  -- ── 2) LO QUE SALE ────────────────────────────────────────────────────────
  -- Un tutor "sale" de tres formas, y las tres dejan al jugador igual de solo:
  -- borrando la fila, cambiándole la relación, o moviéndola a otro jugador. Las
  -- tres se miran contra OLD.player_id, que es el jugador que se queda atrás.
  if tg_op in ('DELETE', 'UPDATE') and old.relation in ('parent', 'guardian')
     and public.player_is_minor(old.player_id) then
    if tg_op = 'DELETE'
       or new.relation not in ('parent', 'guardian')
       or new.player_id is distinct from old.player_id
    then
      -- La excepción del borrado de cuenta (ver cabecera). Va ANTES de los dos
      -- EXISTS: es más barata y, sobre todo, es la que no admite discusión.
      if not exists (
        select 1 from public.profiles p
         where p.id = old.profile_id and p.deleted_at is not null
      )
      and exists (
        select 1 from public.player_accounts pa
         where pa.player_id = old.player_id
           and pa.relation = 'self'
           and pa.id <> v_esta_fila
      )
      and not exists (
        select 1 from public.player_accounts pa
         where pa.player_id = old.player_id
           and pa.relation in ('parent', 'guardian')
           and pa.id <> v_esta_fila
      ) then
        raise exception 'ultimo_tutor_de_menor_con_cuenta'
          using errcode = '23514',
                hint = 'Ese jugador es menor, tiene cuenta propia y este es su único '
                       'tutor. Vincula otro tutor antes de retirar este. Al cumplir '
                       '18 deja de hacer falta, y la respuesta cambia sola.';
      end if;
    end if;
  end if;

  -- Mismo motivo que arriba: un `case … else new end` se compila a una consulta
  -- que referencia NEW, y en el DELETE no existe.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.player_accounts_assert_self_con_tutor() is
  'Punto 7 (camino B): el vínculo relation=''self'' de un jugador MENOR exige que ya '
  'tenga tutor, y no se retira al último tutor de un menor con cuenta propia. El '
  'self de un jugador ADULTO (mig 20261038) no entra: nunca necesitó tutor. La edad '
  'la da player_is_minor (MN-1), en vivo sobre players.date_of_birth. Excepción: el '
  'borrado de cuenta (profiles.deleted_at ya puesto por el paso 5.1 de '
  'finalize_account_deletion). SECURITY DEFINER porque la RLS de la tabla ocultaría '
  'al menor la fila de su propio tutor.';

-- ACL — el default de `public` abre EXECUTE a anon y a authenticated POR NOMBRE, así
-- que un REVOKE de `public` a secas no basta. Sin esto, `anon_execute_cerrado` se pone
-- rojo, y con razón: una función SECURITY DEFINER ejecutable por anon es superficie
-- que nadie pidió. (Llamarla directamente fallaría por ser de trigger, pero el censo
-- mide el permiso, no el resultado — y hace bien.)
revoke all on function public.player_accounts_assert_self_con_tutor() from public;
revoke all on function public.player_accounts_assert_self_con_tutor() from anon;
revoke all on function public.player_accounts_assert_self_con_tutor() from authenticated;

-- El DELETE va primero en la lista de eventos a propósito: `UPDATE OF <cols>` lleva
-- lista de columnas y dejarlo en medio hace la declaración más difícil de leer.
drop trigger if exists player_accounts_self_con_tutor on public.player_accounts;
create trigger player_accounts_self_con_tutor
  before insert or delete or update of relation, player_id, profile_id
  on public.player_accounts
  for each row execute function public.player_accounts_assert_self_con_tutor();
