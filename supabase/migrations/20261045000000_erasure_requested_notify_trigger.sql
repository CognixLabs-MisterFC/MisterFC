-- D6 PR-A (paso 1) — TRIGGER que emite la novedad 'erasure_requested' a dirección.
--
-- Por qué un trigger y no el TS: la solicitud de supresión nace en DOS orígenes que
-- solo comparten esta tabla — la web (server action) y la app NATIVA (el tutor llama
-- la RPC request_player_erasure directo, sin service-role). Emitir en el TS de la web
-- dejaría sin aviso la vía principal (el tutor desde su móvil). El trigger cubre ambos.
--
-- ADITIVO: CREATE FUNCTION + CREATE TRIGGER nuevos. NO toca request_player_erasure ni
-- ninguna función existente. Solo channel='in_app' (ni una fila push). Destinatarios:
-- admin_club y directores del club; el solicitante NO se auto-notifica. Dedupe por
-- erasure_requests.id (+ destinatario). La aplica Jose; no requiere db:types.
--
-- GARANTÍA DE NO CAÍDA: un trigger AFTER INSERT corre en la MISMA transacción que el
-- INSERT; si lanzara una excepción, la solicitud de supresión se anularía. Por eso todo
-- el cuerpo va en un bloque BEGIN ... EXCEPTION WHEN OTHERS: PL/pgSQL abre ahí una
-- subtransacción (savepoint), así que cualquier fallo al notificar se captura y revierte
-- SOLO a ese savepoint — la fila de erasure_requests queda intacta y hace commit. Un
-- aviso perdido es leve (se registra un WARNING); una supresión RGPD sin registrar sería
-- grave, y eso no puede pasar.

create or replace function public.notify_erasure_requested()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      m.profile_id,
      'erasure_requested'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object('erasure_request_id', new.id, 'player_id', new.player_id),
      'erasure_requested:' || new.id::text || ':' || m.profile_id::text || ':in_app'
    from public.memberships m
    where m.club_id = new.club_id
      and m.role in ('admin_club', 'director')
      and m.profile_id <> new.requested_by
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      -- Best-effort: el aviso NUNCA puede tumbar la solicitud de supresión.
      raise warning 'notify_erasure_requested falló para erasure_requests.id=%: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.notify_erasure_requested() is
  'D6 — emite novedad in_app (sin push) a admin_club+directores del club cuando se crea una solicitud de supresión. Best-effort: los fallos se capturan y NO revierten la solicitud.';

create trigger trg_notify_erasure_requested
  after insert on public.erasure_requests
  for each row
  when (new.status = 'pending')
  execute function public.notify_erasure_requested();
