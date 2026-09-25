import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * I-2 — CENSO de los bloques de la pantalla de aceptar invitación.
 *
 * QUÉ SE PROTEGE. Al invitar, el club escribe el nombre del NIÑO, la fecha de
 * nacimiento del NIÑO, su equipo y el correo del TUTOR. En la pantalla de aceptar hay
 * que dejar claro qué bloque es de quién, y no es una preferencia de diseño: la fecha
 * del tutor decide si puede figurar como tutor (mig 20261099000000), y con los campos
 * del tutor sin dueño escrito —«Nombre completo», «Fecha de nacimiento»— y «Datos de
 * tu hijo/a» justo debajo, el alta acababa rechazada desde la base de datos.
 *
 * POR QUÉ UN CENSO QUE LEE EL FICHERO, y no un render: `apps/web` no tiene runner de
 * tests, y este componente es de cliente con `next-intl`. Es el mismo argumento por el
 * que SU-7 censa los dos muros de pago leyéndolos. Lo que se vigila es lo que se
 * OLVIDA: hay TRES formularios para tres puertas de entrada, y hasta I-2 dos de ellos
 * no pintaban ni el nombre del niño. Un cuarto flujo, o un quinto, nacería igual de
 * mudo y nadie se enteraría: la pantalla funciona perfectamente sin esos bloques.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'apps/web/vercel.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${process.cwd()}`);
}

const RUTA = 'apps/web/src/app/[locale]/invite/[token]/accept-form.tsx';
const FUENTE = readFileSync(join(repoRoot(), RUTA), 'utf8');

/**
 * El cuerpo de cada formulario exportado. Se corta entre `export function` y el
 * siguiente, que es lo único estable sin parsear TSX de verdad.
 */
function cuerpos(): { nombre: string; cuerpo: string }[] {
  const marcas = [...FUENTE.matchAll(/export function (\w+)\(/g)];
  return marcas.map((m, i) => ({
    nombre: m[1] as string,
    cuerpo: FUENTE.slice(m.index, marcas[i + 1]?.index ?? FUENTE.length),
  }));
}

const FORMULARIOS = cuerpos().filter((f) => f.nombre.endsWith('Form'));

describe('los tres formularios de aceptar invitación', () => {
  // Control positivo: sin esto, un corte que no encontrara nada dejaría todos los
  // `it.each` de abajo sin ejecutar y el fichero pasaría en verde sin mirar nada.
  it('son TRES, uno por puerta de entrada', () => {
    expect(FORMULARIOS.map((f) => f.nombre).sort()).toEqual([
      'AcceptForm',
      'AcceptWithProfileForm',
      'SignInToAcceptForm',
    ]);
  });

  it.each(FORMULARIOS.map((f) => f.nombre))(
    '%s enseña los datos del niño, para editar o para leer',
    (nombre) => {
      const { cuerpo } = FORMULARIOS.find((f) => f.nombre === nombre)!;
      const pinta =
        cuerpo.includes('<ChildDataSection') || cuerpo.includes('<ChildSummarySection');
      expect(
        pinta,
        `${nombre} no pinta ni <ChildDataSection> (confirmar y corregir) ni ` +
          `<ChildSummarySection> (solo lectura). Quien acepta no vería a quién está ` +
          `aceptando, y la fecha de nacimiento que el club ya nos dio no saldría en ` +
          `ninguna parte.`,
      ).toBe(true);
    },
  );
});

describe('el marco que dice de quién es cada dato', () => {
  it('el bloque del tutor se abre y se cierra en los dos sitios donde hay datos suyos', () => {
    // `AdultDeclarationField` (flujos rápido y de cuenta existente) y el bloque de
    // perfil (invitado nuevo). Los dos envueltos: es el único sitio donde se dice que
    // eso es de quien acepta y no del jugador.
    expect(FUENTE.match(/<TutorBlock>/g)?.length).toBe(2);
    expect(FUENTE.match(/<\/TutorBlock>/g)?.length).toBe(2);
  });

  it('el bloque del tutor dice de quién son los datos, no solo «tus datos»', () => {
    expect(FUENTE).toContain("t('tutor_data_title')");
    expect(FUENTE).toContain("t('tutor_data_help')");
  });

  it('la casilla de mayoría de edad se pinta en los dos sitios, con su nombre exacto', () => {
    // El servidor la revalida leyendo `declare_adult` del FormData: si el `name` del
    // input cambiara en uno de los dos sitios, la casilla se marcaría y el alta se
    // rechazaría igual, sin que nada explique por qué.
    expect(FUENTE.match(/name="declare_adult"/g)?.length).toBe(2);
    expect(FUENTE.match(/adult_declaration_label/g)?.length).toBe(2);
  });

  it('y la FECHA del tutor ya no se pide en ninguna parte', () => {
    // Lo que se retira con la decisión de producto: nadie pone su edad en un
    // formulario así, y al escribir la del hijo por error el alta se caía desde la
    // base de datos. Lo que queda es la declaración. Si alguien repusiera el campo,
    // volvería el mismo fallo: la fecha se guarda en una sentencia y el vínculo se
    // crea en otra.
    expect(FUENTE).not.toContain('name="date_of_birth"');
    expect(FUENTE).not.toContain('tutor_dob_hint');
  });

  it('la fecha del niño se formatea con intlLocale, nunca con el locale crudo', () => {
    // `va` no es un locale de Intl y cae a en-US (#630). Lo vigila también
    // `check:intl-locale`; aquí queda fijado junto al resto del bloque.
    expect(FUENTE).toContain('intlLocale(locale)');
    expect(FUENTE).not.toMatch(/Intl\.DateTimeFormat\(locale\b/);
  });
});
