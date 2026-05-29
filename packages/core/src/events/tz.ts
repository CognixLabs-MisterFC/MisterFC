/**
 * Helpers TZ-aware sobre `Intl.DateTimeFormat`.
 *
 * El generador de recurrencia (recurrence.ts) necesita preservar la HORA LOCAL
 * (ej. 18:00 Europe/Madrid) a través de cambios DST. JS `Date` + UTC math no
 * resuelven esto solos: aritmética pura en UTC desplaza la hora local cuando
 * el offset cambia (último domingo de marzo: UTC+1 → UTC+2 en Madrid).
 *
 * Esta solución es portátil (Intl está en todos los runtimes ES2020+),
 * agnóstica de framework y sin dependencias externas. Aproximadamente 60 LoC
 * que `date-fns-tz` resolvería con ~10 KB extra de bundle.
 */

export type ZonedFields = {
  year: number;
  /** 0-based, como JS Date. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Componentes locales (Y/M/D/h/m/s) del Date UTC dado en la zona indicada.
 */
export function zonedFields(date: Date, timeZone: string): ZonedFields {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of parts) {
    const v = parseInt(p.value, 10);
    if (p.type === 'year') year = v;
    else if (p.type === 'month') month = v - 1;
    else if (p.type === 'day') day = v;
    else if (p.type === 'hour') hour = v === 24 ? 0 : v;
    else if (p.type === 'minute') minute = v;
    else if (p.type === 'second') second = v;
  }
  return { year, month, day, hour, minute, second };
}

/**
 * Convierte componentes locales (Y/M/D/h/m) en la zona indicada al Date UTC
 * equivalente. Resuelve offsets DST en dos pasadas (cubre el caso del salto
 * en sí mismo: una sola pasada falla cuando el offset cambia entre la
 * estimación y el ajuste).
 *
 * - Tiempo local ambiguo en fall-back DST: devuelve el instante UTC posterior
 *   (post-transición). Documentado en tests.
 * - Tiempo local inexistente en spring-forward: devuelve el instante UTC tras
 *   el salto. Para los entrenamientos del producto (típicamente 17:00–21:00)
 *   esto nunca ocurre (el salto en Madrid es a las 02:00).
 */
export function fromZonedFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guessMs = Date.UTC(year, month, day, hour, minute);
  let guess = new Date(guessMs);
  let zoned = zonedFields(guess, timeZone);
  const desiredMs = Date.UTC(year, month, day, hour, minute);
  let zonedMs = Date.UTC(
    zoned.year,
    zoned.month,
    zoned.day,
    zoned.hour,
    zoned.minute
  );
  let offset = desiredMs - zonedMs;
  guess = new Date(guessMs + offset);

  // Segunda pasada: si la primera estimación cayó en un instante con offset
  // distinto al que finalmente toca (transición DST), corregir.
  zoned = zonedFields(guess, timeZone);
  zonedMs = Date.UTC(
    zoned.year,
    zoned.month,
    zoned.day,
    zoned.hour,
    zoned.minute
  );
  offset = desiredMs - zonedMs;
  if (offset !== 0) {
    guess = new Date(guess.getTime() + offset);
  }
  return guess;
}

/**
 * Día de la semana ISO (0=lun … 6=dom) del Date UTC en la zona indicada.
 */
export function zonedIsoWeekday(date: Date, timeZone: string): number {
  const z = zonedFields(date, timeZone);
  // Construye una fecha pivote en UTC con los mismos Y/M/D y lee getUTCDay().
  // Esto da el día de la semana local sin importar la hora.
  const pivot = new Date(Date.UTC(z.year, z.month, z.day));
  const js = pivot.getUTCDay(); // 0=Sunday..6=Saturday
  return (js + 6) % 7;
}
