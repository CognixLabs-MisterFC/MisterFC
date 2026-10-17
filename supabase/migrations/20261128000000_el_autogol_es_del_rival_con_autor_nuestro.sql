-- ════════════════════════════════════════════════════════════════════════════
-- El AUTOGOL: un gol del rival con autor NUESTRO.
--
-- QUÉ FALTA HOY. No hay forma de apuntar un gol en propia puerta. El entrenador
-- tiene dos salidas y las dos mienten: apuntarlo como gol propio (el marcador se
-- va al revés y el niño se lleva un gol en su ficha) o como gol del rival con un
-- dorsal inventado (el marcador sale bien y el acta dice que lo marcó un jugador
-- del otro equipo que no existe).
--
-- ── POR QUÉ ESTA FORMA Y NO UN TIPO NUEVO ────────────────────────────────────
-- La alternativa era un `type = 'own_goal'`. Se midió antes de escribir, y la
-- descarta una cosa que no es de estilo:
--
--   El marcador NO va por el tipo, va por `side`. `computeScore`
--   (packages/core/src/match/score.ts) suma cada gol al bando de SU FILA. Un
--   autogol ES un gol del rival; lo único que lo distingue es quién lo marcó.
--
-- Con un tipo nuevo habría que enseñárselo a ~20 sitios (los dos triggers de
-- aviso, el conteo por jugador, el marcador de la semana con su filtro
-- `.in('type', ...)` en el servidor, tres listas de tipos en las queries de web,
-- las dos listas blancas de la app…), y sobre todo: la app que YA está en los
-- móviles filtra el timeline por tipo conocido. Una fila `own_goal` sería
-- invisible para ella y no contaría para nadie — el móvil de la familia diría 0-0
-- mientras la web dice 0-1, y sin aviso, durante los ~10 días que tarda una
-- versión nueva en llegar a las tiendas. Eso es un fallo en producción, no una
-- limpieza pendiente.
--
-- Con esta forma, en cambio, la app vieja cuenta el marcador BIEN y rotula el gol
-- como `#?` (el `?? '?'` de `detail.ts` ya está compilado en el binario
-- publicado): pierde el nombre, no el resultado.
--
-- ── LO QUE CAMBIA, QUE ES UNA LÍNEA ──────────────────────────────────────────
-- `match_events_actor_by_side` (mig 20260611000000) dice hoy que una fila del
-- rival no puede llevar jugador nuestro. Se estrecha la prohibición a lo que de
-- verdad hay que prohibir, dejando TRES formas legales de actor:
--
--   1. side='own'                      → sin `rival_dorsal`.
--   2. side='rival' sin autor          → sin `player_id` ni `related_player_id`
--                                        (el gol, la tarjeta o la falta del rival
--                                        de toda la vida, por dorsal).
--   3. side='rival' + type='goal'      → CON `player_id` nuestro y SIN
--                                        `rival_dorsal`: el autogol.
--
-- La forma 3 solo se abre para `goal`. Una tarjeta del rival con un jugador
-- nuestro dentro sigue siendo imposible, y la pgTAP lo afirma por los dos lados.
--
-- Y el `rival_dorsal` tiene que ser null en la forma 3 a propósito: una fila no
-- puede declarar dos autores. El autogol se RECONOCE por eso mismo —un gol del
-- rival que lleva jugador nuestro—, sin una marca aparte en `metadata` que
-- pudiera contradecir a la columna. Una sola fuente.
--
-- ── LO QUE NO CAMBIA ─────────────────────────────────────────────────────────
-- Nada más, y es el motivo de elegirla. No hay tipo nuevo (el CHECK de `type` se
-- queda como está), ni columna nueva, ni `metadata` nueva. `computeScore` ya lo
-- suma al rival; `countPlayerEvents` y la consolidación filtran `side='own'`
-- ANTES de contar, así que el autogol no entra en los goles del jugador ni en sus
-- minutos (los minutos solo los mueven `substitution` y `red_card`); los dos
-- triggers de aviso (`notify_goal`, `unnotify_deleted_goal`) cuentan por bando y
-- por tipo `goal`, así que el aviso sale con el marcador correcto y se retira si
-- el gol se borra. Ninguno de los tres se toca aquí.
--
-- Lo que SÍ queda guardado es el dato con su FK: `player_id` referencia a
-- `players` con `on delete set null`, pasa por `match_assert_player_in_team` en el
-- trigger de validación (el autor tiene que ser del equipo en la fecha del
-- partido) y está indexado. Agregarlo en la ficha de temporada sería otra pieza y
-- otra decisión: el autogol se ve en el ACTA del partido, no en un contador que
-- persiga a un crío de once años. Esta migración deja el dato para poder decidir
-- otra cosa más adelante, no lo agrega.
--
-- ── SOBRE EL DROP/ADD ────────────────────────────────────────────────────────
-- No se editan migraciones aplicadas: se recrea el constraint, mismo patrón que
-- 20260615000000 (formation_change) y 20260617000000 (penalty/shootout). El
-- constraint nuevo es ESTRICTAMENTE MÁS ANCHO que el viejo —las tres formas
-- incluyen las dos de antes—, así que la revalidación de las filas existentes no
-- puede fallar: lo que pasaba el CHECK viejo pasa el nuevo. El `add constraint`
-- escanea la tabla con un lock exclusivo; `match_events` es pequeña y el escaneo
-- es de milisegundos, pero conviene no aplicarlo con un partido en directo.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.match_events
  drop constraint match_events_actor_by_side;

alter table public.match_events
  add constraint match_events_actor_by_side check (
    -- 1. Nuestro: nunca con dorsal rival.
    (side = 'own' and rival_dorsal is null)
    -- 2. Del rival, sin autor nuestro: lo de siempre.
    or (side = 'rival' and player_id is null and related_player_id is null)
    -- 3. AUTOGOL: gol del rival marcado por un jugador NUESTRO. Sin dorsal (no hay
    --    dos autores) y sin `related_player_id` (eso es solo de la sustitución).
    or (side = 'rival' and type = 'goal'
        and player_id is not null
        and rival_dorsal is null
        and related_player_id is null));

comment on table public.match_events is
  'F7 — log de eventos del partido en vivo (propio y rival). clock_seconds absoluto para minutos fiables (§6). id generado en cliente → reintento idempotente (§10). club_id derivado del evento. Un gol side=rival CON player_id nuestro es un AUTOGOL (mig 20261128000000): cuenta para el rival en el marcador y NO para el jugador en sus stats.';

-- ── Último vistazo (corre UNA vez, en el push) ───────────────────────────────
-- Afirma que el constraint quedó puesto (uno, no cero ni dos) e IMPRIME su
-- definición: quien aplica esto ve exactamente qué ha entrado, sin ir a buscarlo.
-- El COMPORTAMIENTO —que la forma 3 pase y que una tarjeta del rival con jugador
-- nuestro siga rechazada— lo mide supabase/tests/el_autogol_lleva_autor.sql, que
-- es donde se puede intentar de verdad. Aquí no se sondean datos: este bloque
-- corre igual contra producción llena y contra la BD vacía del CI.
do $$
declare
  v_n   integer;
  v_def text;
begin
  select count(*), max(pg_get_constraintdef(oid))
    into v_n, v_def
    from pg_constraint
   where conname = 'match_events_actor_by_side'
     and conrelid = 'public.match_events'::regclass;
  if v_n <> 1 then
    raise exception 'GUARD: esperaba 1 constraint match_events_actor_by_side, hay %', v_n;
  end if;
  raise notice 'match_events_actor_by_side recreado (1 constraint). Definición: %', v_def;
end $$;
