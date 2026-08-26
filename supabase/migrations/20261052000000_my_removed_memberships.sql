-- Baja de miembros · Paso 4c — MENSAJE AL DADO DE BAJA (solo la RPC de lectura).
--
-- Un miembro dado de baja pierde el club de su lista (loader paso 3) y cae a la
-- pantalla genérica "sin club" (web /onboarding dead-end, app estado none/spectator)
-- sin saber qué ha pasado. Esta RPC alimenta un banner informativo en esas pantallas:
-- "ya no perteneces a {club}, desde {fecha}".
--
-- SOLO LECTURA y SOLO del usuario actual:
--  · auth.uid() está CABLEADO en el WHERE: no hay parámetro de target, así que no puede
--    devolver la baja de otra persona por más que se manipule la llamada.
--  · NO devuelve left_reason: la razón ("impago", "despido"…) es nota interna del club y
--    ni siquiera viaja al cliente — no está en el returns table.
--
-- Por qué SECURITY DEFINER: un dado de baja ya NO tiene acceso RLS al club (enforcement
-- paso 2), así que un invoker no podría ni leer el NOMBRE del club para el mensaje. El
-- definer lee clubs saltándose RLS, pero solo expone id/nombre/slug/fecha de las filas de
-- baja del PROPIO caller. Un anónimo (auth.uid() null) obtiene cero filas.

create or replace function public.my_removed_memberships()
returns table (club_id uuid, club_name text, club_slug text, left_at date)
language sql
security definer
set search_path to 'public'
stable
as $fn$
  select m.club_id, c.name, c.slug, m.left_at
  from public.memberships m
  join public.clubs c on c.id = m.club_id
  where m.profile_id = auth.uid()
    and m.left_at is not null
  order by m.left_at desc;
$fn$;

comment on function public.my_removed_memberships() is
  'Baja de miembros (Paso 4c). Devuelve club (id/nombre/slug) y fecha de las bajas del usuario ACTUAL (memberships.left_at no nulo). auth.uid() cableado: nunca devuelve bajas de otro. NO expone left_reason. Alimenta el banner informativo de las pantallas sin club (web onboarding, app none/spectator).';

grant execute on function public.my_removed_memberships() to authenticated;
