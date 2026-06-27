-- JS-0 (F12↔F13, #192) — Jugadas en sesiones: tabla `session_block_plays`, espejo
-- de `session_block_exercises`, para añadir JUGADAS del playbook del equipo como
-- ítems de un BLOQUE de la sesión (junto a los ejercicios).
--
-- Decisiones cerradas (análisis previo):
--   D1 — JOIN PARALELO `session_block_plays` (no polimórfico): tabla espejo; los
--        ejercicios no se tocan; cada secuencia de order_idx es independiente.
--   D2 — A nivel de BLOQUE (como el ejercicio).
--   D6 — FAMILIA ESTRICTA: la familia solo VE las filas cuya jugada esté
--        `shared_with_family=true` en el playbook del equipo de la sesión. El staff
--        ve todas. (La RLS lo refleja; la vista de JS-3 no necesita filtrar.)
--   D7 — OVERRIDES del día: `notes` + `duration_min` (ambos nullable).
--   D8 — El `duration_min` de las jugadas SUMA a `sessions.total_minutes` (se
--        recrea el trigger derivado para sumar ejercicios ∪ jugadas).
--
-- Patrón calcado de 20260716000000_sessions.sql (+ move_task / reorder_total):
-- club_id y session_id se DERIVAN del bloque por trigger (denorm fiable, RLS sin
-- recursión); UNIQUE de orden DEFERRABLE; block_id mutable solo dentro de la MISMA
-- sesión; RLS de las hijas heredada vía user_can_see_session/user_can_edit_session.
--
-- INSERT/UPDATE además exigen que la jugada esté en el PLAYBOOK del equipo de la
-- sesión (EXISTS team_plays con team_id = sessions.team_id), espejo del check
-- `published` de team_plays_insert (JR-0). Plantillas (team_id NULL) → sin playbook
-- → no admiten jugadas (D4).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla: session_block_plays — join bloque↔jugada con OVERRIDE DEL DÍA.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.session_block_plays (
  id           uuid primary key default gen_random_uuid(),
  block_id     uuid not null references public.session_blocks(id) on delete cascade,
  session_id   uuid not null references public.sessions(id) on delete cascade,  -- denorm, derivado por trigger
  club_id      uuid not null references public.clubs(id) on delete cascade,     -- denorm (RLS), derivado por trigger
  play_id      uuid not null references public.plays(id) on delete restrict,
  order_idx    smallint not null,
  duration_min smallint check (duration_min is null or duration_min >= 0),  -- "10 min" (del día, D7)
  notes        text,                                                        -- ajuste del día (D7)
  constraint session_block_plays_order_uniq unique (block_id, order_idx)
    deferrable initially deferred
);

comment on table public.session_block_plays is
  'F12↔F13 (JS-0) — jugadas de un bloque: play del banco (en el playbook del equipo) + override del día (duración/notas). session_id y club_id se derivan del bloque por trigger.';

create index session_block_plays_block_idx on public.session_block_plays (block_id);
create index session_block_plays_session_idx on public.session_block_plays (session_id);
create index session_block_plays_club_idx on public.session_block_plays (club_id);
create index session_block_plays_play_idx on public.session_block_plays (play_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: deriva session_id/club_id del bloque; block_id mutable solo intra-sesión
-- (gemelo de session_block_exercises_validate tras move_task).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.session_block_plays_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_club uuid;
begin
  select session_id, club_id into v_session, v_club
    from public.session_blocks where id = new.block_id;
  if v_session is null then
    raise exception 'block_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.session_id := v_session;
  new.club_id := v_club;

  -- Mover de bloque sí; mover a un bloque de OTRA sesión, no.
  if tg_op = 'UPDATE' and new.block_id is distinct from old.block_id then
    if v_session is distinct from old.session_id then
      raise exception 'cross_session_move' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_session_block_plays_validate
  before insert or update on public.session_block_plays
  for each row execute function public.session_block_plays_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — session_block_plays
-- SELECT: el staff que ve la sesión ve TODAS las jugadas; la familia (D6 estricta)
--   solo las que estén compartidas (shared_with_family) en el playbook del equipo
--   de la sesión. UPDATE/DELETE: quien puede editar la sesión. INSERT/UPDATE además
--   exigen que la jugada esté en el playbook del equipo de la sesión.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.session_block_plays enable row level security;

create policy session_block_plays_select on public.session_block_plays
  for select to authenticated
  using (
    public.user_can_see_session(session_id)
    and (
      -- staff del club: visibilidad completa
      public.user_role_in_club(club_id) in
        ('admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
      -- familia (D6 estricta): solo si la jugada está compartida con el equipo de la sesión
      or exists (
        select 1
        from public.sessions s
        join public.team_plays tp
          on tp.team_id = s.team_id and tp.play_id = session_block_plays.play_id
        where s.id = session_block_plays.session_id
          and tp.shared_with_family = true
      )
    )
  );

create policy session_block_plays_insert on public.session_block_plays
  for insert to authenticated
  with check (
    public.user_can_edit_session(session_id)
    and exists (
      select 1
      from public.sessions s
      join public.team_plays tp
        on tp.team_id = s.team_id and tp.play_id = session_block_plays.play_id
      where s.id = session_block_plays.session_id
    )
  );

create policy session_block_plays_update on public.session_block_plays
  for update to authenticated
  using (public.user_can_edit_session(session_id))
  with check (
    public.user_can_edit_session(session_id)
    and exists (
      select 1
      from public.sessions s
      join public.team_plays tp
        on tp.team_id = s.team_id and tp.play_id = session_block_plays.play_id
      where s.id = session_block_plays.session_id
    )
  );

create policy session_block_plays_delete on public.session_block_plays
  for delete to authenticated
  using (public.user_can_edit_session(session_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- Reordenar jugadas dentro de un bloque (gemelo de reorder_session_tasks).
-- SECURITY INVOKER → la RLS de session_block_plays es el gate real.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_session_block_plays(
  p_block_id uuid,
  p_play_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.session_block_plays p
     set order_idx = (t.n - 1)::smallint
    from unnest(p_play_ids) with ordinality as t(id, n)
   where p.id = t.id
     and p.block_id = p_block_id;
end;
$$;
comment on function public.reorder_session_block_plays(uuid, uuid[]) is
  'F12↔F13 (JS-0) — reasigna order_idx (0..n) a las jugadas de un bloque en el orden dado, en una sola sentencia (UNIQUE deferrable). RLS de session_block_plays = gate.';
grant execute on function public.reorder_session_block_plays(uuid, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- D8 — total_minutes derivado: ahora suma ejercicios ∪ jugadas. Se recrea la
-- función (preserva NULL-cuando-vacío: sum() de cero filas = NULL) y se añade el
-- trigger AFTER en session_block_plays.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.session_recompute_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  v_session := coalesce(new.session_id, old.session_id);
  update public.sessions s
     set total_minutes = (
       select sum(d)::smallint
         from (
           select e.duration_min as d
             from public.session_block_exercises e
            where e.session_id = v_session
           union all
           select p.duration_min as d
             from public.session_block_plays p
            where p.session_id = v_session
         ) x
     )
   where s.id = v_session;
  return null;
end;
$$;

create trigger trg_session_block_plays_recompute_total
  after insert or update or delete on public.session_block_plays
  for each row execute function public.session_recompute_total();
