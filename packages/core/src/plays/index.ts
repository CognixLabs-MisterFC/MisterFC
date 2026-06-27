/**
 * API pública del módulo de JUGADAS de estrategia: tipo de estrategia + catálogo de
 * señas (pictogramas). El contrato de la jugada animada (`Play`/frames) vive en
 * `diagram/play.ts`.
 */

export {
  STRATEGY_TYPES,
  PLAY_SIGNAL_IDS,
  PLAY_SIGNAL_VIEWBOX,
  PLAY_SIGNAL_CATALOG,
  isStrategyType,
  isPlaySignalId,
  getPlaySignal,
  type StrategyType,
  type PlaySignalId,
  type SignalShape,
  type PlaySignal,
} from './signals';
