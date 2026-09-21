-- Las invitaciones de SEGUIDOR quedan fuera del UPDATE de cliente (mig 20261090000000).
--
-- El INSERT lleva desde F14C-2 un guard `role <> 'spectator'`: un cliente no crea
-- invitaciones de seguidor, las crea la RPC `invite_spectator` con su gate de
-- tutor/self. Al UPDATE le faltaba, y eso dejaba dos vías abiertas para el gestor del
-- club: fabricar un seguidor a partir de una invitación de club, y —peor— coger la
-- invitación de la abuela y CONVERTIRLA en una de tutor.
--
-- Cubre:
--   [1] Un gestor NO convierte una invitación de club en una de seguidor. Pasa el
--       USING (es de su club) y choca con el WITH CHECK → 42501.
--   [2] Un gestor NO toca una fila de seguidor: ni para cambiarle el correo…
--   [3] …ni para convertirla en una de tutor, que es la vía que el WITH CHECK por sí
--       solo NO cerraba. Las dos fallan por el USING → 0 filas, sin excepción.
--   [4] CONTROL — lo que debe seguir funcionando: el gestor renueva la invitación de
--       tutor y la de club, como siempre.
--   [5] CONTROL — cancelar la invitación de un seguidor sigue permitido: el DELETE no
--       se toca en esta migración.
--   [6] CONTROL — el camino exento de RLS (service-role: `linkInvitedUser`) sigue
--       pudiendo enlazar el `invited_user_id` de un seguidor. Si esto cayera, el
--       seguidor invitado quedaría en la trampa de /invite.
--
-- Las dos formas de fallar NO son lo mismo, y el test usa la que toca en cada caso:
-- el USING no lanza (afecta 0 filas), el WITH CHECK sí (42501). Un test que solo
-- capturara excepciones daría verde sin comprobar [2] ni [3].
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('5bec0000-0000-4000-8000-000000000001', 'owner@spec.test');
select pg_temp.new_test_user('5bec0000-0000-4000-8000-000000000002', 'seguidor@spec.test');

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('5bec1000-0000-4000-8000-000000000001', 'Club Seguidor', 'club-seguidor',
   '5bec0000-0000-4000-8000-000000000001');

insert into public.memberships (profile_id, club_id, role) values
  ('5bec0000-0000-4000-8000-000000000001', '5bec1000-0000-4000-8000-000000000001', 'admin_club');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5bec2000-0000-4000-8000-000000000001', '5bec1000-0000-4000-8000-000000000001',
   'Menor', 'Seguido', '2014-07-07');

-- La de la abuela: role='spectator', con player_id y SIN relacion (rama (d) del
-- CHECK invitations_player_role_consistency).
insert into public.invitations (id, email, club_id, role, player_id, created_by, expires_at)
values ('5bec3000-0000-4000-8000-000000000001', 'abuela@spec.test',
        '5bec1000-0000-4000-8000-000000000001', 'spectator',
        '5bec2000-0000-4000-8000-000000000001',
        '5bec0000-0000-4000-8000-000000000001', now() + interval '7 days');

-- La del tutor del mismo menor.
insert into public.invitations (id, email, club_id, role, player_id, player_relation, created_by, expires_at)
values ('5bec3000-0000-4000-8000-000000000002', 'tutor@spec.test',
        '5bec1000-0000-4000-8000-000000000001', 'jugador',
        '5bec2000-0000-4000-8000-000000000001', 'parent',
        '5bec0000-0000-4000-8000-000000000001', now() + interval '7 days');

-- Y una de club, sin jugador.
insert into public.invitations (id, email, club_id, role, created_by, expires_at)
values ('5bec3000-0000-4000-8000-000000000003', 'staff@spec.test',
        '5bec1000-0000-4000-8000-000000000001', 'entrenador_ayudante',
        '5bec0000-0000-4000-8000-000000000001', now() + interval '7 days');

-- ═════════════════════════════════════════════════════════════════════════════
-- EL GESTOR DEL CLUB (admin_club y ademas owner)
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5bec0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- [1] No fabrica un seguidor desde una invitacion de club. El WITH CHECK lanza.
--     (Hay que poner tambien player_id y quitar la relacion, o lo pararia antes el
--      CHECK de coherencia y el test daria verde por el motivo equivocado.)
do $$
begin
  update public.invitations
     set role = 'spectator',
         player_id = '5bec2000-0000-4000-8000-000000000001',
         player_relation = null
   where id = '5bec3000-0000-4000-8000-000000000003';
  raise exception 'FAIL [1]: un gestor fabrico una invitacion de SEGUIDOR con un UPDATE';
exception when insufficient_privilege then null;
end $$;

-- [2] No toca la fila del seguidor ni para cambiarle el correo. El USING no lanza:
--     no ve la fila, afecta 0 filas.
do $$
declare n int;
begin
  update public.invitations set email = 'otra@spec.test'
   where id = '5bec3000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL [2]: un gestor cambio el correo de una invitacion de seguidor (% filas)', n;
  end if;
end $$;

-- [3] Ni para convertirla en una de tutor. Esta es la que el WITH CHECK por si solo
--     NO cerraba: el resultado seria 'jugador', que pasa el guard.
do $$
declare n int;
begin
  update public.invitations
     set role = 'jugador', player_relation = 'parent', email = 'ladron@spec.test'
   where id = '5bec3000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL [3]: un gestor convirtio la invitacion de un seguidor en una de tutor (% filas)', n;
  end if;
end $$;

-- [4] CONTROL — lo de siempre sigue: renovar la de tutor y la de club.
do $$
declare n int;
begin
  update public.invitations
     set token = gen_random_uuid(), expires_at = now() + interval '7 days'
   where id = '5bec3000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [4a]: el gestor ya no renueva la invitacion de tutor (% filas)', n; end if;

  update public.invitations
     set token = gen_random_uuid(), expires_at = now() + interval '7 days'
   where id = '5bec3000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [4b]: el gestor ya no renueva la invitacion de club (% filas)', n; end if;
end $$;

-- [5] CONTROL — cancelar la del seguidor sigue permitido (el DELETE no se toca).
savepoint s_borrado;
do $$
declare n int;
begin
  delete from public.invitations where id = '5bec3000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL [5]: el gestor ya no puede CANCELAR la invitacion de un seguidor (% filas)', n;
  end if;
end $$;
rollback to savepoint s_borrado;

-- ANCLA POSITIVA — que los ceros de [2] y [3] no vengan de una fila que no existe.
-- Como postgres, la del seguidor sigue EXACTA.
reset role;
do $$
declare v record;
begin
  select email, role, player_relation into v
    from public.invitations where id = '5bec3000-0000-4000-8000-000000000001';
  if not found then
    raise exception 'FAIL [ancla]: la invitacion de seguidor del fixture no existe; [2] y [3] no probaron nada';
  end if;
  if v.email <> 'abuela@spec.test' or v.role <> 'spectator' or v.player_relation is not null then
    raise exception 'FAIL [ancla]: la fila del seguidor cambio pese a los 0 filas (correo=%, rol=%, relacion=%)',
      v.email, v.role, v.player_relation;
  end if;
end $$;

-- [6] CONTROL — el camino exento de RLS sigue enlazando al seguidor. Es lo que hace
--     linkInvitedUser con service-role tras crear su cuenta; si cayera, el seguidor
--     invitado acabaria en la trampa de /invite.
do $$
declare n int;
begin
  update public.invitations set invited_user_id = '5bec0000-0000-4000-8000-000000000002'
   where id = '5bec3000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL [6]: el camino exento de RLS ya no enlaza al seguidor (% filas)', n;
  end if;
end $$;

rollback;
