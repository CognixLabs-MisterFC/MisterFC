-- D2 — RPCs de solo lectura para la UI de "subir jugadores". Reutilizan la
-- lógica AUTORITATIVA de D1 (is_promotion_target_superior) para que el picker
-- muestre exactamente lo que el trigger aceptará. Ambas son SECURITY DEFINER y
-- están GATED por user_can_manage_callup(evento) → solo el gestor del evento
-- superior (admin/coord ∪ principal/ayudante-cap) obtiene filas; cualquier otro
-- recibe 0 filas (no fuga de datos).

-- ─────────────────────────────────────────────────────────────────────────────
-- promotion_candidates(event) — jugadores del club cuyo equipo BASE es INFERIOR
-- al equipo del evento (y que aún no están subidos a ESE evento).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.promotion_candidates(p_event_id uuid)
returns table (
  player_id          uuid,
  first_name         text,
  last_name          text,
  dorsal             int,
  base_team_name     text,
  base_category_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.player_id, s.first_name, s.last_name, s.dorsal,
         s.base_team_name, s.base_category_name
  from (
    select distinct on (p.id)
      p.id                                   as player_id,
      p.first_name                           as first_name,
      p.last_name                            as last_name,
      p.dorsal                               as dorsal,
      t.name                                 as base_team_name,
      c.name                                 as base_category_name,
      public.category_kind_ordinal(c.kind)   as ord
    from public.events e
    join public.players p       on p.club_id = e.club_id
    join public.team_members tm on tm.player_id = p.id and tm.left_at is null
    join public.teams t         on t.id = tm.team_id
    join public.categories c    on c.id = t.category_id
    where e.id = p_event_id
      and public.user_can_manage_callup(p_event_id)
      and public.is_promotion_target_superior(p.id, e.id)
      and not exists (
        select 1 from public.player_promotions pp
         where pp.player_id = p.id and pp.event_id = e.id
      )
    order by p.id, public.category_kind_ordinal(c.kind) desc
  ) s
  order by s.ord desc, s.last_name, s.first_name;
$$;

comment on function public.promotion_candidates(uuid) is
  'D2 — jugadores elegibles para subir a un evento (equipo base inferior al del evento). Gated por user_can_manage_callup(evento); reutiliza is_promotion_target_superior. Excluye ya-subidos a ese evento.';

grant execute on function public.promotion_candidates(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- promotion_conflicts(player, event) — eventos del jugador que SOLAPAN la franja
-- del evento destino: eventos de su(s) equipo(s) base activo(s) + otras subidas.
-- Aviso (NO bloqueo): la UI muestra estos solapes antes de confirmar.
-- ends_at nulo se trata como starts_at + 90 min (ventana por defecto).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.promotion_conflicts(p_player_id uuid, p_event_id uuid)
returns table (
  event_id   uuid,
  title      text,
  team_name  text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  source     text
)
language sql
stable
security definer
set search_path = public
as $$
  with tgt as (
    select e.starts_at                                          as s,
           coalesce(e.ends_at, e.starts_at + interval '90 minutes') as e_end
    from public.events e
    where e.id = p_event_id
  )
  -- Eventos de los equipos activos del jugador (su equipo base).
  select e.id, e.title, t.name, e.starts_at, e.ends_at, 'team'::text as source
  from tgt
  cross join public.team_members tm
  join public.events e on e.team_id = tm.team_id
  join public.teams  t on t.id = e.team_id
  where public.user_can_manage_callup(p_event_id)
    and tm.player_id = p_player_id
    and tm.left_at is null
    and e.id <> p_event_id
    and e.starts_at < tgt.e_end
    and coalesce(e.ends_at, e.starts_at + interval '90 minutes') > tgt.s

  union all

  -- Otras subidas del mismo jugador.
  select e.id, e.title, t.name, e.starts_at, e.ends_at, 'promotion'::text as source
  from tgt
  cross join public.player_promotions pp
  join public.events e on e.id = pp.event_id
  join public.teams  t on t.id = pp.team_id
  where public.user_can_manage_callup(p_event_id)
    and pp.player_id = p_player_id
    and pp.event_id <> p_event_id
    and e.starts_at < tgt.e_end
    and coalesce(e.ends_at, e.starts_at + interval '90 minutes') > tgt.s

  order by starts_at;
$$;

comment on function public.promotion_conflicts(uuid, uuid) is
  'D2 — eventos del jugador que solapan la franja del evento destino (equipo base + otras subidas). Gated por user_can_manage_callup(evento). Solo informativo (avisar, no bloquear).';

grant execute on function public.promotion_conflicts(uuid, uuid) to authenticated;
