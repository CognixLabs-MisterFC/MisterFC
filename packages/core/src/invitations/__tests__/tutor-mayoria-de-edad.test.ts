import { describe, expect, it } from 'vitest';
import {
  findAcceptProblems,
  isValidBirthDate,
  isValidChildDob,
  mapAcceptRpcError,
  type AcceptFormRules,
} from '../index';

/**
 * LA MAYORÍA DE EDAD DEL TUTOR, que ahora se DECLARA y antes se calculaba.
 *
 * De dónde viene este fichero: la mig 20261099000000 decide con `profiles.date_of_birth`
 * si alguien puede figurar como tutor, así que la pantalla de aceptar empezó a pedir esa
 * fecha (#720, con un suelo de 18 años y todo lo que hacía falta para que no entrara la
 * de un menor).
 *
 * POR QUÉ SE CAMBIÓ POR UNA CASILLA. Porque nadie pone su edad en un formulario de alta.
 * Lo medido en producción fueron dos perfiles con `2020-01-01` —un relleno, ni siquiera
 * la fecha de un niño—, y con ella dentro el trigger rechazaba el alta desde la base de
 * datos. Un dato que se rellena mal no mide nada.
 *
 * Y lo que se pierde, dicho aquí para que no se olvide: la casilla es una AFIRMACIÓN.
 * El candado que sigue midiendo es la vía (a) de aquella migración —la cuenta propia de
 * un jugador menor, sobre `players.date_of_birth`, que es NOT NULL y está al 100%—, y no
 * pasa por esta pantalla.
 */

function rules(over: Partial<AcceptFormRules> = {}): AcceptFormRules {
  return {
    requireTerms: false,
    requirePrivacy: false,
    children: [],
    requireChildData: false,
    requireProfile: false,
    requireOwnPassword: false,
    requireAdultDeclaration: false,
    ...over,
  };
}

function form(entries: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const codes = (fd: FormData, r: AcceptFormRules) =>
  findAcceptProblems(fd, r).map((p) => p.code);

describe('cuándo se pide la declaración de mayoría de edad', () => {
  it('no se pide si este alta no le hace tutor de nadie', () => {
    // El entrenador que acepta su segundo club. Un clic, como siempre.
    expect(codes(form(), rules({ requireAdultDeclaration: false }))).toEqual([]);
  });

  it('se pide, y falta, cuando el alta le hace tutor', () => {
    expect(codes(form(), rules({ requireAdultDeclaration: true }))).toEqual([
      'adult_declaration_required',
    ]);
  });

  it('marcada, no falta nada', () => {
    expect(
      codes(form({ declare_adult: 'true' }), rules({ requireAdultDeclaration: true })),
    ).toEqual([]);
  });

  it('solo vale el valor exacto que manda la casilla', () => {
    // Un checkbox sin marcar NO viaja en el FormData, así que lo normal es que la clave
    // no exista. Pero el formulario lleva `noValidate` y un POST a mano puede mandar lo
    // que quiera: `on` (el valor por defecto de HTML si a alguien se le olvida el
    // `value`), `false`, o una cadena vacía. Ninguno es una declaración.
    for (const valor of ['', 'on', 'false', 'TRUE', '1', 'sí']) {
      expect(
        codes(form({ declare_adult: valor }), rules({ requireAdultDeclaration: true })),
        `«${valor}» no puede contar como declaración`,
      ).toEqual(['adult_declaration_required']);
    }
  });

  it('el aviso es del tutor, no de ningún hijo', () => {
    const [p] = findAcceptProblems(form(), rules({ requireAdultDeclaration: true }));
    expect(p?.playerId).toBeUndefined();
  });

  it('la fecha de nacimiento ya no se pide ni se mira: enviarla no cambia nada', () => {
    // Lo que queda de #720. Si alguien manda `date_of_birth` a mano —o si un navegador
    // rellena el campo de otra pantalla—, no puede ni faltar ni sobrar ni bloquear.
    const conTutor = rules({ requireAdultDeclaration: true });
    expect(codes(form({ declare_adult: 'true', date_of_birth: '2020-01-01' }), conTutor)).toEqual(
      [],
    );
    expect(codes(form({ declare_adult: 'true', date_of_birth: 'no es fecha' }), conTutor)).toEqual(
      [],
    );
  });
});

describe('qué es una fecha de nacimiento válida (la del HIJO, la que sigue pidiéndose)', () => {
  it.each(['1985-04-04', '2014-08-08', '1900-01-01'])('%s vale', (d) => {
    expect(isValidBirthDate(d)).toBe(true);
  });

  it.each([
    ['formato con barras', '04/04/1985'],
    ['vacía', ''],
    ['solo el año', '1985'],
    ['mes 13', '1985-13-01'],
    ['antes de 1900', '1899-12-31'],
  ])('%s no vale', (_caso, d) => {
    expect(isValidBirthDate(d)).toBe(false);
  });

  it('una fecha futura no vale', () => {
    const manana = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    expect(isValidBirthDate(manana)).toBe(false);
  });

  it('la de un menor VALE, y tiene que valer: es la del hijo', () => {
    // Aquí estaba el suelo de 18 años, y este es el motivo de que nunca pudiera vivir
    // en esta función: con él, no se podría dar de alta a un solo niño.
    expect(isValidChildDob('2020-01-01')).toBe(true);
    expect(isValidBirthDate('2020-01-01')).toBe(true);
  });

  it('la del hijo y la del formulario son LA MISMA regla', () => {
    for (const d of ['1985-04-04', '04/04/1985', '', '1899-12-31', '2014-08-08']) {
      expect(isValidChildDob(d)).toBe(isValidBirthDate(d));
    }
  });
});

describe('el error de la mig 20261099000000 llega con nombre propio', () => {
  /**
   * La regla SIGUE EN PIE y su mensaje sigue haciendo falta: aunque esta pantalla ya no
   * escriba ninguna fecha, el trigger salta por la vía (a) —la cuenta propia de un
   * jugador menor a la que se hace tutor de otro— y por cualquier fecha de menor que
   * haya quedado guardada de antes o que alguien se ponga desde Perfil.
   */
  it('«tutor_menor_de_edad» no cae en genérico', () => {
    expect(mapAcceptRpcError('new row violates: tutor_menor_de_edad')).toBe(
      'tutor_menor_de_edad',
    );
  });

  it('los demás códigos siguen donde estaban', () => {
    expect(mapAcceptRpcError('reserved_for_tutor')).toBe('reserved_for_tutor');
    expect(mapAcceptRpcError('account_deletion_in_progress')).toBe(
      'account_deletion_in_progress',
    );
    expect(mapAcceptRpcError('consent_required')).toBe('consent_required');
  });

  it('lo que no reconoce sigue siendo genérico', () => {
    expect(mapAcceptRpcError('cualquier otra cosa')).toBe('generic');
    expect(mapAcceptRpcError(null)).toBe('generic');
  });

  it('el código del trigger hermano NO se confunde con este', () => {
    expect(mapAcceptRpcError('self_sin_tutor')).not.toBe('tutor_menor_de_edad');
  });
});
