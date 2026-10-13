-- EL FÚTBOL 5 EXISTE — capa de base de datos.
--
-- Por qué: UDFonteta da de alta un equipo de Querubines (categoría «Querubín»,
-- que ya existe) y juega FÚTBOL 5: cuatro de campo más portero. Hoy la modalidad
-- no existe en ninguna de las dos listas cerradas de formatos, así que el equipo
-- no se puede ni crear.
--
-- ── LO QUE LLEVA, Y POR QUÉ SON TRES COSAS Y NO DOS ──────────────────────────
--   1. `teams.format` admite 'F5'.
--   2. `coach_formations.format` admite 'F5'. Si solo se ampliara el de teams, el
--      equipo se podría crear pero su entrenador NO podría guardar una formación
--      propia de F5: dos listas, dos sitios.
--   3. `coach_formations_validate`, el trigger que exige que el nº de posiciones
--      cuadre con la modalidad. Y ESTA es la que no se ve venir: su `case` era
--
--          case new.format when 'F7' then 7 when 'F8' then 8 when 'F11' then 11 end
--
--      SIN rama `else`. Con un formato nuevo, `v_expected` sale NULL, y entonces
--      `jsonb_array_length(...) <> NULL` vale NULL —que no es TRUE—, así que el
--      `if` no dispara y la comprobación de la cuenta SE QUEDA MUDA: una formación
--      de F5 con once posiciones entraría sin protestar. Ampliar solo los dos
--      CHECK habría abierto ese agujero en silencio.
--
--      Por eso aquí la rama de F5 va acompañada de un `else` que REVIENTA ante un
--      formato que el trigger no conozca. Hoy ese `else` es inalcanzable —el CHECK
--      filtra antes—, y está puesto para el próximo que amplíe el CHECK y se olvide
--      del trigger: en vez de perder la validación, se le cae el insert.
--
-- El cuerpo de la función se ha copiado de su definición VIVA en producción
-- (`pg_get_functiondef`) y solo se le han añadido esas dos líneas: no está
-- reescrito de memoria.
--
-- ── LO QUE NO LLEVA ──────────────────────────────────────────────────────────
--   · El código: el tipo `TeamFormat`, las reglas de modalidad de F5 (5 titulares,
--     15 convocados, 10 en banquillo) y el catálogo de formaciones F5 (1-2-2 por
--     defecto, 1-1-2-1 y 1-3-1) van en su PR. Hasta que entre, entrar en
--     /alineacion de un equipo F5 lanzaría `no formations for format F5`: esta
--     migración abre la puerta, no amuebla la casa.
--   · Los TRES TIEMPOS de doce minutos, que son otra cosa (el enum de `period` y
--     el número de periodos de la categoría) y van en su propia migración.
--   · El régimen de cambios de los querubines: ya está cargado
--     (`substitution_regimes`, kind 'querubin', división 'unica': rolling,
--     ilimitados, con reentrada). Nada que hacer.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. teams.format admite 'F5'
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.teams
  drop constraint if exists teams_format_check;

alter table public.teams
  add constraint teams_format_check
  check (format = any (array['F5'::text, 'F7'::text, 'F8'::text, 'F11'::text]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. coach_formations.format admite 'F5'
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.coach_formations
  drop constraint if exists coach_formations_format_check;

alter table public.coach_formations
  add constraint coach_formations_format_check
  check (format = any (array['F5'::text, 'F7'::text, 'F8'::text, 'F11'::text]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El trigger de validación: F5 = 5 posiciones, y falla cerrado ante un
--    formato desconocido en vez de dejar de comprobar la cuenta.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.coach_formations_validate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected int;
  v_item     jsonb;
  v_code     text;
  v_x        numeric;
  v_y        numeric;
begin
  v_expected := case new.format
    when 'F5'  then 5
    when 'F7'  then 7
    when 'F8'  then 8
    when 'F11' then 11
    -- Sin esto, un formato nuevo deja `v_expected` en NULL y la comparación de la
    -- cuenta pasa a ser NULL (que no es TRUE): la validación desaparece sin avisar.
    else null
  end;

  if v_expected is null then
    raise exception 'formato_desconocido_en_el_trigger: %', new.format
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(new.positions) <> 'array' then
    raise exception 'positions_not_array' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(new.positions) <> v_expected then
    raise exception 'positions_count_mismatch' using errcode = 'check_violation';
  end if;

  for v_item in select * from jsonb_array_elements(new.positions)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'position_not_object' using errcode = 'check_violation';
    end if;
    v_code := v_item->>'position_code';
    if v_code is null or char_length(v_code) < 1 or char_length(v_code) > 20 then
      raise exception 'position_code_invalid' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_item->'x_pct') <> 'number'
       or jsonb_typeof(v_item->'y_pct') <> 'number' then
      raise exception 'position_coords_not_number' using errcode = 'check_violation';
    end if;
    v_x := (v_item->>'x_pct')::numeric;
    v_y := (v_item->>'y_pct')::numeric;
    if v_x < 0 or v_x > 100 or v_y < 0 or v_y > 100 then
      raise exception 'position_coords_out_of_range' using errcode = 'check_violation';
    end if;
  end loop;

  -- Defensa: el dueño es siempre el usuario autenticado (cuando hay sesión).
  -- club_id y owner son inmutables tras crear.
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_profile_id := auth.uid();
    end if;
  else
    if new.owner_profile_id is distinct from old.owner_profile_id then
      raise exception 'owner_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$function$;

comment on function public.coach_formations_validate() is
  'F6.10 — valida positions de coach_formations: array, nº de posiciones = modalidad (F5=5, F7=7, F8=8, F11=11), códigos y coordenadas; owner/club inmutables. Falla cerrado ante un formato que no conozca: sin la rama else, un formato nuevo dejaba la cuenta sin comprobar.';
