-- ─────────────────────────────────────────────────────────────────────────────
-- Punto 1 QA — Compartir una sesión SOLO si está asignada a un entrenamiento.
--
-- DECISIÓN (Jose): una sesión solo se comparte con los jugadores (visibility='team')
-- si está vinculada a un evento de entrenamiento (event_id NO nulo). El entrenador
-- puede seguir planificando sesiones SUELTAS como borrador (visibility='staff'),
-- pero no compartirlas hasta asignarlas. Asignar NO comparte solo: compartir sigue
-- siendo esta acción explícita.
--
-- MOTIVO: en la app nativa las sesiones viven DENTRO de Entrenamientos (#470); la
-- lista independiente de sesiones ya no existe en el móvil, así que una sesión suelta
-- compartida sería invisible para el jugador. En la web `/mi-equipo/sesiones` seguía
-- mostrándola (por equipo+fecha), pero unificamos el criterio en el chokepoint.
--
-- DÓNDE: en el RPC `set_session_shared` (SECURITY DEFINER), único punto server-side
-- por el que pasa cualquier compartir (web y clientes futuros). Se añade el guard con
-- EL MISMO ESTILO que el de plantillas (`template_not_shareable`): raise + errcode
-- insufficient_privilege. Solo aplica al COMPARTIR (p_shared=true); descompartir una
-- sesión suelta antigua (p_shared=false → 'staff') sigue permitido.
--
-- NO se usa un CHECK de BD a propósito (Jose): un CHECK bloquearía de raíz y es más
-- difícil de revertir si mañana cambia el criterio; el RPC es suficiente.
--
-- Recreada desde su DEFINICIÓN VIVA (`pg_get_functiondef`, la de la migración
-- 20261026000000_fix_null_gate_propagation, que usa `user_is_admin_or_director`).
-- Único cambio vs. la def viva: se selecciona también `event_id` y se añade el guard
-- `p_shared and v_event_id is null -> session_not_assigned`. Resto IDÉNTICO.
-- Datos existentes: NO se limpian (son de prueba; pueden quedar sueltas compartidas
-- de antes — no rompen nada, solo no vuelven a poder marcarse si se descomparten).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_session_shared(p_session_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_team_id     uuid;
  v_club_id     uuid;
  v_is_template boolean;
  v_event_id    uuid;
begin
  select team_id, club_id, is_template, event_id
    into v_team_id, v_club_id, v_is_template, v_event_id
  from public.sessions
  where id = p_session_id;

  if v_club_id is null then
    raise exception 'session_not_found' using errcode = 'no_data_found';
  end if;

  if v_is_template then
    raise exception 'template_not_shareable' using errcode = 'insufficient_privilege';
  end if;

  -- Punto 1 QA — solo se COMPARTE (p_shared=true) una sesión asignada a un
  -- entrenamiento (event_id no nulo). Descompartir no lo exige (limpieza).
  if p_shared and v_event_id is null then
    raise exception 'session_not_assigned' using errcode = 'insufficient_privilege';
  end if;

  -- Gate: staff del equipo de la sesión ∪ admin_club/director del club ∪ superadmin.
  if not (
    public.user_is_staff_of_team(v_team_id)
    or public.user_is_admin_or_director(v_club_id)
    or public.is_superadmin()
  ) then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  update public.sessions
     set visibility = case when p_shared then 'team' else 'staff' end
   where id = p_session_id;
end;
$function$;

comment on function public.set_session_shared(uuid, boolean) is
  'F14E-4 (+ punto 1 QA) — Comparte (p_shared=true → visibility=team) o descomparte '
  '(false → staff) una sesión con los jugadores/familias de su equipo. Requisitos para '
  'COMPARTIR: no plantilla y ASIGNADA a un entrenamiento (event_id no nulo). Gate: staff '
  'del equipo (principal/ayudante) ∪ admin_club/director ∪ superadmin. NO cambia la RLS.';

revoke all on function public.set_session_shared(uuid, boolean) from public;
grant execute on function public.set_session_shared(uuid, boolean) to authenticated;
