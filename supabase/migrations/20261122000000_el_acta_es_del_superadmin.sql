-- EL ACTA ES DEL SUPERADMIN — cierre en la BASE de la importación federada.
--
-- Por qué: desde el PR «importar partidos federados pasa a ser solo del
-- superadmin», la decisión la sostenía UNA SOLA barrera, el route handler de
-- `/api/ffcv/*`. Con la negativa por escrito de la FFCV encima, eso no basta:
-- quien edite ese fichero —o añada otro camino de escritura— deshace la decisión
-- sin que nada se ponga rojo en la base.
--
-- Lo que esto NO es: un refuerzo de la RLS. La RLS de `events` no sabe distinguir
-- un partido importado de uno creado a mano, y crear eventos a mano es trabajo
-- legítimo. Este trigger mira la ÚNICA cosa que sí identifica una importación:
-- `events.ffcv_match_code`, el acta.
--
-- ── ALCANCE ESTRECHO, Y EL MOTIVO IMPORTA ───────────────────────────────────
-- Solo la columna del acta. NO «cualquier campo de un partido que tenga acta».
--
-- La versión ancha se descartó por una razón concreta: la FFCV publica HORAS
-- PROVISIONALES —la importación llega a dejar partidos a las 9:00 de relleno,
-- esperando que la federación confirme—, y esas horas las corrigen a mano los
-- ENTRENADORES. Bloquear cualquier escritura sobre un partido con acta le
-- quitaría ese trabajo justo a quien lo hace, y en los partidos que más lo
-- necesitan. Lo que se protege es el VÍNCULO con la federación (poner un acta,
-- cambiarla o quitarla), no el contenido del partido.
--
-- Queda dicho aquí para que el próximo que piense «mejor lo ensancho por
-- prudencia» sepa qué rompería.
--
-- ── MUERDE SOLO CON SESIÓN, Y QUÉ NO PARA ───────────────────────────────────
-- Si `auth.uid()` es NULL no hay nada que comprobar y se deja pasar. NULL
-- significa: una migración de datos aplicada como superuser, la suite pgTAP, o
-- un job sin sesión. La amenaza de la que esto protege es una persona usando la
-- app, y una persona usando la app SIEMPRE tiene sesión.
--
-- Dicho sin adornos: esto NO para al superuser ni al service-role. Pero en este
-- modelo no los para nada, y la importación nunca usa service-role (los eventos
-- los firma quien pulsa). La alternativa —morder siempre— rompería cualquier
-- migración de datos futura que toque estas columnas y obligaría a que la suite
-- pgTAP suplantara a un superadmin para nueve casos que hoy no van de permisos.
--
-- ── POR QUÉ `update of ffcv_match_code` Y NO `update` a secas ────────────────
-- Porque esta tabla ya tiene ese mecanismo: `events_target_same_club_check` es
-- `before insert or update of club_id, team_id, category_id`. Acotar por columna
-- hace que el REPASO de la importación —que actualiza starts_at, title,
-- location_*, opponent_name y ffcv_round, y NO menciona el acta— no dispare este
-- trigger en absoluto, en vez de dispararlo y dejarlo pasar por comparación.
--
-- ── NO LLEVA SECURITY DEFINER, Y ES A PROPÓSITO ─────────────────────────────
-- Sus dos hermanos de esta tabla sí lo llevan, así que lo normal sería copiarlo.
-- Aquí NO, por dos razones que se suman:
--   1. No es portante: esta función no necesita privilegios de nadie. Quien lee
--      `platform_admins` es `is_superadmin()`, que ya es SECURITY DEFINER.
--   2. `docs/journey/known-issues.md` documenta que la BD efímera del CI SE CAE
--      —y se lleva por delante los 60 tests siguientes— cuando un test captura
--      un 42501 lanzado desde una función SECURITY DEFINER **con cláusula SET**
--      bajo `set local role`. Es exactamente la forma de esta función y de su
--      test. No reproduce contra producción (es un fallo de la imagen de
--      Postgres del CI, corregido en un 17.x posterior), así que hoy pasa; pero
--      dejar puesta la mitad de una combinación conocida por tumbar el CI, a
--      cambio de un privilegio que no se usa, no se sostiene.
-- El `set search_path` SÍ se queda: eso sí es portante.
--
-- ── Y SE REVOCA DE `public` ─────────────────────────────────────────────────
-- `create function` concede EXECUTE a PUBLIC, y con ello a `anon`. El guard
-- `supabase/tests/anon_execute_cerrado.sql` censa qué puede ejecutar `anon` y
-- solo admite dos funciones públicas; sin esto el PR sale en rojo, y con razón.
-- El ACL que queda es el MISMO que el de los triggers hermanos de esta tabla
-- (`events_guard_approval`, `events_assert_target_same_club`, `set_updated_at`):
-- postgres=X | authenticated=X | service_role=X.
--
-- errcode 42501 (insufficient_privilege) a propósito: es lo que la casa usa para
-- negar permiso y lo que la web ya traduce a 'forbidden'.

create or replace function public.events_guard_ffcv_code()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Sin sesión no se comprueba: migración de datos, pgTAP o job como superuser.
  if auth.uid() is null then
    return new;
  end if;

  -- Un INSERT sin acta no es una importación: es un evento normal del club.
  if tg_op = 'INSERT' and new.ffcv_match_code is null then
    return new;
  end if;

  -- Un UPDATE que menciona el acta sin cambiarla no vincula ni desvincula nada.
  if tg_op = 'UPDATE'
     and new.ffcv_match_code is not distinct from old.ffcv_match_code then
    return new;
  end if;

  -- Queda: poner un acta, cambiarla o quitarla. Eso es el vínculo federado.
  if not public.is_superadmin() then
    raise exception 'ffcv_match_code_solo_superadmin'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.events_guard_ffcv_code() is
  'Solo un superadmin de plataforma puede poner, cambiar o quitar events.ffcv_match_code (el vínculo con la FFCV). Alcance ESTRECHO a propósito: el resto del partido se sigue editando a mano, porque las horas provisionales de la FFCV las corrigen los entrenadores. No muerde sin sesión (auth.uid() null = migración de datos o pgTAP).';

revoke all on function public.events_guard_ffcv_code() from public;
grant execute on function public.events_guard_ffcv_code() to authenticated, service_role;

drop trigger if exists events_guard_ffcv_code on public.events;

create trigger events_guard_ffcv_code
  before insert or update of ffcv_match_code on public.events
  for each row execute function public.events_guard_ffcv_code();
