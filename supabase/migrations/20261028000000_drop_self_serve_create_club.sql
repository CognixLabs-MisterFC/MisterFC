-- F15-C2-followup — SEGURIDAD/MODELO: eliminar el autoservicio de crear club.
--
-- create_club_with_admin(text,text,text) es un vestigio de la era self-serve
-- (registro abierto): cualquier authenticated SIN membresías podía crear su
-- "primer club" y quedar como admin_club. Desde F14D (#312) el registro está
-- CERRADO: los clubes los crea SIEMPRE Jose desde la consola de plataforma
-- (platform_create_club, gate is_superadmin) y el admin entra por INVITACIÓN
-- (platform_invite_club_admin → accept_pending_invitations). No existe ninguna
-- vía de autoservicio, así que esta RPC solo es superficie de ataque / deuda.
--
-- La app deja de llamarla (se elimina el formulario de /onboarding, que pasa a
-- ser solo el reencaminador del clubless hacia su invitación). Tras este DROP,
-- el ÚNICO camino para crear un club es platform_create_club (superadmin).
--
-- DROP elimina también el `grant execute ... to authenticated` asociado
-- (20260527153019). Firma verificada en la BD (pg_get_functiondef): (text,text,text).
-- Sin dependencias (pg_depend vacío); no la invoca ninguna otra función.

drop function if exists public.create_club_with_admin(text, text, text);
