/**
 * F7.5 — Estado vivo del once: quién está EN EL CAMPO y quién en el BANQUILLO en
 * cada momento, derivado de forma PURA de lo persistido (no de estado optimista
 * efímero):
 *
 *   campo = titulares (slots de la alineación oficial) con sus posiciones,
 *           aplicando las sustituciones (el que ENTRA ocupa el hueco del que
 *           SALE), quitando expulsados (1 roja O 2 amarillas, regla 7.3) y
 *           ausentes (7.5);
 *   banquillo = suplentes oficiales con su estado (disponible / ya entró /
 *           expulsado / ausente). Solo los "disponibles" pueden entrar.
 *
 * Reglas (spec §7.5 / §3.4 ter):
 *  - Un jugador SALE por sustitución → desaparece del campo y NO puede volver
 *    (no está en el banquillo oficial).
 *  - Un EXPULSADO o AUSENTE no es elegible para entrar ni permanece en el campo.
 *  - El que ENTRA toma la posición del que SALE.
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

export type BenchStatus = 'available' | 'entered' | 'expelled' | 'absent';

export interface BenchEntry {
  playerId: string;
  status: BenchStatus;
}

export interface Squad {
  /** Ocupantes actuales de los huecos del campo (candidatos a SALIR). */
  onField: FieldSlot[];
  /** Ids en el campo ahora mismo. */
  onFieldIds: string[];
  /** Banquillo oficial con su estado. */
  bench: BenchEntry[];
  /** Suplentes ELEGIBLES para entrar (status 'available'). */
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
}

export function deriveSquad(params: DeriveSquadParams): Squad {
  const expelled = new Set(params.expelled);
  const absent = new Set(params.absent);

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

  // Suplentes que YA entraron (ocupan o han ocupado un hueco vía sustitución).
  const entered = new Set(params.subs.map((s) => s.in));

  const bench: BenchEntry[] = params.bench.map((playerId) => {
    let status: BenchStatus;
    if (absent.has(playerId)) status = 'absent';
    else if (expelled.has(playerId)) status = 'expelled';
    else if (entered.has(playerId)) status = 'entered';
    else status = 'available';
    return { playerId, status };
  });

  const eligibleInIds = bench
    .filter((b) => b.status === 'available')
    .map((b) => b.playerId);

  return { onField, onFieldIds, bench, eligibleInIds };
}
