import { describe, expect, it } from 'vitest';
import {
  findAcceptProblems,
  isValidBirthDate,
  isValidChildDob,
  mapAcceptRpcError,
  type AcceptFormRules,
} from '../index';

/**
 * LA FECHA DE NACIMIENTO DEL TUTOR.
 *
 * Por qué existe este fichero: la mig 20261099000000 decide con
 * `profiles.date_of_birth` si alguien puede figurar como tutor, y esa columna
 * estaba al 0% en los vínculos vivos —medido: 0 de 9—. El flujo rápido no la pedía
 * y el del invitado nuevo la pedía con la etiqueta «(opcional)». Un candado sobre un
 * dato que nadie rellena no cierra nada.
 *
 * Lo que se fija aquí es cuándo se pide y cuándo NO: solo cuando el alta convierte a
 * quien acepta en tutor de alguien. A un entrenador que acepta la invitación de un
 * segundo club no se le pregunta nada, y su alta sigue siendo de un clic.
 */

function rules(over: Partial<AcceptFormRules> = {}): AcceptFormRules {
  return {
    requireTerms: false,
    requirePrivacy: false,
    children: [],
    requireChildData: false,
    requireProfile: false,
    requireOwnPassword: false,
    requireTutorDob: false,
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

describe('cuándo se pide la fecha del tutor', () => {
  it('no se pide si este alta no le hace tutor de nadie', () => {
    // El entrenador que acepta su segundo club. Un clic, como siempre.
    expect(codes(form(), rules({ requireTutorDob: false }))).toEqual([]);
  });

  it('se pide, y falta, cuando el alta le hace tutor', () => {
    expect(codes(form(), rules({ requireTutorDob: true }))).toEqual([
      'date_of_birth_required',
    ]);
  });

  it('con una fecha válida no falta nada', () => {
    expect(
      codes(form({ date_of_birth: '1985-04-04' }), rules({ requireTutorDob: true })),
    ).toEqual([]);
  });

  it('distingue «falta» de «no vale»: son dos avisos distintos', () => {
    // El aviso tiene que decir qué hacer. «Falta» manda a rellenar; «no vale»,
    // a corregir. Con un solo código, uno de los dos mensajes miente.
    expect(codes(form({ date_of_birth: '' }), rules({ requireTutorDob: true }))).toEqual([
      'date_of_birth_required',
    ]);
    expect(
      codes(form({ date_of_birth: '04/04/1985' }), rules({ requireTutorDob: true })),
    ).toEqual(['date_of_birth_invalid']);
  });

  it('los espacios en blanco no cuentan como fecha', () => {
    expect(
      codes(form({ date_of_birth: '   ' }), rules({ requireTutorDob: true })),
    ).toEqual(['date_of_birth_required']);
  });

  it('el aviso es del tutor, no de ningún hijo', () => {
    const [p] = findAcceptProblems(form(), rules({ requireTutorDob: true }));
    expect(p?.playerId).toBeUndefined();
  });
});

describe('qué es una fecha de nacimiento válida', () => {
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

  it('la del hijo y la del tutor son LA MISMA regla', () => {
    // Si divergieran, el mismo día sería válido para un hijo y no para su padre.
    for (const d of ['1985-04-04', '04/04/1985', '', '1899-12-31', '2014-08-08']) {
      expect(isValidChildDob(d)).toBe(isValidBirthDate(d));
    }
  });
});

describe('el error de la mig 20261099000000 llega con nombre propio', () => {
  it('«tutor_menor_de_edad» no cae en genérico', () => {
    // Sin esto, quien se equivoque de año al teclear su fecha lee «ha ocurrido un
    // error» y no sabe dónde mirar. Es el mismo fallo que costó encontrar el BUG-4.
    expect(
      mapAcceptRpcError('new row violates: tutor_menor_de_edad'),
    ).toBe('tutor_menor_de_edad');
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
    // `self_sin_tutor` (migs 20261097/98) es otra regla y otro mensaje. Hoy no está
    // mapeado y cae en genérico; lo que se fija aquí es que no lo absorba este.
    expect(mapAcceptRpcError('self_sin_tutor')).not.toBe('tutor_menor_de_edad');
  });
});
