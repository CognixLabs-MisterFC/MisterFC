-- Imagen-1 · 2/2 — AVISO al club cuando una familia RETIRA el consentimiento de
-- imagen.
--
-- LA DECISIÓN (opción B, Jose): al retirar el consentimiento las fotos ya
-- publicadas **no se retiran solas**. Se avisa al club y las retira él.
--
-- Y hay un motivo medido para que sea así: dentro de MisterFC **sólo existe una
-- foto del jugador**, la de su ficha (`players.photo_url`). El esquema entero no
-- tiene otra columna de imagen de una persona — se barrieron todas: sólo
-- `clubs.logo_path`, `players.photo_url` y `profiles.avatar_url`. Lo que el
-- consentimiento cubre de verdad —la foto en el Instagram del club, en un cartel,
-- en la web— **no está en la base de datos y ningún trigger la puede retirar**. Un
-- borrado automático daría una sensación de cumplimiento que no se corresponde con
-- la realidad; el aviso, no.
--
-- ── DÓNDE SE ENGANCHA, Y POR QUÉ NO EN LA RPC ────────────────────────────────
-- La retirada entra hoy por `revoke_player_consent`, pero el trigger va sobre
-- `consents`: así caza la retirada **venga por donde venga** —esa RPC hoy, el alta
-- o lo que se escriba mañana— sin que nadie tenga que acordarse de llamar al
-- aviso. Es el mismo reparto que `notify_erasure_requested`.
--
-- ── `granted = false` NO SIGNIFICA «HA RETIRADO» ─────────────────────────────
-- Esta es la trampa de este trigger, y sin resolverla el aviso mentiría. El alta
-- inserta `image_internal` / `image_social` con `granted = false` cuando una
-- familia dice que NO **desde el principio** (`accept_pending_invitations`): ahí no
-- hay nada publicado que retirar y avisar al club sería ruido, además de exponer
-- una decisión privada que nadie ha cambiado. Por eso se mira el estado ANTERIOR
-- del mismo (tutor, jugador, tipo) con el MISMO desempate que usa el resto del
-- código (`accepted_at desc, seq desc`): sólo se avisa si lo que había era una
-- concesión viva.
--
-- Se evalúa por TUTOR, igual que `revoke_player_consent`: el consentimiento se
-- sella por tutor y cada uno retira el suyo.
--
-- ── A QUIÉN (decisión de Jose) ───────────────────────────────────────────────
-- Admin y director del club **y el cuerpo técnico de los equipos vivos del
-- jugador**: son los que publican. Se excluye a quien retira, y el `union` colapsa
-- al director que además entrena a ese equipo. Fuera quedan las membresías de baja
-- y el staff que ya dejó el equipo (`left_at`), por lo mismo que en BC-7: quien ya
-- no está no debe seguir recibiendo datos del club.
--
-- ── QUÉ DICE (decisión de Jose) ──────────────────────────────────────────────
-- El payload lleva `consent_type`: el aviso distingue **imagen interna** de
-- **redes sociales**, que es la diferencia entre quitarla del mural del vestuario
-- y quitarla de Instagram. Un aviso genérico no serviría.
--
-- Lo que el payload NO lleva es ningún NOMBRE, y es deliberado (BC-7a): la fila de
-- `notifications` es inmutable por trigger, así que un nombre escrito aquí no se
-- podría limpiar al anonimizar y el aviso acabaría siendo el último rastro de una
-- persona borrada. Van ids; la pantalla resuelve el nombre al pintarlo.
--
-- ── BEST-EFFORT ──────────────────────────────────────────────────────────────
-- Todo el bloque va envuelto: **el aviso no puede tumbar la retirada jamás**. Una
-- familia que retira su consentimiento tiene derecho a que se registre, falle o no
-- la novedad del club. Mismo criterio que `notify_erasure_requested`.

create or replace function public.notify_image_consent_revoked()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_club uuid;
  v_prev boolean;
begin
  begin
    if new.player_id is null then
      return null;
    end if;

    -- ¿Había una concesión viva justo antes de esta fila? Si no, esto no es una
    -- retirada: es un «no» de siempre, y el club no tiene nada que quitar.
    select c.granted
      into v_prev
      from public.consents c
     where c.tutor_profile_id = new.tutor_profile_id
       and c.player_id = new.player_id
       and c.consent_type = new.consent_type
       and c.seq < new.seq
     order by c.accepted_at desc, c.seq desc
     limit 1;

    if v_prev is not true then
      return null;
    end if;

    select p.club_id into v_club from public.players p where p.id = new.player_id;
    if v_club is null then
      return null;
    end if;

    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select d.profile_id,
           'image_consent_revoked'::public.notification_type,
           'in_app'::public.notification_channel,
           jsonb_build_object(
             'player_id', new.player_id,
             'club_id', v_club,
             'consent_type', new.consent_type
           ),
           'image_consent_revoked:' || new.id::text || ':' || d.profile_id::text || ':in_app'
      from (
        -- Dirección del club.
        select m.profile_id
          from public.memberships m
         where m.club_id = v_club
           and m.role in ('admin_club', 'director')
           and m.left_at is null
        union
        -- Cuerpo técnico de los equipos VIVOS del jugador: los que publican.
        select m2.profile_id
          from public.team_members tm
          join public.team_staff ts
            on ts.team_id = tm.team_id
           and ts.left_at is null
          join public.memberships m2
            on m2.id = ts.membership_id
           and m2.left_at is null
         where tm.player_id = new.player_id
           and tm.left_at is null
      ) d
     where d.profile_id <> new.tutor_profile_id
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      -- Best-effort: el aviso NUNCA puede tumbar la retirada.
      raise warning 'notify_image_consent_revoked falló para consents.id=%: %',
        new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.notify_image_consent_revoked() from public;
revoke all on function public.notify_image_consent_revoked() from anon;

drop trigger if exists consents_notify_image_revoked on public.consents;

-- FOR EACH ROW con WHEN: el filtro va en el trigger y no dentro de la función para
-- que una inserción normal de consentimiento (una concesión, un consentimiento de
-- cuenta) ni siquiera entre aquí.
create trigger consents_notify_image_revoked
after insert on public.consents
for each row
when (new.granted = false and new.consent_type in ('image_internal', 'image_social'))
execute function public.notify_image_consent_revoked();
