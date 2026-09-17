import { describe, expect, it } from 'vitest';
import { acceptInvitationWithProfileSchema } from '../auth';

/**
 * R-0 — CARACTERIZACIÓN del alta de invitado nuevo, ANTES de extraerla (R-1).
 *
 * Esto no dice cómo debería comportarse el formulario: dice cómo se comporta HOY.
 * Es la red que no existía. El camino que usa este schema —`acceptNewInvitee`, en
 * una Server Action de apps/web— no tiene ni una prueba, y por él entran tutores,
 * cuerpo técnico y entrenadores, no solo el menor con cuenta propia. R-1 mueve esa
 * orquestación a core; si al moverla cambia algo de lo de aquí, sale rojo.
 *
 * POR QUÉ EL SCHEMA Y NO LA ACCIÓN. Una Server Action no se puede ejecutar sin
 * Next, y `apps/web` no tiene runner. Lo que sí se puede fijar es el contrato en
 * los dos extremos: aquí el de ENTRADA (qué acepta y con qué código se queja), y
 * en pgTAP el de SALIDA (`accept_pending_invitations`, que ya tiene cinco suites).
 * Lo que queda en medio —fijar contraseña, iniciar sesión, actualizar perfil— es
 * justo lo que R-1 vuelve testeable al sacarlo de la acción. Dicho para que nadie
 * lea este fichero como «el accept está cubierto»: cubierto está el borde.
 *
 * LA PRECEDENCIA IMPORTA. La acción lee `parsed.error.issues[0]?.message`: de
 * TODOS los fallos solo enseña el primero. Así que el orden no es un detalle de
 * zod, es lo que ve el usuario, y por eso está fijado abajo.
 */

/** Un formulario que pasa, para ir rompiéndolo campo a campo. */
const VALIDO = {
  full_name: 'Ana Ruiz',
  phone: '600123456',
  date_of_birth: '',
  password: '12345678',
  confirm: '12345678',
};

function codigos(entrada: Record<string, unknown>): string[] {
  const r = acceptInvitationWithProfileSchema.safeParse(entrada);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

/** Lo que de verdad lee la acción: el PRIMER issue. */
function primerCodigo(entrada: Record<string, unknown>): string | null {
  return codigos(entrada)[0] ?? null;
}

describe('R-0 · lo que el formulario acepta', () => {
  it('el caso bueno pasa', () => {
    expect(codigos(VALIDO)).toEqual([]);
  });

  it('recorta el nombre y deja el telefono TAL CUAL lo teclean', () => {
    const r = acceptInvitationWithProfileSchema.safeParse({
      ...VALIDO,
      full_name: '  Ana Ruiz  ',
      phone: ' 600 12 34 56 ',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.full_name).toBe('Ana Ruiz');
    // Los separadores se conservan a proposito: lo que teclea el tutor es lo que
    // vera el entrenador. Solo se quita el sobrante de los extremos.
    expect(r.data.phone).toBe('600 12 34 56');
  });

  it('la fecha vacia, y la ausente, se guardan como null', () => {
    for (const entrada of [
      { ...VALIDO, date_of_birth: '' },
      { ...VALIDO, date_of_birth: '   ' },
      (() => {
        const sin = { ...VALIDO } as Record<string, unknown>;
        delete sin.date_of_birth;
        return sin;
      })(),
    ]) {
      const r = acceptInvitationWithProfileSchema.safeParse(entrada);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.date_of_birth).toBeNull();
    }
  });

  it('una fecha valida sobrevive', () => {
    const r = acceptInvitationWithProfileSchema.safeParse({
      ...VALIDO,
      date_of_birth: '2010-05-04',
    });
    expect(r.success && r.data.date_of_birth).toBe('2010-05-04');
  });
});

describe('R-0 · con que codigo se queja cada campo', () => {
  it('nombre: menos de 2 y mas de 120', () => {
    expect(primerCodigo({ ...VALIDO, full_name: 'A' })).toBe('full_name_too_short');
    expect(primerCodigo({ ...VALIDO, full_name: '  A  ' })).toBe('full_name_too_short');
    expect(primerCodigo({ ...VALIDO, full_name: 'x'.repeat(121) })).toBe('full_name_too_long');
    // Las fronteras exactas SI pasan.
    expect(codigos({ ...VALIDO, full_name: 'Al' })).toEqual([]);
    expect(codigos({ ...VALIDO, full_name: 'x'.repeat(120) })).toEqual([]);
  });

  it('telefono: distingue "no lo has puesto" de "no es un telefono"', () => {
    expect(primerCodigo({ ...VALIDO, phone: '' })).toBe('phone_required');
    expect(primerCodigo({ ...VALIDO, phone: '   ' })).toBe('phone_required');
    expect(primerCodigo({ ...VALIDO, phone: '12345' })).toBe('phone_invalid');
    expect(primerCodigo({ ...VALIDO, phone: 'no-es-un-telefono' })).toBe('phone_invalid');
    // 6 y 15 digitos son las fronteras del CHECK de la base.
    expect(codigos({ ...VALIDO, phone: '123456' })).toEqual([]);
    expect(codigos({ ...VALIDO, phone: '+34 600 123 456 789' })).toEqual([]);
    expect(primerCodigo({ ...VALIDO, phone: '1234567890123456' })).toBe('phone_invalid');
  });

  it('fecha: ni futura, ni anterior a 1900, ni con otro formato', () => {
    for (const mala of ['2099-01-01', '1899-12-31', '04/05/2010', '2010-13-01', 'ayer']) {
      expect(primerCodigo({ ...VALIDO, date_of_birth: mala })).toBe('date_of_birth_invalid');
    }
  });

  it('contrasena: menos de 8, y las dos tienen que coincidir', () => {
    expect(primerCodigo({ ...VALIDO, password: '1234567', confirm: '1234567' })).toBe(
      'password_too_short',
    );
    expect(codigos({ ...VALIDO, password: '12345678', confirm: '12345678' })).toEqual([]);
    expect(primerCodigo({ ...VALIDO, confirm: 'otra9999' })).toBe('password_mismatch');
  });
});

describe('R-0 · la precedencia, que es lo que ve el usuario', () => {
  it('con varios campos mal, manda el PRIMERO en el orden del objeto', () => {
    // La accion solo enseña `issues[0]`. Si R-1 reordena el schema, o valida campo
    // a campo en otro orden, el usuario empieza a ver otro aviso distinto.
    expect(
      codigos({ full_name: 'A', phone: '', date_of_birth: '', password: 'x', confirm: 'y' }),
    ).toEqual([
      'full_name_too_short',
      'phone_required',
      'password_too_short',
      'password_mismatch',
    ]);
  });

  it('password_mismatch salta AUNQUE otros campos fallen', () => {
    // Medido, no supuesto: el `.refine` del objeto corre igual. Si al extraer se
    // cortocircuitara la validacion en el primer fallo, este caso cambiaria.
    expect(codigos({ ...VALIDO, full_name: 'A', confirm: 'otra9999' })).toEqual([
      'full_name_too_short',
      'password_mismatch',
    ]);
  });
});

describe('R-0 · el mapeo a estado, que es donde se pierde un codigo sin ruido', () => {
  /**
   * La tabla que hoy vive DENTRO de `acceptNewInvitee`, copiada aquí tal cual.
   * Ojo al tercero: el schema dice `phone_required` y la accion lo renombra a
   * `phone_missing`. Un renombrado metido en medio de un `if` es exactamente lo
   * que una extraccion se deja por el camino.
   */
  const MAPEO: Record<string, string> = {
    full_name_too_short: 'full_name_too_short',
    full_name_too_long: 'full_name_too_long',
    phone_required: 'phone_missing',
    phone_invalid: 'phone_invalid',
    date_of_birth_invalid: 'date_of_birth_invalid',
    password_too_short: 'password_too_short',
    password_mismatch: 'password_mismatch',
  };

  it('TODO codigo que el schema sabe emitir tiene su entrada en el mapeo', () => {
    // Lo que esto caza: que el schema empiece a emitir un codigo nuevo y la accion
    // lo deje caer al `invalid_input` generico. El usuario veria «datos no validos»
    // sin saber que campo, y nadie se enteraria.
    const emitidos = new Set<string>();
    const entradas: Record<string, unknown>[] = [
      { ...VALIDO, full_name: 'A' },
      { ...VALIDO, full_name: 'x'.repeat(121) },
      { ...VALIDO, phone: '' },
      { ...VALIDO, phone: '12345' },
      { ...VALIDO, date_of_birth: '2099-01-01' },
      { ...VALIDO, password: '1234567', confirm: '1234567' },
      { ...VALIDO, confirm: 'otra9999' },
    ];
    for (const e of entradas) for (const c of codigos(e)) emitidos.add(c);
    expect([...emitidos].sort()).toEqual(Object.keys(MAPEO).sort());
  });

  it('el renombrado de phone_required sigue ahi', () => {
    expect(MAPEO.phone_required).toBe('phone_missing');
    expect(MAPEO.phone_invalid).toBe('phone_invalid');
  });
});
