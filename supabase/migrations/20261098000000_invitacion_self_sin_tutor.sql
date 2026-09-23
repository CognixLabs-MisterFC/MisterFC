-- ════════════════════════════════════════════════════════════════════════════
-- Punto 7 · camino A: la INVITACIÓN de cuenta propia tampoco se crea sin tutor.
--
-- ── QUÉ SE MIDIÓ ────────────────────────────────────────────────────────────
-- `invitations_insert_admin` deja a cualquier admin_club/director insertar
-- `role='jugador'`, `player_relation='self'` sin comprobar que el jugador tenga
-- tutor. Ningún CHECK ni trigger lo frenaba: `invitations_assert_relation_not_mixed`
-- (MN-4) solo mira que la MISMA dirección no figure a la vez como tutor y como
-- cuenta propia, que es otra contradicción.
--
-- Ensayado contra producción con BEGIN…ROLLBACK: invitación → nace la cuenta →
-- `accept_pending_invitations` la acepta → menor con cuenta propia, membresía viva
-- y CERO tutores.
--
-- ── POR QUÉ ESTE TRIGGER SI LA 20261097000000 YA LO IMPIDE ──────────────────
-- Porque el daño no es el mismo. Con solo el guard de `player_accounts`, la
-- invitación SE CREA y el correo SALE: el niño recibe un enlace que no puede
-- terminar, y el error le estalla a él, al aceptar. Con este, el rechazo cae sobre
-- quien crea la invitación, que es quien puede arreglarlo.
--
-- El de `player_accounts` sigue siendo el candado —es la tabla donde aterriza el
-- vínculo, y por ahí pasan todos los caminos—. Este es la señal temprana.
--
-- ── SOLO SOBRE EL MENOR ─────────────────────────────────────────────────────
-- Misma distinción que la 20261097000000, y por el mismo motivo: `relation='self'`
-- es también el jugador ADULTO vinculado a su propia ficha (mig 20261038), que
-- nunca necesitó tutor. La edad la da `player_is_minor` (MN-1), en vivo sobre
-- `players.date_of_birth`.
--
-- La primera versión de la 20261097000000 no distinguía y la suite pgTAP entera la
-- tumbó. Esta nace ya con la distinción: el mismo error con otro nombre no habría
-- salido hasta el CI.
--
-- ── EL ALCANCE DEL UPDATE, QUE NO ES DECORATIVO ─────────────────────────────
-- `update of role, player_id, player_relation, email` y NO un `update` a secas:
-- `accept_pending_invitations` hace `update invitations set accepted_at = now()`
-- por cada fila del lote. Con el trigger abierto a todo UPDATE, aceptar volvería a
-- evaluar la regla — y la evaluaría MAL, porque en ese punto el vínculo del tutor
-- puede haberse retirado legítimamente (la invitación ya está cursada). Aceptar no
-- cambia a quién pertenece la invitación: no hay nada que revisar.
--
-- ── ORDEN DE LOS ERRORES ────────────────────────────────────────────────────
-- `invite_player_self` comprueba el tutor ANTES (`user_is_tutor_of_player`) y
-- responde 'forbidden'. Este trigger no lo ve nunca por el camino bueno, y así
-- sigue: quien usa la vía buena lee el mensaje de siempre.
--
-- ── DATOS ───────────────────────────────────────────────────────────────────
-- Cero reparación. En producción no hay ninguna invitación `self` viva, y las dos
-- históricas fueron a jugadores que tienen tutor.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.invitations_assert_self_con_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo la invitación de CUENTA PROPIA de un jugador. La de tutor (parent/guardian)
  -- es justo la que crea al primer tutor: si se exigiera uno previo, no habría forma
  -- de empezar. La de seguidor no lleva relación y no toca `player_accounts`.
  if new.role <> 'jugador'
     or new.player_id is null
     or new.player_relation is distinct from 'self' then
    return new;
  end if;

  if not public.player_is_minor(new.player_id) then
    return new;
  end if;

  if not exists (
    select 1 from public.player_accounts pa
     where pa.player_id = new.player_id
       and pa.relation in ('parent', 'guardian')
  ) then
    raise exception 'self_sin_tutor'
      using errcode = '23514',
            hint = 'No se puede invitar a un jugador MENOR a tener cuenta propia '
                   'mientras no tenga tutor: el enlace no podría completarse y el '
                   'error le llegaría a él. Vincula primero al tutor.';
  end if;

  return new;
end;
$$;

comment on function public.invitations_assert_self_con_tutor() is
  'Punto 7 (camino A): no se crea una invitación de cuenta propia (player_relation '
  '= self) de un jugador MENOR sin tutor. El candado de verdad es el trigger de '
  'player_accounts (mig 20261097000000); este adelanta el rechazo a quien crea la '
  'invitación, para que el enlace muerto no llegue al niño. El self de un jugador '
  'ADULTO (mig 20261038) no entra: nunca necesitó tutor.';

-- ACL — el default de `public` abre EXECUTE a anon y authenticated POR NOMBRE, así
-- que un REVOKE de `public` a secas no basta; `anon_execute_cerrado` lo mide.
revoke all on function public.invitations_assert_self_con_tutor() from public;
revoke all on function public.invitations_assert_self_con_tutor() from anon;
revoke all on function public.invitations_assert_self_con_tutor() from authenticated;

drop trigger if exists invitations_self_con_tutor on public.invitations;
create trigger invitations_self_con_tutor
  before insert or update of role, player_id, player_relation, email
  on public.invitations
  for each row execute function public.invitations_assert_self_con_tutor();
