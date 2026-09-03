-- F14-3c (revisión) — La FOTO deja de ser opcional... perdón: deja de ser
-- OBLIGATORIA en el alta. Las DECISIONES de imagen no.
--
-- POR QUÉ EXISTE ESTE FICHERO: `accept_pending_invitations` es el alta de TODAS
-- las familias —memberships, vínculo tutor-hijo, consentimientos RGPD, foto,
-- datos médicos, todo en una transacción— y no tenía NI UN test. Un error aquí
-- deja gente fuera, y no se ve hasta que un padre no puede entrar.
--
-- Invariantes:
--   T0. La migración está aplicada (si no, el resto no significa nada).
--   T1. Alta SIN foto: se completa, sella los dos consents y deja photo_url NULL.
--   T2. Decir NO a la imagen interna: se completa, sin foto, consent granted=false.
--   T3. Hijo del lote sin decisiones ⇒ `image_decision_required` (antes decía
--       `image_required`, que era mentira: lo que faltaba eran las decisiones).
--   T4. Path de la carpeta de OTRO jugador ⇒ `image_required`. El guard sigue vivo.
--   T5. Jugador con foto PREVIA que acepta sin subir ninguna: LA CONSERVA.
--       Con el UPDATE incondicional de antes la perdía; verificado contra
--       producción aplicando la variante sin guard.
--   T6. Lote de DOS hijos, uno con foto y otro sin ella: se aceptan LOS DOS, y
--       los cuatro consentimientos de imagen quedan sellados igual.
\ir helpers/auth_users.sql

begin;

-- ── T0: sin la migración, el resto no tiene sentido. Mensaje explícito. ──
do $$
begin
  if (select pg_get_functiondef(p.oid) from pg_proc p
      where p.proname = 'accept_pending_invitations' and p.prokind = 'f'
        and p.pronamespace = 'public'::regnamespace) not like '%if v_path is not null then%'
  then
    raise exception 'FAIL [T0]: accept_pending_invitations sin el guard de photo_url — la migración de la foto opcional no está aplicada en esta BD';
  end if;
end $$;

-- ── Scaffold ────────────────────────────────────────────────────────────────
-- Un club por caso: el ancla del lote es (email + club_id), así que clubs
-- distintos mantienen los casos aislados sin tener que deshacer nada entre uno
-- y otro. Crear el club ya siembra sus legal_documents v1 (trigger), incluidos
-- los de imagen: por eso aquí NO se insertan.
select pg_temp.new_test_user(
  'f1460000-1111-1111-1111-111111111111', 'tutor-foto@ts.test', '{}'::jsonb
);

insert into public.clubs (id, name, slug) values
  ('f1460000-cccc-0000-0000-000000000001', 'Club Foto T1', 'foto-opcional-t1'),
  ('f1460000-cccc-0000-0000-000000000002', 'Club Foto T2', 'foto-opcional-t2'),
  ('f1460000-cccc-0000-0000-000000000003', 'Club Foto T3', 'foto-opcional-t3'),
  ('f1460000-cccc-0000-0000-000000000004', 'Club Foto T4', 'foto-opcional-t4'),
  ('f1460000-cccc-0000-0000-000000000005', 'Club Foto T5', 'foto-opcional-t5'),
  ('f1460000-cccc-0000-0000-000000000006', 'Club Foto T6', 'foto-opcional-t6');

insert into public.seasons (id, club_id, label, status)
select ('f1460000-5ea5-0000-0000-00000000000' || n)::uuid,
       ('f1460000-cccc-0000-0000-00000000000' || n)::uuid,
       '2025-26', 'active'
from generate_series(1, 6) as n;

-- Un menor por caso (el T6 lleva dos: es el lote).
insert into public.players (id, club_id, first_name, last_name, date_of_birth, photo_url) values
  ('f1460000-0000-aaaa-0000-000000000001', 'f1460000-cccc-0000-0000-000000000001', 'Menor', 'Uno',    '2015-04-12', null),
  ('f1460000-0000-aaaa-0000-000000000002', 'f1460000-cccc-0000-0000-000000000002', 'Menor', 'Dos',    '2015-04-12', null),
  ('f1460000-0000-aaaa-0000-000000000003', 'f1460000-cccc-0000-0000-000000000003', 'Menor', 'Tres',   '2015-04-12', null),
  ('f1460000-0000-aaaa-0000-000000000004', 'f1460000-cccc-0000-0000-000000000004', 'Menor', 'Cuatro', '2015-04-12', null),
  -- T5 nace CON foto: la subió el tutor desde su ficha, antes de esta invitación.
  ('f1460000-0000-aaaa-0000-000000000005', 'f1460000-cccc-0000-0000-000000000005', 'Menor', 'Cinco',  '2015-04-12',
   'f1460000-0000-aaaa-0000-000000000005/previa.jpg'),
  ('f1460000-0000-aaaa-0000-000000000006', 'f1460000-cccc-0000-0000-000000000006', 'Menor', 'Seis',   '2015-04-12', null),
  ('f1460000-0000-aaaa-0000-000000000007', 'f1460000-cccc-0000-0000-000000000006', 'Menor', 'Siete',  '2017-09-15', null);

-- Las dos últimas son el LOTE del T6: un padre recibe UNA invitación por hijo,
-- cada una con su token, y al pulsar el enlace de cualquiera se procesan TODAS
-- las pendientes de ese (email + club). El T6 pulsa la del primer hijo.
insert into public.invitations (id, token, email, club_id, role, player_id, player_relation) values
  ('f1460000-0000-11a1-0000-000000000001', 'f1460000-7043-0000-0000-000000000001', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000001', 'jugador', 'f1460000-0000-aaaa-0000-000000000001', 'parent'),
  ('f1460000-0000-11a2-0000-000000000002', 'f1460000-7043-0000-0000-000000000002', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000002', 'jugador', 'f1460000-0000-aaaa-0000-000000000002', 'parent'),
  ('f1460000-0000-11a3-0000-000000000003', 'f1460000-7043-0000-0000-000000000003', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000003', 'jugador', 'f1460000-0000-aaaa-0000-000000000003', 'parent'),
  ('f1460000-0000-11a4-0000-000000000004', 'f1460000-7043-0000-0000-000000000004', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000004', 'jugador', 'f1460000-0000-aaaa-0000-000000000004', 'parent'),
  ('f1460000-0000-11a5-0000-000000000005', 'f1460000-7043-0000-0000-000000000005', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000005', 'jugador', 'f1460000-0000-aaaa-0000-000000000005', 'parent'),
  ('f1460000-0000-11a6-0000-000000000006', 'f1460000-7043-0000-0000-000000000006', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000006', 'jugador', 'f1460000-0000-aaaa-0000-000000000006', 'parent'),
  ('f1460000-0000-11a7-0000-000000000007', 'f1460000-7043-0000-0000-000000000007', 'tutor-foto@ts.test', 'f1460000-cccc-0000-0000-000000000006', 'jugador', 'f1460000-0000-aaaa-0000-000000000007', 'parent');

-- El RPC lee auth.uid().
select set_config('request.jwt.claim.sub', 'f1460000-1111-1111-1111-111111111111', true);

-- ── T1 · alta SIN foto ──────────────────────────────────────────────────────
do $$
declare
  v_player uuid := 'f1460000-0000-aaaa-0000-000000000001';
  v_procesadas int;
begin
  select public.accept_pending_invitations(
    'f1460000-7043-0000-0000-000000000001', true, true, null, 'pgtap',
    jsonb_build_object(v_player::text, jsonb_build_object('internal', true, 'social', false)),
    '{}'::jsonb
  ) into v_procesadas;

  if v_procesadas <> 1 then
    raise exception 'FAIL [T1]: esperaba 1 invitación procesada, salieron %', v_procesadas;
  end if;
  if (select photo_url from public.players where id = v_player) is not null then
    raise exception 'FAIL [T1]: sin foto, photo_url debería seguir NULL';
  end if;
  if not exists (
    select 1 from public.consents
    where player_id = v_player and consent_type = 'image_internal' and granted
  ) then
    raise exception 'FAIL [T1]: falta el consentimiento de imagen interna';
  end if;
  if not exists (
    select 1 from public.consents
    where player_id = v_player and consent_type = 'image_social' and not granted
  ) then
    raise exception 'FAIL [T1]: falta el consentimiento de redes (denegado)';
  end if;
  if not exists (
    select 1 from public.player_accounts
    where player_id = v_player and profile_id = 'f1460000-1111-1111-1111-111111111111'
  ) then
    raise exception 'FAIL [T1]: el alta no ha creado el vínculo tutor-hijo';
  end if;
end $$;

-- ── T2 · dice NO a la imagen interna: no se le pide foto ni se guarda ────────
do $$
declare v_player uuid := 'f1460000-0000-aaaa-0000-000000000002';
begin
  perform public.accept_pending_invitations(
    'f1460000-7043-0000-0000-000000000002', true, true, null, 'pgtap',
    jsonb_build_object(v_player::text, jsonb_build_object('internal', false, 'social', false)),
    '{}'::jsonb
  );
  if (select photo_url from public.players where id = v_player) is not null then
    raise exception 'FAIL [T2]: ha guardado foto de un menor cuya familia dijo que NO';
  end if;
  if not exists (
    select 1 from public.consents
    where player_id = v_player and consent_type = 'image_internal' and not granted
  ) then
    raise exception 'FAIL [T2]: la negativa no ha quedado sellada en el ledger';
  end if;
end $$;

-- ── T3 · sin decisiones ⇒ image_decision_required ────────────────────────────
do $$
begin
  begin
    perform public.accept_pending_invitations(
      'f1460000-7043-0000-0000-000000000003', true, true, null, 'pgtap', '{}'::jsonb, '{}'::jsonb
    );
    raise exception 'FAIL [T3]: ha aceptado el alta sin las decisiones de imagen';
  exception when others then
    if sqlerrm <> 'image_decision_required' then
      raise exception 'FAIL [T3]: esperaba image_decision_required y salió %', sqlerrm;
    end if;
  end;
end $$;

-- ── T4 · path de la carpeta de OTRO jugador ⇒ image_required ─────────────────
do $$
declare v_player uuid := 'f1460000-0000-aaaa-0000-000000000004';
begin
  begin
    perform public.accept_pending_invitations(
      'f1460000-7043-0000-0000-000000000004', true, true, null, 'pgtap',
      jsonb_build_object(v_player::text, jsonb_build_object(
        'internal', true, 'social', true,
        'path', 'f1460000-0000-aaaa-0000-000000000001/robada.jpg')),
      '{}'::jsonb
    );
    raise exception 'FAIL [T4]: ha aceptado un path de la carpeta de otro jugador';
  exception when others then
    if sqlerrm <> 'image_required' then
      raise exception 'FAIL [T4]: esperaba image_required y salió %', sqlerrm;
    end if;
  end;
end $$;

-- ── T5 · foto previa CONSERVADA (el cambio que más importa) ──────────────────
do $$
declare
  v_player uuid := 'f1460000-0000-aaaa-0000-000000000005';
  v_previa text := 'f1460000-0000-aaaa-0000-000000000005/previa.jpg';
  v_despues text;
begin
  perform public.accept_pending_invitations(
    'f1460000-7043-0000-0000-000000000005', true, true, null, 'pgtap',
    jsonb_build_object(v_player::text, jsonb_build_object('internal', true, 'social', true)),
    '{}'::jsonb
  );
  select photo_url into v_despues from public.players where id = v_player;
  if v_despues is distinct from v_previa then
    raise exception 'FAIL [T5]: el alta sin foto ha pisado la que ya tenía (antes=%, después=%)',
      v_previa, coalesce(v_despues, 'NULL');
  end if;
end $$;

-- ── T6 · lote de DOS hijos: uno con foto y otro sin ella ────────────────────
do $$
declare
  v_p1 uuid := 'f1460000-0000-aaaa-0000-000000000006';
  v_p2 uuid := 'f1460000-0000-aaaa-0000-000000000007';
  v_procesadas int;
  v_consents int;
begin
  select public.accept_pending_invitations(
    'f1460000-7043-0000-0000-000000000006', true, true, null, 'pgtap',
    jsonb_build_object(
      v_p1::text, jsonb_build_object('internal', true, 'social', false,
                                     'path', v_p1::text || '/nueva.jpg'),
      v_p2::text, jsonb_build_object('internal', true, 'social', true)),
    '{}'::jsonb
  ) into v_procesadas;

  if v_procesadas <> 2 then
    raise exception 'FAIL [T6]: esperaba 2 invitaciones procesadas, salieron %', v_procesadas;
  end if;
  if (select photo_url from public.players where id = v_p1) <> v_p1::text || '/nueva.jpg' then
    raise exception 'FAIL [T6]: el hijo que SÍ subió foto no la tiene';
  end if;
  if (select photo_url from public.players where id = v_p2) is not null then
    raise exception 'FAIL [T6]: el hijo que NO subió foto ha acabado con una';
  end if;

  select count(*) into v_consents from public.consents
   where player_id in (v_p1, v_p2) and consent_type in ('image_internal', 'image_social');
  if v_consents <> 4 then
    raise exception 'FAIL [T6]: esperaba 4 consentimientos de imagen en el lote, hay %', v_consents;
  end if;
end $$;

rollback;
