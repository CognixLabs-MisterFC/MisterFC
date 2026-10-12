export {
  FFCV_BASE,
  FFCV_CABECERA_TOKEN,
  FFCV_ESPERA_MS,
  FFCV_INTENTOS,
  describirFallo,
  leerToken,
  motivoDeDegradacion,
  motivoDeRechazo,
  pedirJson,
} from './client';
export type { FfcvConfig, FfcvFallo, FfcvResultado } from './client';
export { aIsoUtc, partirFecha, partirHora } from './fecha';
export {
  FFCV_CAMPOS_MAX_PAGINAS,
  FFCV_CAMPOS_POR_PAGINA,
  componerDireccion,
  descargarCatalogoCampos,
  direccionEnCatalogo,
  leerDatosCampo,
} from './campos';
export {
  leerCalendarioDeEquipo,
  leerFichaEquipo,
  leerJornadas,
  leerPartidosDeJornada,
  limpiarNombreEquipo,
  mapearPartido,
  resolverUbicacion,
} from './calendario';
export type { CalendarioFfcv } from './calendario';
export type {
  CampoCrudo,
  CompeticionCruda,
  DireccionCampo,
  EquipoDeClubCrudo,
  FfcvFetch,
  GrupoCrudo,
  JornadaCruda,
  PartidoCrudo,
  PartidoFfcv,
  UbicacionCompetitiva,
  VerEquipoCrudo,
} from './types';
export { CAMPO_MAX, RIVAL_MAX, TITULO_MAX, tituloDePartido } from './titulo';
export {
  JORNADA_MAX,
  JORNADA_MIN,
  filaDeEvento,
  importarCalendarioDeEquipoFromClient,
  importarCalendariosFromClient,
  leerEquiposDelClubFromClient,
  revisarPartido,
} from './importar';
export type {
  DepsImportacion,
  EquipoParaImportar,
  EquiposDelClub,
  PartidoOmitido,
  ResumenEquipo,
} from './importar';
