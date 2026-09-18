import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatICU, type Messages } from '../format';

/**
 * CENSO DE PLURALES del catálogo.
 *
 * #589 arregló las dos cadenas reportadas («1 entrenos registrados») y dejó anotadas las
 * demás: contadores con el sustantivo en plural fijo, o con el truco `convocado(s)`, que
 * es lo mismo escrito a mano. El motor ICU ya existía —`formatICU`, con `plural` y `#`—
 * así que no hacía falta código: solo reescribir las cadenas. Esto es lo que impide que
 * vuelvan.
 *
 * Lo que se comprueba NO es la traducción (eso no lo puede saber un test) sino tres
 * invariantes que sí se pueden romper sin darse cuenta:
 *
 *   [1] Toda rama plural RENDERIZA limpia en los tres idiomas. Una llave sin cerrar o un
 *       selector mal escrito no lanza: deja `{`, `}` o `#` en pantalla.
 *   [2] Los tres idiomas pluralizan LAS MISMAS claves. Pluralizar el castellano y
 *       olvidar el valenciano no da ningún error: da «1 jugadors».
 *   [3] El truco `(s)` no vuelve a una cadena que lleve un contador. Se permite donde no
 *       hay número —«¿Para qué parte(s) de la sesión sirve?» es una pregunta, no un
 *       recuento—, que es el único caso que queda hoy en el catálogo.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..', '..');
const LOCALES = ['es', 'en', 'va'] as const;

function catalogo(loc: string): Messages {
  return JSON.parse(readFileSync(join(RAIZ, 'messages', `${loc}.json`), 'utf8')) as Messages;
}

function plano(o: Messages, p = ''): Array<[string, string]> {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string'
      ? ([[`${p}${k}`, v]] as Array<[string, string]>)
      : plano(v, `${p}${k}.`),
  );
}

const CATALOGOS = Object.fromEntries(LOCALES.map((l) => [l, plano(catalogo(l))])) as Record<
  (typeof LOCALES)[number],
  Array<[string, string]>
>;

/** Los nombres de argumento que aparecen en la cadena, para poder darles un valor. */
function argumentos(plantilla: string): string[] {
  return [...plantilla.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]!);
}

const conPlural = (loc: (typeof LOCALES)[number]) =>
  CATALOGOS[loc].filter(([, v]) => v.includes(', plural,'));

describe('censo de plurales del catálogo', () => {
  it('hay plurales que censar (si esto falla, el censo está midiendo el vacío)', () => {
    expect(conPlural('es').length).toBeGreaterThan(50);
  });

  // [1] — el motor de verdad, con los tres números que cambian de rama.
  it.each(LOCALES)('%s: toda rama plural renderiza limpia con 0, 1 y 2', (loc) => {
    const sucias: string[] = [];
    for (const [clave, plantilla] of conPlural(loc)) {
      for (const n of [0, 1, 2]) {
        const values = Object.fromEntries(argumentos(plantilla).map((a) => [a, n]));
        const out = formatICU(plantilla, values, loc);
        if (out.includes('{') || out.includes('}') || out.includes('#') || out.trim() === '') {
          sucias.push(`${clave} (${loc}, n=${n}) → ${out}`);
        }
      }
    }
    expect(sucias).toEqual([]);
  });

  // [2] — pluralizar un idioma y olvidar otro no da error: da «1 jugadors».
  it('los tres idiomas pluralizan exactamente las mismas claves', () => {
    const es = conPlural('es').map(([k]) => k).sort();
    expect(conPlural('en').map(([k]) => k).sort()).toEqual(es);
    expect(conPlural('va').map(([k]) => k).sort()).toEqual(es);
  });

  // [3] — el truco escrito a mano, que es de lo que veníamos.
  it.each(LOCALES)('%s: ningún contador usa el truco «(s)»', (loc) => {
    const trucadas = CATALOGOS[loc]
      .filter(([, v]) => /\([soae]+\)/.test(v) && /\{\w+[,}]/.test(v))
      .map(([k, v]) => `${k} → ${v}`);
    expect(trucadas).toEqual([]);
  });
});

/**
 * Y la prueba humana: seis renderizados concretos, escritos a mano. El censo de arriba
 * dice que la sintaxis está bien; esto dice que el TEXTO está bien, que es lo que lee
 * una familia.
 */
describe('las cadenas que se reescribieron, renderizadas', () => {
  const t = (loc: (typeof LOCALES)[number], clave: string, values: Record<string, number>) => {
    const fila = CATALOGOS[loc].find(([k]) => k === clave);
    expect(fila, `${clave} no existe en ${loc}`).toBeTruthy();
    return formatICU(fila![1], values, loc);
  };

  it('el contador de informes pendientes', () => {
    expect(t('es', 'home.direccion.reports_pending', { count: 1 })).toBe('1 pendiente');
    expect(t('es', 'home.direccion.reports_pending', { count: 4 })).toBe('4 pendientes');
    expect(t('va', 'home.direccion.reports_pending', { count: 1 })).toBe('1 pendent');
  });

  it('las invitaciones sin aceptar, en los tres idiomas', () => {
    expect(t('es', 'home.direccion.pending_invitations_cta', { count: 1 })).toBe(
      '1 invitación sin aceptar',
    );
    expect(t('en', 'home.direccion.pending_invitations_cta', { count: 1 })).toBe(
      '1 unaccepted invitation',
    );
    expect(t('va', 'home.direccion.pending_invitations_cta', { count: 1 })).toBe(
      '1 invitació sense acceptar',
    );
  });

  // El verbo también concuerda: «queda 1 día», no «quedan 1 días».
  it('los días que quedan llevan el verbo dentro', () => {
    expect(t('es', 'home.campaign_alert.due_soon', { days: 1, date: 0 })).toContain('¡Queda 1 día!');
    expect(t('es', 'home.campaign_alert.due_soon', { days: 3, date: 0 })).toContain(
      '¡Quedan 3 días!',
    );
  });

  // TRES contadores en la misma cadena, cada uno con su rama.
  it('la alerta del dashboard pluraliza los tres números por separado', () => {
    expect(t('es', 'dashboard.alerts.campaign_soon', { days: 1, pending: 1, teams: 1 })).toBe(
      'Queda 1 día · 1 informe pendiente en 1 equipo',
    );
    expect(t('es', 'dashboard.alerts.campaign_soon', { days: 2, pending: 5, teams: 3 })).toBe(
      'Quedan 2 días · 5 informes pendientes en 3 equipos',
    );
  });

  // Los dos que llevaban el truco «(s)».
  it('los avisos que llevaban «(s)» ya no lo llevan', () => {
    expect(t('es', 'convocatorias.publish.errors.too_many_called_up', { overflow: 1, max: 18 })).toBe(
      'Hay 1 convocado de más (máx 18). Descarta jugadores antes de publicar.',
    );
    expect(t('es', 'partido_directo.timeline.issues_title', { n: 1 })).toBe(
      '1 aviso de coherencia',
    );
    expect(t('es', 'partido_directo.timeline.issues_title', { n: 2 })).toBe(
      '2 avisos de coherencia',
    );
  });

  // El valor llega como STRING desde la app nativa (`String(count)`): el motor hace
  // Number() por dentro, y esto lo fija por si alguien lo cambia.
  it('un contador que llega como texto pluraliza igual', () => {
    const fila = CATALOGOS.es.find(([k]) => k === 'directo_entry.failed')!;
    expect(formatICU(fila[1], { count: '1' }, 'es')).toBe('1 no se pudo guardar');
    expect(formatICU(fila[1], { count: '7' }, 'es')).toBe('7 no se pudieron guardar');
  });
});
