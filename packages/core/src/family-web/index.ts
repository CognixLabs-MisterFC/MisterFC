/**
 * W-A — cierre de la web para las familias.
 *
 * La regla («¿quién ha dejado de usar el navegador?») en `rules`, y la decisión del
 * corte —con su interruptor y su criterio ante una lectura fallida— en `cut`.
 *
 * Lo que se aplica en `apps/web` (W-B) son los dos layouts y la página de destino; lo
 * que se decide, se decide aquí, que es donde hay tests.
 */
export * from './cut';
export * from './rules';
