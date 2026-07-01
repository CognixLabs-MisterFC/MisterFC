-- D1 — "Subir jugadores" a equipos superiores · MODELO + jerarquía + RLS.
--
-- Spec/decisión: análisis D0 (matriz + decisiones D1–D9). Producto: un jugador
-- puede ENTRENAR o JUGAR con un equipo SUPERIOR al suyo, sin salir de su equipo
-- base. La subida se REGISTRA (no mueve al jugador) y es seguimiento visible por
-- la familia. Esta migración monta SOLO el modelo (sin UI, sin notificación, sin
-- detección de conflicto — esos son D2/D3/D4).
--
-- Piezas (Regla #11, decisiones cerradas):
--   1. category_kind_ordinal(text)          — materializa CATEGORY_KIND_ORDER de
--      packages/core (hoy solo en TS) para poder validar "superior" en BD.
--   2. is_promotion_target_superior(player, event) — TRUE si el equipo del evento
--      es superior al equipo BASE del jugador: la CATEGORÍA manda (mayor ordinal
--      de kind gana aunque la división sea peor); a IGUAL categoría, división
--      superior = menor ordinal en substitution_regimes. Nunca mismo/inferior;
--      kind nulo en destino → no válido.
--   3. player_promotions                     — registro de la subida (NO crea
--      team_members: regla #1 "no se mueve").
--   4. trigger BEFORE INSERT                  — deriva team_id/club_id/kind del
--      evento, guard cross-club, other→rechaza, exige superioridad.
--   5. RLS                                    — SELECT: admin/coord ∪ staff del
--      equipo superior ∪ staff del equipo base ∪ familia (siempre); INSERT/DELETE:
--      user_can_manage_callup(event) (admin/coord ∪ principal/ayudante-cap del
--      equipo superior — incluye admin/coord EXPLÍCITO, gotcha team_staff vs rol).
--
-- INVARIANTE "1 equipo base": el helper toma el equipo activo (left_at IS NULL)
-- del jugador; si hubiera varios (no ocurre hoy: verificado 0 dobles-roster en
-- remoto al crear D1), usa el MÁS SUPERIOR por categoría (desc) y, a igualdad, el
-- más reciente → determinista y seguro (solo se sube por encima del mejor equipo
-- activo). No se fuerza constraint nueva.
--
-- MVCC (lección NIDO / rls-policies.md): la policy SELECT lee memberships,
-- team_staff, team_members y player_accounts — NINGUNA mutada por el INSERT a
-- player_promotions → el RETURNING * tras INSERT pasa la SELECT sin tropezar con
-- filas mutadas en la misma TX.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. category_kind_ordinal — orden de kind en BD (espejo de CATEGORY_KIND_ORDER).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.category_kind_ordinal(p_kind text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'querubin'    then 1
    when 'prebenjamin' then 2
    when 'benjamin'    then 3
    when 'alevin'      then 4
    when 'infantil'    then 5
    when 'cadete'      then 6
    when 'juvenil'     then 7
    when 'amateur'     then 8
    when 'senior'      then 9
    when 'veterano'    then 10
    else 99                                   -- null / desconocido → al final
  end;
$$;

comment on function public.category_kind_ordinal(text) is
  'D1 — ordinal de edad de un category_kind (querubin=1 … veterano=10; null/desconocido=99). Espejo en BD de CATEGORY_KIND_ORDER (packages/core/club-structure.ts). Menor = más joven; mayor = categoría superior.';

grant execute on function public.category_kind_ordinal(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. is_promotion_target_superior(player_id, event_id)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_promotion_target_superior(
  p_player_id uuid,
  p_event_id  uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event         public.events%rowtype;
  v_tgt_kind      text;
  v_tgt_division  text;
  v_base_team_id  uuid;
  v_base_kind     text;
  v_base_division text;
  v_bko int; v_tko int;
  v_bdo int; v_tdo int;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.team_id is null then
    return false;
  end if;

  -- Equipo DESTINO (el del evento).
  select c.kind, t.division
    into v_tgt_kind, v_tgt_division
  from public.teams t
  join public.categories c on c.id = t.category_id
  where t.id = v_event.team_id;

  -- kind nulo en destino → no es un objetivo de subida válido.
  if v_tgt_kind is null then
    return false;
  end if;

  -- Equipo BASE del jugador: activo. Si hubiera varios (invariante "1 base"),
  -- se toma el más superior por categoría y, a igualdad, el más reciente.
  select tm.team_id, c.kind, t.division
    into v_base_team_id, v_base_kind, v_base_division
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.categories c on c.id = t.category_id
  where tm.player_id = p_player_id
    and tm.left_at is null
  order by public.category_kind_ordinal(c.kind) desc, tm.joined_at desc
  limit 1;

  if v_base_team_id is null then
    return false;                              -- sin equipo base no hay "subida"
  end if;

  if v_base_team_id = v_event.team_id then
    return false;                              -- el mismo equipo no es "superior"
  end if;

  v_bko := public.category_kind_ordinal(v_base_kind);
  v_tko := public.category_kind_ordinal(v_tgt_kind);

  -- La CATEGORÍA manda: categoría superior gana aunque la división sea peor.
  if v_tko > v_bko then
    return true;
  elsif v_tko < v_bko then
    return false;
  end if;

  -- Misma categoría → decide la DIVISIÓN (menor ordinal = superior).
  select ordinal into v_tdo
    from public.substitution_regimes
   where category_kind = v_tgt_kind and division = v_tgt_division;
  select ordinal into v_bdo
    from public.substitution_regimes
   where category_kind = v_base_kind and division = v_base_division;

  -- Sin división comparable no se puede establecer superioridad.
  if v_tdo is null or v_bdo is null then
    return false;
  end if;

  return v_tdo < v_bdo;
end;
$$;

comment on function public.is_promotion_target_superior(uuid, uuid) is
  'D1 — TRUE si el equipo del evento es SUPERIOR al equipo base del jugador. Categoría manda (mayor category_kind_ordinal); a igual categoría, división superior = menor substitution_regimes.ordinal. Nunca mismo/inferior; kind nulo en destino, sin equipo base o sin división comparable → false.';

grant execute on function public.is_promotion_target_superior(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. player_promotions — registro de la subida.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.player_promotions (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  event_id    uuid not null references public.events(id)  on delete cascade,
  team_id     uuid not null references public.teams(id)   on delete cascade,
  kind        text not null check (kind in ('train', 'match')),
  club_id     uuid not null references public.clubs(id)   on delete cascade,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),

  constraint player_promotions_unique_player_event unique (player_id, event_id)
);

comment on table public.player_promotions is
  'D1 — subida de un jugador a un equipo SUPERIOR (entrenar/jugar) sin salir de su equipo base. team_id/club_id/kind se DERIVAN del evento por trigger. NO crea team_members (regla #1). Seguimiento visible por la familia.';
comment on column public.player_promotions.event_id is
  'Evento del equipo SUPERIOR al que se sube el jugador. Aporta fecha (D2 conflicto), tipo (kind) y equipo (superioridad).';
comment on column public.player_promotions.kind is
  'train (event.type=training) | match (match/friendly/tournament). event.type=other no es promocionable.';

create index player_promotions_player_idx on public.player_promotions (player_id);
create index player_promotions_event_idx  on public.player_promotions (event_id);
create index player_promotions_team_idx   on public.player_promotions (team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger de validación: deriva team_id/club_id/kind + guards + superioridad.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_promotions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event  public.events%rowtype;
  v_player public.players%rowtype;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Derivar kind del tipo de evento. 'other' no es un contexto de subida.
  new.kind := case v_event.type
    when 'training'   then 'train'
    when 'match'      then 'match'
    when 'friendly'   then 'match'
    when 'tournament' then 'match'
    else null
  end;
  if new.kind is null then
    raise exception 'event_type_not_promotable' using errcode = 'check_violation';
  end if;

  -- team_id y club_id son autoritativos desde el evento (la app no los falsea).
  new.team_id := v_event.team_id;
  new.club_id := v_event.club_id;

  -- Exigir SUPERIORIDAD (categoría manda; a igual categoría, división).
  if not public.is_promotion_target_superior(new.player_id, new.event_id) then
    raise exception 'promotion_target_not_superior' using errcode = 'check_violation';
  end if;

  -- Forzar created_by = auth.uid() cuando haya sesión.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  -- Inmutabilidad en UPDATE (no hay policy UPDATE; defensa en profundidad).
  if tg_op = 'UPDATE' then
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_player_promotions_validate
  before insert or update on public.player_promotions
  for each row execute function public.player_promotions_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.player_promotions enable row level security;

-- SELECT: admin/coord del club ∪ staff del equipo SUPERIOR ∪ familia del jugador
--         (SIEMPRE — seguimiento propio, no atado a informe compartido) ∪ staff
--         del equipo BASE del jugador (cualquier team_members activo suyo).
create policy player_promotions_select on public.player_promotions
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_staff_of_team(team_id)
    or public.user_owns_player_account(player_id)
    or exists (
      select 1
        from public.team_members tm
       where tm.player_id = player_promotions.player_id
         and tm.left_at is null
         and public.user_is_staff_of_team(tm.team_id)
    )
  );

-- INSERT/DELETE: quien gestiona la convocatoria del evento SUPERIOR
--   = admin/coord ∪ principal (team_staff) ∪ ayudante con can_manage_callups
--     (team_staff) del equipo del evento. Reusa user_can_manage_callup e incluye
--     admin/coord EXPLÍCITAMENTE (gotcha team_staff vs rol de club).
create policy player_promotions_insert on public.player_promotions
  for insert to authenticated
  with check (public.user_can_manage_callup(event_id));

create policy player_promotions_delete on public.player_promotions
  for delete to authenticated
  using (public.user_can_manage_callup(event_id));
