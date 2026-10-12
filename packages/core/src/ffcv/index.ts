export {
  FFCV_BASE,
  FFCV_CABECERA_TOKEN,
  FFCV_ESPERA_429_MS,
  FFCV_ESPERA_MS,
  FFCV_INTENTOS,
  FFCV_INTENTOS_429,
  FFCV_POR_MINUTO,
  FFCV_VENTANA_MS,
  crearMarcapasos,
  describirFallo,
  leerToken,
  motivoDeDegradacion,
  motivoDeRechazo,
  pedirJson,
} from './client';
export type {
  FfcvAhora,
  FfcvConfig,
  FfcvEspera,
  FfcvFallo,
  FfcvResultado,
  Marcapasos,
} from './client';
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
