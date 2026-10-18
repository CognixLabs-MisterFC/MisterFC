import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * La ficha de un jugador la pintan DOS áreas con la MISMA pantalla, y a ella se
 * llega tocando un nombre en la plantilla:
 *
 *   · DIRECCIÓN — desde el menú → Jugadores y desde la plantilla de cada equipo.
 *   · CUERPO TÉCNICO — desde la plantilla de su equipo y, el coordinador, desde
 *     su lista de jugadores. Necesita su propio fichero de ruta porque un
 *     entrenador NO puede entrar en el área de dirección (`isAllowedInArea`).
 *
 * Lo que vigila esto es que no se separen: que la pantalla siga siendo una, que
 * no se ate a un área, que las dos superficies de staff lleven de verdad a ella
 * —un `push` a una ruta mal escrita no da error de tipos, solo un toque muerto— y
 * que los bloques de la ficha no vuelvan a tener dos copias.
 *
 * Se mira el CÓDIGO FUENTE y no el render: en esta app las pantallas no se
 * renderizan en los tests (decisión documentada en `player-contact/tutor-rows.ts`).
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8');

const COMPARTIDA = 'src/screens/jugador-ficha.tsx';
const SECCIONES = 'src/player-ficha/sections.tsx';
const RUTA_DIRECCION = 'app/direction/jugador.tsx';
const RUTA_STAFF = 'app/staff/jugador.tsx';
const PLANTILLA_STAFF = 'src/screens/staff/equipo-detalle.tsx';
const LISTA_COORD = 'src/screens/staff/jugadores-consulta.tsx';

describe('ficha compartida — una pantalla, dos áreas', () => {
  // ANCLA POSITIVA, primero: si el fixture midiera mal (fichero movido, símbolo
  // renombrado), las ausencias de abajo saldrían verdes por el motivo equivocado.
  it('las dos rutas montan la MISMA pantalla', () => {
    for (const ruta of [RUTA_DIRECCION, RUTA_STAFF]) {
      const src = leer(ruta);
      expect(src, ruta).toContain("from '@/screens/jugador-ficha'");
      expect(src, ruta).toContain('JugadorFichaScreen');
    }
  });

  it('la pantalla compartida no está atada a un área', () => {
    const src = leer(COMPARTIDA);
    // Ni navega ni sabe de dónde la han abierto: recibe `playerId` por parámetro.
    // Lo que se prohíbe es NAVEGAR, no nombrar un área: el primer intento de este
    // aserto buscaba la cadena '/direction/' y se puso rojo contra su propio
    // comentario de cabecera, que explica por qué la pantalla se movió de allí.
    expect(src).toContain('useLocalSearchParams');
    expect(src).not.toContain('router.push');
    expect(src).not.toMatch(/pathname:/);
  });
});

describe('ficha compartida — por dónde se entra', () => {
  it('la plantilla del equipo (staff) abre la ficha', () => {
    const src = leer(PLANTILLA_STAFF);
    expect(src).toContain('/staff/jugador');
    expect(src).toContain('playerId');
  });

  it('la lista de jugadores del coordinador abre la ficha', () => {
    const src = leer(LISTA_COORD);
    expect(src).toContain('/staff/jugador');
    expect(src).toContain('playerId');
  });

  // El contrario del caso de arriba, y el que de verdad importa: la plantilla de
  // FAMILIA son los compañeros del hijo, y abrir sus fichas sería enseñarle a un
  // padre los datos del hijo de otro. Lo vigila también
  // `plantilla-compartida.test.ts` desde el otro lado (el prop `onOpenPlayer`).
  it('familia no abre la ficha de nadie', () => {
    const src = leer('app/family/plantilla.tsx');
    expect(src).not.toContain('jugador');
  });
});

describe('los bloques de la ficha viven en UN sitio', () => {
  /** Ficheros .tsx de la app, salvo el módulo compartido. */
  function fuentesSalvoSecciones(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith('.tsx') && rel !== SECCIONES) out.push(rel);
      }
    };
    walk('src');
    return out;
  }

  // La razón de existir de `player-ficha/sections`: "Mi ficha" y la ficha de staff
  // tenían cada una su copia de estos bloques, y dos copias no dan un fallo — dan
  // dos fichas que se parecen cada vez menos. Estas tres cadenas son de dentro de
  // los bloques (carrera, asistencia, ratios): si reaparecen en otro fichero, es
  // que alguien ha vuelto a copiarlos.
  it.each(['ficha.career_total', 'ficha.att_present', 'ficha.goals_per_match'])(
    '«%s» solo se escribe en el módulo compartido',
    (clave) => {
      const copias = fuentesSalvoSecciones().filter((f) => leer(f).includes(clave));
      expect(copias, `también en: ${copias.join(', ')}`).toEqual([]);
      // Y está donde debe: el aserto de arriba también pasaría si la cadena no
      // existiera en ningún sitio.
      expect(leer(SECCIONES)).toContain(clave);
    },
  );
});
