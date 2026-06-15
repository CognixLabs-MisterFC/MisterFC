/**
 * F7.4b — Faltas detalladas + córner a favor/en contra (PURO, sin DOM ni red).
 *
 * Refina los eventos de campo genéricos de 7.4 (`foul`, `corner`) con el bando
 * implicado, manteniendo el `match_events.type` existente (no hace falta migrar):
 *
 *  - FALTA (`type='foul'`, `side='own'`, `metadata.foul_kind`):
 *      'committed' → falta COMETIDA por nuestro equipo, `player_id` = quien la comete;
 *      'received'  → falta que NOS hacen, `player_id` = nuestro jugador que la recibe.
 *      Ambas con `x_pct`/`y_pct` (ubicación en el campo).
 *  - CÓRNER (`type='corner'`, `side='own'`, `metadata.corner_side`):
 *      'for'     → córner a favor; 'against' → córner en contra. Sin jugador ni coords.
 *
 * Compatibilidad: un `foul` antiguo (7.4) sin `foul_kind` se cuenta como COMETIDA
 * (la "falta" genérica era nuestra); un `corner` antiguo sin `corner_side`, como
 * A FAVOR. Todo se deriva de `match_events` → sobrevive a recargas.
 */

export type FoulKind = 'committed' | 'received';
export const FOUL_KINDS: readonly FoulKind[] = ['committed', 'received'] as const;
export function isFoulKind(value: string): value is FoulKind {
  return (FOUL_KINDS as readonly string[]).includes(value);
}

export type CornerSide = 'for' | 'against';
export const CORNER_SIDES: readonly CornerSide[] = ['for', 'against'] as const;
export function isCornerSide(value: string): value is CornerSide {
  return (CORNER_SIDES as readonly string[]).includes(value);
}

/** Proyección mínima de un evento de equipo (foul/corner) para los contadores. */
export interface TeamEventLite {
  type: string;
  playerId?: string | null;
  /** `metadata.foul_kind` (solo `foul`). */
  foulKind?: string | null;
  /** `metadata.corner_side` (solo `corner`). */
  cornerSide?: string | null;
}

export interface TeamEventTallies {
  foulsCommitted: number;
  foulsReceived: number;
  cornersFor: number;
  cornersAgainst: number;
}

/**
 * Contadores de faltas (propias/recibidas) y córners (a favor/en contra) desde
 * los eventos propios de campo. Defaults de compatibilidad: `foul` sin
 * `foul_kind` → cometida; `corner` sin `corner_side` → a favor.
 */
export function computeTeamEventTallies(
  events: readonly TeamEventLite[],
): TeamEventTallies {
  let foulsCommitted = 0;
  let foulsReceived = 0;
  let cornersFor = 0;
  let cornersAgainst = 0;
  for (const e of events) {
    if (e.type === 'foul') {
      if (e.foulKind === 'received') foulsReceived += 1;
      else foulsCommitted += 1;
    } else if (e.type === 'corner') {
      if (e.cornerSide === 'against') cornersAgainst += 1;
      else cornersFor += 1;
    }
  }
  return { foulsCommitted, foulsReceived, cornersFor, cornersAgainst };
}

/**
 * Faltas COMETIDAS atribuidas a cada jugador propio (disciplina). Las faltas
 * RECIBIDAS no se atribuyen aquí (las comete el rival; nuestro jugador solo las
 * recibe). Un `foul` sin `foul_kind` cuenta como cometida (compat 7.4).
 */
export function foulsByPlayer(
  events: readonly TeamEventLite[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'foul') continue;
    if (e.foulKind === 'received') continue;
    if (!e.playerId) continue;
    counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Faltas RECIBIDAS atribuidas a cada jugador propio (`foul_kind='received'`,
 * §7.4b: `player_id` = quien la recibe). Espejo de `foulsByPlayer` para la
 * consolidación al cierre (7.10). Las cometidas (incluido el `foul` legacy sin
 * `foul_kind`) no entran aquí.
 */
export function foulsReceivedByPlayer(
  events: readonly TeamEventLite[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'foul') continue;
    if (e.foulKind !== 'received') continue;
    if (!e.playerId) continue;
    counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1);
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// F7.x (X.0) — Agregados de equipo del PARTIDO (a favor / en contra de ambos
// bandos). PURO, deriva solo de `match_events`. La vista de estadísticas del
// partido (X.1) lo consume; el marcador NO va aquí (eso es `computeScore`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proyección mínima de un `match_event` para los agregados de equipo. Cubre los
 * dos ejes del modelo real:
 *  - `side` ('own'/'rival') → bando que ES SUJETO del evento. Lo usan tiro,
 *    tarjeta y offside (el del rival se captura con `side='rival'`,
 *    `RIVAL_EVENT_TYPES`).
 *  - `metadata` → córner (`corner_side` for/against) y falta (`foul_kind`
 *    committed/received) se capturan SIEMPRE con `side='own'`; el bando se
 *    deriva del metadata, no del `side`.
 */
export interface MatchTeamStatEvent {
  side: 'own' | 'rival';
  type: string;
  /** `metadata.foul_kind` (solo `foul`): 'committed' | 'received'. */
  foulKind?: string | null;
  /** `metadata.corner_side` (solo `corner`): 'for' | 'against'. */
  cornerSide?: string | null;
}

/**
 * Par de contadores por bando. Convención **única y consistente** para todas las
 * métricas: `own` = el evento es atribuible a NUESTRO equipo (lo ejecutamos /
 * cometemos / recibimos la tarjeta…); `rival` = atribuible al RIVAL.
 *
 * Mapeo a "a favor / en contra" que hará la UI (X.1), por métrica:
 *  - córners: `own` = a favor · `rival` = en contra.
 *  - faltas:  `own` = cometidas por nosotros (en contra) · `rival` = cometidas
 *             por el rival = las que recibimos (a favor).
 *  - tiros / tarjetas / offsides: `own` = nuestros · `rival` = del rival.
 */
export interface MatchSidePair {
  own: number;
  rival: number;
}

/** Agregados de equipo de un partido (ambos bandos). */
export interface MatchTeamStats {
  /** Córners: `own` = a favor (`corner_side='for'`/legacy), `rival` = en contra. */
  corners: MatchSidePair;
  /** Faltas: `own` = cometidas por nosotros, `rival` = cometidas por el rival. */
  fouls: MatchSidePair;
  /** Tiros (`type='shot'`; no incluye penaltis): `own`/`rival` por `side`. */
  shots: MatchSidePair;
  yellowCards: MatchSidePair;
  redCards: MatchSidePair;
  offsides: MatchSidePair;
}

/**
 * Agrega los eventos de equipo de un partido en contadores a favor/en contra de
 * ambos bandos. Determinista, deriva solo de `match_events`.
 *
 *  - **Córners y faltas**: reusa `computeTeamEventTallies` (córner/falta se
 *    capturan siempre con `side='own'` + metadata; defaults de compat: `foul`
 *    sin `foul_kind` → cometida; `corner` sin `corner_side` → a favor). Se filtra
 *    a `side='own'` defensivamente (no existen filas rival de córner/falta).
 *  - **Tiros, tarjetas (amarilla/roja) y offsides**: por `side` (propio vs
 *    rival; el rival llega con `side='rival'`, `RIVAL_EVENT_TYPES`).
 *
 * El marcador no se calcula aquí (ver `computeScore`).
 */
export function aggregateMatchTeamStats(
  events: readonly MatchTeamStatEvent[],
): MatchTeamStats {
  // Córners y faltas propias (siempre side='own' con metadata) → reusa el motor
  // existente para no duplicar la lógica de for/against ni los defaults legacy.
  const ownTally = computeTeamEventTallies(
    events.filter((e) => e.side === 'own'),
  );

  // Tiros / tarjetas / offsides: el sujeto es el `side` del evento.
  const shots: MatchSidePair = { own: 0, rival: 0 };
  const yellowCards: MatchSidePair = { own: 0, rival: 0 };
  const redCards: MatchSidePair = { own: 0, rival: 0 };
  const offsides: MatchSidePair = { own: 0, rival: 0 };

  const bump = (pair: MatchSidePair, side: 'own' | 'rival') => {
    if (side === 'rival') pair.rival += 1;
    else pair.own += 1;
  };

  for (const e of events) {
    switch (e.type) {
      case 'shot':
        bump(shots, e.side);
        break;
      case 'yellow_card':
        bump(yellowCards, e.side);
        break;
      case 'red_card':
        bump(redCards, e.side);
        break;
      case 'offside':
        bump(offsides, e.side);
        break;
      default:
        break;
    }
  }

  return {
    corners: { own: ownTally.cornersFor, rival: ownTally.cornersAgainst },
    fouls: { own: ownTally.foulsCommitted, rival: ownTally.foulsReceived },
    shots,
    yellowCards,
    redCards,
    offsides,
  };
}
