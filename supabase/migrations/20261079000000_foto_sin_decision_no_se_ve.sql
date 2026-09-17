-- Una foto sin decisión registrada deja de verse.
--
-- ── EL FALLO ────────────────────────────────────────────────────────────────
--
-- `player_photo_visible` terminaba en `coalesce(..., true)`: si no había NINGUNA fila
-- de `image_internal` para el jugador, la respuesta era «se ve». El silencio contaba
-- como permiso, y esa función es el único portero de la RLS de storage del bucket
-- `player-photos`: el consentimiento no se había dado, y la foto era legible.
--
-- ── LO QUE CAMBIA, MEDIDO EN PRODUCCIÓN ANTES DE ESCRIBIRLO ─────────────────
--
-- 42 jugadores. 6 con foto. 37 sin decisión de `image_internal` registrada. El cruce
-- de las dos cosas —foto Y sin decisión— son **2 jugadores**: son las dos fotos que
-- dejan de verse al aplicar esto. Ninguna retirada, cinco concesiones explícitas.
--
-- Decisión de Jose: se cierra igual, y NO se siembra nada. Son datos de prueba del
-- piloto; no hay ningún menor real detrás de esas dos filas. Sembrar consentimientos
-- para que las fotos siguieran viéndose sería falsificar el ledger.
--
-- ── POR QUÉ UN SOLO SITIO BASTA ─────────────────────────────────────────────
--
-- La pregunta era si cerrar aquí deja la foto accesible por otra vía. No la deja, y
-- está comprobado fichero a fichero: `player_photo_visible` tiene UN solo consumidor
-- en toda la base —la policy `player_photos_select_member` de `storage.objects`—, y
-- en el código los 11 sitios que firman una foto usan el cliente del USUARIO, que
-- pasa por esa policy. `createSignedUrl` la evalúa igual que un SELECT.
--
-- El cliente admin toca ese bucket dos veces y ninguna LEE: la subida del alta por
-- invitación (el vínculo `player_accounts` aún no existe, así que el tutor no pasaría
-- la RLS) y el borrado de `erasures.ts`. La ruta del export RGPD lo dice en su propio
-- comentario: «Devuelve un cliente RLS-scoped al usuario; NUNCA admin».
--
-- ── LO QUE NO SE ROMPE ──────────────────────────────────────────────────────
--
-- El alta por invitación no se entera: sube con el cliente admin ANTES de llamar a la
-- RPC que escribe los consentimientos, así que cuando la foto existe la decisión ya
-- está. Y quien firma hace `data?.signedUrl ?? null`: una foto que no se puede firmar
-- no se pinta, no revienta.
--
-- Lo que SÍ había que arreglar es un test: `rls_storage_player_photos` T2 daba por
-- visible la foto de un jugador de fixture SIN ninguna fila de consentimiento. Su
-- fixture se apoyaba justo en el default que esta migración invierte, y ahora sella
-- la concesión explícita.
--
-- ── UNA CONSECUENCIA QUE CONVIENE SABER ─────────────────────────────────────
--
-- Uno de esos 2 jugadores no tiene NINGUNA cuenta vinculada: nadie puede concederle
-- el consentimiento, porque no hay tutor que entre a darlo. Su foto se vuelve
-- invisible y se queda así hasta que una familia se dé de alta sobre ese jugador. Es
-- el resultado correcto —sin tutor no hay quien consienta— pero no se deshace desde
-- ninguna pantalla.

create or replace function public.player_photo_visible(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when exists (
      select 1 from public.players p where p.id = p_player_id and p.erased_at is not null
    ) then false
    else coalesce((
      select c.granted
      from public.consents c
      where c.player_id = p_player_id and c.consent_type = 'image_internal'
      order by c.accepted_at desc, c.seq desc
      limit 1
    ), false)   -- ← sin decisión registrada NO es permiso
  end;
$function$;

comment on function public.player_photo_visible(uuid) is
  'FALSE si el jugador está suprimido (erased_at), si el último image_internal es granted=false, o si NO HAY NINGUNA FILA: el silencio no es consentimiento (mig 20261079). TRUE solo con una concesión explícita vigente. Chokepoint de la RLS de storage player-photos.';

revoke all on function public.player_photo_visible(uuid) from public;
revoke all on function public.player_photo_visible(uuid) from anon;
grant execute on function public.player_photo_visible(uuid) to authenticated;
grant execute on function public.player_photo_visible(uuid) to service_role;
