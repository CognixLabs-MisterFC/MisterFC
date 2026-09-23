-- ─────────────────────────────────────────────────────────────────────────────
-- Recibos de Expo Push: sin esto, "enviado" es mentira.
--
-- El emisor manda a Expo y guarda el TICKET. Un ticket `ok` solo dice que Expo
-- ACEPTO el mensaje; si FCM lo rechaza —el caso normal cuando alguien reinstala
-- la app— el error aparece en el RECIBO, que se pide despues por ticket_id.
--
-- Medido en produccion el 2026-09-22: los 7 tokens vivos devolvian ticket `ok` y
-- recibo `DeviceNotRegistered`. Las filas de `notifications` llevaban meses
-- marcandose `sent` y no llegaba una sola notificacion al telefono. La limpieza
-- de tokens muertos (`isDeviceNotRegistered`) solo miraba TICKETS, donde ese
-- error no aparece nunca: era codigo muerto.
--
-- Esta tabla es la cola de tickets pendientes de comprobar. El cron horario los
-- resuelve y BORRA la fila: no es un historico, es una cola. Expo guarda los
-- recibos 24 h, asi que lo que no se resuelva en un dia se descarta solo.
--
-- CERRADA AL CLIENTE, como `player_medical`: RLS activa y CERO policies. La
-- escribe y la lee unicamente el service_role (el emisor y el cron). Un token de
-- push es un identificador de dispositivo: no hay ninguna razon para que un
-- cliente lea la cola de otro, ni la suya.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.expo_push_tickets (
  -- El id que devuelve Expo al aceptar el mensaje. Es la clave con la que se pide
  -- el recibo, asi que es la clave primaria natural.
  ticket_id text primary key,
  -- El token al que iba. Se guarda AQUI y no se deduce despues: cuando el recibo
  -- diga DeviceNotRegistered hay que borrar este token, y para entonces la fila de
  -- expo_push_tokens puede haber cambiado de dueño (UNIQUE(token) + upsert).
  token text not null,
  -- La notificacion que lo origino, para poder corregir su `status`. ON DELETE
  -- CASCADE: si se borra la notificacion, su cola de tickets sobra.
  notification_id uuid references public.notifications(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- El cron pide los mas antiguos primero y descarta los de mas de 24 h.
create index if not exists expo_push_tickets_created_at_idx
  on public.expo_push_tickets (created_at);

alter table public.expo_push_tickets enable row level security;

-- Sin policies a proposito (ver cabecera). El REVOKE explicito no sobra: los
-- default privileges del proyecto abren las tablas nuevas a anon/authenticated
-- POR NOMBRE, y un GRANT por nombre no lo frena la ausencia de policies cuando
-- la sentencia es TRUNCATE, que no pasa por RLS.
revoke all on public.expo_push_tickets from public;
revoke all on public.expo_push_tickets from anon;
revoke all on public.expo_push_tickets from authenticated;
