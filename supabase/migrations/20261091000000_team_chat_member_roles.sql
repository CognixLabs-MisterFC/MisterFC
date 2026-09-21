-- PUSH-ÁREA — el chat de equipo deja de ser el hueco de la serie.
--
-- DE DÓNDE VIENE ESTO. Los dos PR anteriores (#664, #667) enrutan el push a su área
-- por la AUDIENCIA del aviso: los que se reciben por ser tutor abren familia, los del
-- trabajo abren el área de trabajo. Para los tipos que llegan a DOS audiencias con el
-- mismo nombre, el emisor lo declara en el `data` (`audienceMark`). El chat de equipo
-- se quedó fuera, y esta migración es lo que faltaba para meterlo.
--
-- POR QUÉ NO SE PUDO ANTES. El fan-out del chat usa `team_chat_member_profile_ids`,
-- que devuelve `setof uuid`: una lista PLANA de destinatarios que no dice por qué
-- está cada uno. Y el chat lo componen TRES audiencias a la vez —staff del equipo,
-- familias del roster y dirección del club con participación activa—, así que el
-- emisor recibía un montón de perfiles indistinguibles. Clasificarlos desde el
-- cliente habría exigido releer `team_staff` y `memberships` bajo la RLS de QUIEN
-- ENVÍA, y ahí una familia y un coach no ven lo mismo: una lectura recortada
-- clasificaría a un entrenador como familia y le abriría el área que no es.
--
-- Esta función responde la pregunta entera de una vez y del lado que sí lo sabe.
--
-- LA ANTIGUA NO SE TOCA. `team_chat_member_profile_ids` sigue tal cual: la usan las
-- lecturas del chat y no hay motivo para moverla. Esta es su hermana con el papel.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. team_chat_member_roles — destinatarios del chat CON su papel.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- LAS TRES RAMAS SON LAS MISMAS, CLAVADAS, que las de `team_chat_member_profile_ids`
-- en su versión viva (la de 20261050000000, que añadió los `left_at is null` en las
-- tres). Si esa cambia, esta cambia con ella: son dos vistas del MISMO conjunto, y
-- que dejaran de coincidir significaría notificar a gente distinta de la que lee el
-- chat. Se mantienen a mano porque el papel no se puede derivar de un `setof uuid`.
--
-- UN PAPEL POR PERSONA, Y GANA EL DE TRABAJO. Quien cae en varias ramas —el
-- entrenador que además es padre de un jugador de SU equipo, el director que activó
-- la participación y encima tiene un hijo en la plantilla— sale UNA sola vez:
--
--     staff  >  direction  >  family
--
-- Es la regla que Jose fijó para los festivos («gana staff»), extendida al tercer
-- papel por el mismo motivo: si el equipo es tu trabajo, el chat del equipo es
-- trabajo. Y no es solo estética — el bus deduplica por `user_id`, así que una
-- persona recibe UNA notificación y una sola: si se emitieran dos papeles para ella,
-- el segundo se descartaría en silencio por el UNIQUE de `dedupe_key` y el área
-- dependería del orden de emisión. Aquí se decide una vez, explícitamente.
create or replace function public.team_chat_member_roles(p_team_id uuid)
returns table (profile_id uuid, audience text)
language sql
stable
security definer
set search_path = public
as $$
  with candidatos as (
    -- staff del equipo (vínculo team_staff activo Y membership activa)
    select m.profile_id, 1 as prioridad
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
     where ts.team_id = p_team_id
       and ts.left_at is null
       and m.left_at is null
    union all
    -- admin/director del club con participación ACTIVA en este chat (los observer
    -- no reciben notificaciones) y membership activa
    select m2.profile_id, 2
      from public.memberships m2
      join public.team_chat_participation p
        on p.profile_id = m2.profile_id
       and p.team_id = p_team_id
       and p.mode = 'active'
     where m2.club_id = public.team_club_id(p_team_id)
       and m2.role in ('admin_club', 'director')
       and m2.left_at is null
    union all
    -- jugador/familia del roster vigente (vía player_accounts) con membership activa
    select pa.profile_id, 3
      from public.team_members tm
      join public.player_accounts pa on pa.player_id = tm.player_id
      join public.memberships m3 on m3.profile_id = pa.profile_id
       and m3.club_id = public.team_club_id(p_team_id)
       and m3.left_at is null
     where tm.team_id = p_team_id
       and tm.left_at is null
  )
  -- `union all` arriba y el mínimo aquí: con `union` a secas se perdería la fila de
  -- menor prioridad de quien aparece en dos ramas con papeles distintos, que es
  -- justo el caso que hay que resolver.
  select c.profile_id,
         case min(c.prioridad)
           when 1 then 'staff'
           when 2 then 'direction'
           else 'family'
         end as audience
    from candidatos c
   where c.profile_id is not null
   group by c.profile_id;
$$;

comment on function public.team_chat_member_roles(uuid) is
  'PUSH-ÁREA — destinatarios de notificación del chat del equipo CON su papel: '
  'staff ∪ dirección con participación active ∪ jugador/familia vigentes, todos con '
  'membership activa. Mismas tres ramas que team_chat_member_profile_ids; añade la '
  'audiencia para que el push abra el área correcta. Un papel por persona: gana '
  'staff, luego direction, luego family.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ACL — el patrón de 20261075000000, entero.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nombrar `anon` es obligatorio: `public` es otra entrada de la ACL y revocarla no
-- toca las concesiones directas. Sin esta línea, cualquiera con la anon key podría
-- pedir los miembros del chat de un equipo —y ahora, además, su papel dentro del
-- club—. Es exactamente el agujero que cerró aquella migración para la función
-- hermana; se cierra aquí de nacimiento y no después.
-- SIN GATE POR DENTRO, Y ES UNA DECISIÓN. Se valoró exigir
-- `user_is_team_chat_member(p_team_id)` dentro de la función. No se hace:
--   · quien la llama es el emisor del mensaje, DESPUÉS de que la RLS le haya dejado
--     insertarlo, así que el gate no rechazaría a nadie real;
--   · el único patrón para dejar pasar al `service_role` sería `auth.role()`, que NO
--     se usa en ninguna de las 240 migraciones de este repo. Estrenarlo dentro de una
--     función de seguridad, para un caso que hoy no ocurre, es más riesgo que el que
--     quita: si mañana alguien la llamara con el cliente admin, `auth.uid()` sería
--     NULL, devolvería CERO destinatarios y el chat dejaría de notificar en silencio.
-- La protección es la ACL de abajo, que es la misma que la auditoría de
-- 20261075000000 dejó en la función hermana. Si algún día se quiere el gate, el sitio
-- es este y hace falta decidir antes cómo se identifica al service_role.
revoke all on function public.team_chat_member_roles(uuid) from public;
revoke all on function public.team_chat_member_roles(uuid) from anon;
grant execute on function public.team_chat_member_roles(uuid) to authenticated;
grant execute on function public.team_chat_member_roles(uuid) to service_role;
