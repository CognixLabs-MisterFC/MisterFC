-- O2-1a — Color de marca del club: columna + CHECK hex + RPC (admin) + guard.
--
-- Introduce el PRIMER color POR CLUB (hasta ahora el color de la web era GLOBAL:
-- globals.css --color-primary). Réplica EXACTA del patrón de F14B-9a (logo,
-- 20260929000000_f14b_9a_club_logo.sql): columna NULLABLE, escritura SOLO por la
-- RPC set_club_color con gate admin_club (director excluido; superadmin incluido
-- por el chokepoint F14B-2), y un trigger que impide el UPDATE directo de la
-- columna a quien no sea admin (clubs_update_admin deja UPDATE también al
-- director, F1B1). NO crea bucket ni storage: es solo un valor escalar.
--
-- ALCANCE O2-1a: guardar / leer / quitar el color. NO pinta la UI global de la
-- web con el color del club (eso es otro alcance).
--
-- NOTA: NO se toca el guard existente clubs_guard_logo_path. Este guard es NUEVO
-- e independiente (calcado), para no recrear una función que ya funciona.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. clubs.primary_color — hex #RRGGBB. NULL = sin color (la app cae a un neutro
--    por defecto). El CHECK rechaza cualquier cosa que no sea exactamente
--    '#' + 6 dígitos hex (mayúsculas o minúsculas).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.clubs
  add column if not exists primary_color text
    check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.clubs.primary_color is
  'O2-1a — color de marca del club en hex #RRGGBB (NULL = sin color → neutro por '
  'defecto). Se escribe SOLO vía set_club_color (gate admin_club; director excluido, '
  'superadmin incluido por el chokepoint); el trigger clubs_guard_primary_color '
  'bloquea el UPDATE directo. El formato lo valida el CHECK de la columna.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC set_club_color — ÚNICA vía para escribir clubs.primary_color. Gate
--    admin_club (excluye director; incluye superadmin por el chokepoint).
--    p_color NULL = el admin retira el color.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_club_color(p_club_id uuid, p_color text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'no_session';
  end if;
  if public.user_role_in_club(p_club_id) is distinct from 'admin_club' then
    raise exception 'forbidden';
  end if;
  -- El CHECK de la columna valida el formato hex; p_color NULL retira el color.
  update public.clubs set primary_color = p_color where id = p_club_id;
end;
$$;

comment on function public.set_club_color(uuid, text) is
  'O2-1a — Fija (o retira, p_color NULL) clubs.primary_color de UN club. Gate '
  'user_role_in_club=''admin_club'' (superadmin incluido por el chokepoint; director '
  'excluido). Única vía de escritura; el trigger clubs_guard_primary_color bloquea el '
  'UPDATE directo. El formato hex lo valida el CHECK de la columna.';

revoke all on function public.set_club_color(uuid, text) from public;
grant execute on function public.set_club_color(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger de columna: clubs.primary_color SOLO la cambia el admin (vía la RPC)
--    o el backend (service_role, auth.uid() null). Necesario porque
--    clubs_update_admin permite UPDATE al admin Y al director (F1B1) → sin este
--    guard, un director podría escribir primary_color por UPDATE directo.
--    Calcado de clubs_guard_logo_path (F14B-9a); función NUEVA e independiente.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.clubs_guard_primary_color()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.primary_color is distinct from OLD.primary_color then
    -- auth.uid() null = backend service_role: permitido. En sesión, solo admin_club.
    if auth.uid() is not null
       and public.user_role_in_club(NEW.id) is distinct from 'admin_club' then
      raise exception 'primary_color solo lo gestiona el admin del club (usa set_club_color)';
    end if;
  end if;
  return NEW;
end;
$$;

comment on function public.clubs_guard_primary_color() is
  'O2-1a — Bloquea cambios de clubs.primary_color salvo por el admin_club (vía '
  'set_club_color) o el backend (service_role). clubs_update_admin sigue permitiendo '
  'el resto del UPDATE (admin/director) pero NO el color al director. Calcado de '
  'clubs_guard_logo_path.';

drop trigger if exists clubs_guard_primary_color on public.clubs;
create trigger clubs_guard_primary_color
  before update on public.clubs
  for each row execute function public.clubs_guard_primary_color();
