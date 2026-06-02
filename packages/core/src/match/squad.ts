/**
 * F7.5/7.6 — Estado vivo del once: quién está EN EL CAMPO y quién FUERA (banquillo
 * + jugadores que han salido) en cada momento, derivado de forma PURA de lo
 * persistido (no de estado optimista efímero):
 *
 *   campo = titulares (slots de la alineación oficial) con sus posiciones,
 *           aplicando las sustituciones (el que ENTRA ocupa el hueco del que
 *           SALE), quitando expulsados (1 roja O 2 amarillas, regla 7.3) y
 *           ausentes (7.5);
 *   banquillo = TODOS los jugadores conocidos del once (suplentes oficiales +
 *           titulares que han salido) que ahora mismo NO están en el campo, con
 *           su estado (disponible para entrar / fuera sin reentrada / expulsado /
 *           ausente).
 *
 * Reglas (spec §7.5/§7.6 / §3.4 ter):
 *  - El que ENTRA toma la posición del que SALE.
 *  - Un EXPULSADO o AUSENTE no es elegible para entrar ni permanece en el campo.
 *  - **Cambios corridos (7.6)**: con `allowReentry` (flag de la categoría) un
 *    jugador que YA estuvo en el campo y salió puede VOLVER a entrar, sin límite.
 *    Con el flag desactivado, un jugador sustituido NO reentra (regla estándar:
 *    una vez fuera, fuera). Los suplentes que aún no han entrado SIEMPRE pueden
 *    entrar (no es reentrada). Expulsados y ausentes nunca reentran.
 */

export interface FieldSlot {
  playerId: string;
  positionCode: string | null;
  xPct: number | null;
  yPct: number | null;
}

/** Una sustitución: SALE `out`, ENTRA `in`. En orden cronológico. */
export interface Sub {
  out: string;
  in: string;
}

/**
 * Estado de un jugador FUERA del campo:
 *  - `available`: puede entrar ya (suplente sin estrenar, o reentrada permitida);
 *  - `out`: estuvo en el campo y salió, y NO puede reentrar (categoría sin
 *    cambios corridos) — informativo, no seleccionable;
 *  - `expelled` / `absent`: nunca reentran.
 */
export type BenchStatus = 'available' | 'out' | 'expelled' | 'absent';

export interface BenchEntry {
  playerId: string;
  status: BenchStatus;
}

export interface Squad {
  /** Ocupantes actuales de los huecos del campo (candidatos a SALIR). */
  onField: FieldSlot[];
  /** Ids en el campo ahora mismo. */
  onFieldIds: string[];
  /** Jugadores FUERA del campo (suplentes + titulares que salieron) con su estado. */
  bench: BenchEntry[];
  /** Jugadores ELEGIBLES para entrar (status 'available'). */
  eligibleInIds: string[];
}

export interface DeriveSquadParams {
  /** Huecos del campo = posiciones de campo de la alineación oficial (titulares). */
  slots: readonly FieldSlot[];
  /** Suplentes de la alineación oficial (location='bench'). */
  bench: readonly string[];
  /** Sustituciones en orden cronológico (clock_seconds asc). */
  subs: readonly Sub[];
  /** Expulsados (1 roja O 2 amarillas), de los eventos de tarjeta. */
  expelled: Iterable<string>;
  /** Ausentes ("no vienen"), de match_absences. */
  absent: Iterable<string>;
  /**
   * Cambios corridos (7.6): ¿puede un jugador que salió VOLVER a entrar? Flag de
   * la categoría (`categories.allow_reentry`). Default `false` (regla estándar:
   * una vez sustituido, no reentra) — las categorías de base lo traen activado.
   */
  allowReentry?: boolean;
}

export function deriveSquad(params: DeriveSquadParams): Squad {
  const expelled = new Set(params.expelled);
  const absent = new Set(params.absent);
  const allowReentry = params.allowReentry ?? false;

  // Ocupante actual de cada hueco: arranca con el titular y va cambiando con las
  // sustituciones (el que entra ocupa el hueco del que sale).
  const occupants: { occupant: string; slot: FieldSlot }[] = params.slots.map(
    (slot) => ({ occupant: slot.playerId, slot }),
  );
  for (const sub of params.subs) {
    const target = occupants.find((o) => o.occupant === sub.out);
    if (target) target.occupant = sub.in; // si no está en campo, se ignora (defensivo)
  }

  // En el campo: el ocupante de cada hueco, salvo expulsados/ausentes (hueco
  // vacío hasta que el operador meta a otro por sustitución).
  const onField: FieldSlot[] = occupants
    .filter((o) => !expelled.has(o.occupant) && !absent.has(o.occupant))
    .map((o) => ({
      playerId: o.occupant,
      positionCode: o.slot.positionCode,
      xPct: o.slot.xPct,
      yPct: o.slot.yPct,
    }));
  const onFieldIds = onField.map((p) => p.playerId);
  const onFieldSet = new Set(onFieldIds);

  // "Ha estado en el campo alguna vez" = titular o suplente que entró (sub.in).
  // Sirve para distinguir reentrada (estuvo y salió) de un suplente sin estrenar.
  const everOnField = new Set<string>(params.slots.map((s) => s.playerId));
  for (const sub of params.subs) everOnField.add(sub.in);

  // Banquillo = TODOS los conocidos (suplentes oficiales + titulares) que NO
  // están en el campo ahora. Orden: suplentes oficiales primero, luego el resto.
  const seen = new Set<string>();
  const offFieldOrder: string[] = [];
  for (const id of [...params.bench, ...params.slots.map((s) => s.playerId)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!onFieldSet.has(id)) offFieldOrder.push(id);
  }

  const bench: BenchEntry[] = offFieldOrder.map((playerId) => {
    let status: BenchStatus;
    if (absent.has(playerId)) status = 'absent';
    else if (expelled.has(playerId)) status = 'expelled';
    else if (!everOnField.has(playerId))
      status = 'available'; // suplente sin estrenar → siempre puede entrar
    else status = allowReentry ? 'available' : 'out'; // estuvo y salió → reentrada
    return { playerId, status };
  });

  const eligibleInIds = bench
    .filter((b) => b.status === 'available')
    .map((b) => b.playerId);

  return { onField, onFieldIds, bench, eligibleInIds };
}
