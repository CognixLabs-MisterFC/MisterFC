-- Subfase 11.1 — Tabla `exercises` (biblioteca de ejercicios) + RLS.
--
-- Spec: docs/specs/11.0-biblioteca-ejercicios.md §4. Calca el modelo+RLS de
-- coach_formations (F6.10) y le añade la MÁQUINA DE ESTADOS del "ciclo de
-- metodología del club": draft → proposed → published/rejected (+ archived vía
-- archived_at). La aprobación/publicación la gatea el ROL Admin del club (no una
-- capability). El ciclo se diseña reutilizable por F12 (plantillas de sesión):
-- ver helper user_can_publish_methodology y los estados (METHODOLOGY_STATUSES en
-- @misterfc/core).
--
-- Convención: atributos de dominio con clave en inglés y VALORES en español;
-- ciclo/auditoría en inglés. La validación AUTORITATIVA del diagram es
-- parseDiagram() de @misterfc/core en la capa de app antes de insertar; el
-- trigger solo hace una comprobación de FORMA ligera (defensa en profundidad).

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers de autoridad
-- ─────────────────────────────────────────────────────────────────────────────

-- Quién puede CREAR/PROPONER ejercicios en el club (calca user_can_create_coach_formations):
--   admin/coord del club, principal de ALGÚN team del club (team_staff), o staff
--   con la capability can_create_exercises (ayudantes).
create or replace function public.user_can_create_exercises(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_exercises')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    );
$$;
comment on function public.user_can_create_exercises(uuid) is
  'F11.1 — TRUE si el user puede crear/proponer ejercicios en el club: admin/coord, principal de algún team, o staff con capability can_create_exercises.';
grant execute on function public.user_can_create_exercises(uuid) to authenticated;

-- Quién puede PUBLICAR/RECHAZAR/ARCHIVAR en el ciclo de metodología del club:
-- SOLO el Admin del club. Helper GENÉRICO (no atado a exercises) para que F12 lo
-- reutilice en sus plantillas de sesión.
create or replace function public.user_can_publish_methodology(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role_in_club(p_club_id) = 'admin_club';
$$;
comment on function public.user_can_publish_methodology(uuid) is
  'Ciclo de metodología del club (F11/F12): TRUE si el user es Admin del club. Gatea publicar/rechazar/archivar. Reutilizable por F12.';
grant execute on function public.user_can_publish_methodology(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla
-- ─────────────────────────────────────────────────────────────────────────────

create table public.exercises (
  id                 uuid primary key default gen_random_uuid(),
  owner_profile_id   uuid not null references public.profiles(id) on delete cascade,
  club_id            uuid not null references public.clubs(id)    on delete cascade,
  name               text not null check (char_length(name) between 1 and 120),

  -- Campos de la TAREA (anexo). Claves en inglés; valores libres.
  description         text,
  objective           text,
  coaching_points     text,
  variants            text,
  players             text,

  -- Taxonomías (valores en español; vocabularios = constantes de @misterfc/core,
  -- mantener en sync). Subconjunto del vocabulario vía operador <@.
  categories           text[] not null default '{}' check (
    categories <@ array[
      'querubin','prebenjamin','benjamin','alevin','infantil',
      'cadete','juvenil','amateur','senior','veterano'
    ]::text[]
  ),
  tactical_objectives  text[] not null default '{}' check (
    tactical_objectives <@ array[
      'posesion','salida_de_balon','progresion','ocupacion_del_espacio',
      'lineas_de_pase','cambio_de_orientacion','superioridad','apoyos_y_desmarques',
      'accion_combinativa','amplitud_y_profundidad','juego_por_bandas','centros',
      'finalizacion','presion_tras_perdida','repliegue','basculacion',
      'coberturas_y_vigilancias','transicion_ofensiva','transicion_defensiva','balon_parado'
    ]::text[]
  ),
  technical_objectives text[] not null default '{}' check (
    technical_objectives <@ array[
      'control','pase','recepcion','conduccion','regate','golpeo','tiro','cabeceo'
    ]::text[]
  ),
  physical_focus       text,  -- texto libre (sin estructurar en v1)
  intensity            text check (intensity is null or intensity in ('baja','media','alta')),
  space_type           text check (space_type is null or space_type in
                         ('campo_completo','medio_campo','cuarto_campo','reducido')),
  space_dimensions     text,
  base_duration        smallint check (base_duration is null or base_duration >= 0),

  -- Diagrama (opcional). Forma validada (ligera) por trigger; parseDiagram es
  -- la validación autoritativa en la capa de app.
  diagram            jsonb,

  -- Ciclo de metodología del club (auditoría en inglés).
  status             text not null default 'draft' check (status in
                       ('draft', 'proposed', 'published', 'rejected')),
  approved_by        uuid references public.profiles(id),
  approved_at        timestamptz,
  rejection_reason   text,
  archived_at        timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.exercises is
  'F11 — biblioteca de ejercicios del club. Ciclo de metodología: draft→proposed→published/rejected (+archived). Publicar/rechazar/archivar = Admin del club.';

create index exercises_club_status_idx on public.exercises (club_id, status)
  where archived_at is null;
create index exercises_owner_idx on public.exercises (owner_profile_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: owner forzado, inmutabilidad, forma del diagram, reglas de estado.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.exercises_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Forma ligera del diagram (autoritativo = parseDiagram en app).
  if new.diagram is not null then
    if jsonb_typeof(new.diagram) <> 'object' then
      raise exception 'diagram_not_object' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(new.diagram->'elements') <> 'array' then
      raise exception 'diagram_elements_not_array' using errcode = 'check_violation';
    end if;
    if jsonb_array_length(new.diagram->'elements') > 200 then
      raise exception 'diagram_too_many_elements' using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- El dueño es siempre el usuario autenticado (cuando hay sesión).
    if auth.uid() is not null then
      new.owner_profile_id := auth.uid();
    end if;
    -- No se crea directamente en 'rejected'.
    if new.status = 'rejected' then
      raise exception 'cannot_create_rejected' using errcode = 'check_violation';
    end if;
    -- Solo el Admin puede crear directo en 'published'.
    if new.status = 'published' then
      if not public.user_can_publish_methodology(new.club_id) then
        raise exception 'publish_requires_admin' using errcode = 'check_violation';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;

  else  -- UPDATE
    if new.owner_profile_id is distinct from old.owner_profile_id then
      raise exception 'owner_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();

    -- Transiciones de estado.
    if new.status is distinct from old.status then
      -- A 'published'/'rejected' solo el Admin.
      if new.status in ('published', 'rejected')
         and not public.user_can_publish_methodology(new.club_id) then
        raise exception 'transition_requires_admin' using errcode = 'check_violation';
      end if;
      -- El rechazo exige motivo.
      if new.status = 'rejected'
         and (new.rejection_reason is null or btrim(new.rejection_reason) = '') then
        raise exception 'rejection_reason_required' using errcode = 'check_violation';
      end if;
      -- Al publicar, sella auditoría y limpia motivo.
      if new.status = 'published' then
        new.approved_by := auth.uid();
        new.approved_at := now();
        new.rejection_reason := null;
      end if;
    end if;

    -- Archivar: solo un 'published', solo el Admin.
    if new.archived_at is not null and old.archived_at is null then
      if new.status <> 'published' then
        raise exception 'archive_only_published' using errcode = 'check_violation';
      end if;
      if not public.user_can_publish_methodology(new.club_id) then
        raise exception 'archive_requires_admin' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_exercises_validate
  before insert or update on public.exercises
  for each row execute function public.exercises_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.exercises enable row level security;

-- SELECT: published (+archived) → todo el staff del club; draft → autor;
-- proposed/rejected → autor + Admin.
create policy exercises_select on public.exercises
  for select to authenticated
  using (
    case
      when status = 'draft' then
        owner_profile_id = auth.uid()
      when status in ('proposed', 'rejected') then
        owner_profile_id = auth.uid()
        or public.user_role_in_club(club_id) = 'admin_club'
      else  -- published (incl. archivados)
        public.user_role_in_club(club_id) in
          ('admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
    end
  );

-- INSERT: para uno mismo, con autoridad de creación. El estado lo gatea el trigger
-- (no-Admin no puede entrar en 'published').
create policy exercises_insert on public.exercises
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_can_create_exercises(club_id)
  );

-- UPDATE: el autor mientras editable (draft/proposed/rejected), o el Admin. Las
-- transiciones a published/rejected las gatea el trigger (solo Admin).
create policy exercises_update on public.exercises
  for update to authenticated
  using (
    (owner_profile_id = auth.uid() and status in ('draft', 'proposed', 'rejected'))
    or public.user_role_in_club(club_id) = 'admin_club'
  )
  with check (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
  );

-- DELETE: autor si no publicado; Admin cualquiera no publicado. Los publicados se
-- ARCHIVAN (archived_at), no se borran.
create policy exercises_delete on public.exercises
  for delete to authenticated
  using (
    (owner_profile_id = auth.uid() and status in ('draft', 'proposed', 'rejected'))
    or (public.user_role_in_club(club_id) = 'admin_club' and status <> 'published')
  );
