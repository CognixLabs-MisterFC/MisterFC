import { describe, expect, it } from 'vitest';
import {
  findAcceptProblems,
  isAdultBirthDate,
  isValidBirthDate,
  isValidChildDob,
  mapAcceptRpcError,
  TUTOR_MIN_AGE_YEARS,
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

/**
 * I-1 · EL SUELO DE EDAD. Lo que faltaba, y por qué el fallo se veía como un fallo.
 *
 * `isValidBirthDate` dice «esto es una fecha de nacimiento» y su comentario aclara
 * que es «de quien sea» — tiene razón: la del hijo es de un menor y tiene que pasar.
 * Pero sin suelo de edad, `2020-01-01` era una fecha de TUTOR válida para el
 * formulario: se guardaba en `profiles.date_of_birth` y el trigger de la mig
 * 20261099000000 tumbaba el vínculo DESPUÉS, desde la base de datos, con un mensaje
 * sobre menores de edad que no se podía relacionar con el campo que lo causó.
 *
 * Medido en producción: dos perfiles con `2020-01-01` y `profile_is_minor` en true,
 * sin ningún vínculo — las dos altas rechazadas. Y peor: la fecha mala se quedaba
 * escrita, así que el reintento fallaba igual, para siempre.
 */
describe('la fecha del tutor tiene que ser de alguien mayor de edad', () => {
  const deTutor = (dob: string) =>
    codes(form({ date_of_birth: dob }), rules({ requireTutorDob: true }));

  it('la fecha de un niño NO pasa como fecha de tutor', () => {
    // El caso exacto medido en producción.
    expect(deTutor('2020-01-01')).toEqual(['date_of_birth_not_adult']);
  });

  it('y el aviso no es «no válida»: está bien escrita, está mal atribuida', () => {
    // Dos códigos distintos porque los dos mensajes tienen que decir cosas distintas:
    // uno manda a corregir el formato, el otro a poner la fecha de OTRA persona.
    expect(deTutor('2020-01-01')).not.toContain('date_of_birth_invalid');
    expect(deTutor('04/04/1985')).toEqual(['date_of_birth_invalid']);
  });

  it('una fecha de adulto sigue pasando', () => {
    expect(deTutor('1985-04-04')).toEqual([]);
  });

  it('quien cumple los 18 HOY es mayor: el límite no excluye su propio día', () => {
    // Mismo criterio que el SQL, donde menor es `date_of_birth > current_date -
    // interval '18 years'`: en la igualdad, mayor. Un `<` aquí y un `<=` allí sería
    // una persona rechazada por el formulario y aceptada por la base de datos.
    const hoy = new Date();
    const justo18 = new Date(
      Date.UTC(hoy.getUTCFullYear() - TUTOR_MIN_AGE_YEARS, hoy.getUTCMonth(), hoy.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    expect(isAdultBirthDate(justo18)).toBe(true);
    expect(deTutor(justo18)).toEqual([]);
  });

  it('un día menos son 17 años y un día: no pasa', () => {
    const hoy = new Date();
    const unDiaMenos = new Date(
      Date.UTC(
        hoy.getUTCFullYear() - TUTOR_MIN_AGE_YEARS,
        hoy.getUTCMonth(),
        hoy.getUTCDate() + 1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    expect(isAdultBirthDate(unDiaMenos)).toBe(false);
  });

  it('el suelo se mira con el reloj que se le pase, no con el del día que corra', () => {
    // Sin `now` inyectable, este fichero caducaría: un test escrito con fechas fijas
    // cambia de veredicto solo por pasar el tiempo.
    const ahora = new Date('2026-09-25T00:00:00Z');
    expect(isAdultBirthDate('2008-09-25', ahora)).toBe(true);
    expect(isAdultBirthDate('2008-09-26', ahora)).toBe(false);
  });

  it('lo que no es una fecha tampoco es de un adulto', () => {
    for (const mala of ['', '   ', '04/04/1985', '1985', '1899-12-31']) {
      expect(isAdultBirthDate(mala)).toBe(false);
    }
  });

  it('la del HIJO no lleva suelo de edad, y no puede llevarlo', () => {
    // Es la mitad de la razón por la que el suelo vive aparte: si `isValidChildDob`
    // exigiera 18 años, no se podría dar de alta a un solo niño.
    expect(isValidChildDob('2020-01-01')).toBe(true);
  });

  it('el campo del tutor y el del hijo no comparten veredicto', () => {
    // La misma fecha: válida para el hijo, rechazada para el tutor.
    expect(isValidChildDob('2016-05-10')).toBe(true);
    expect(isAdultBirthDate('2016-05-10')).toBe(false);
  });

  it('con el perfil ya fechado la fecha sigue siendo opcional, pero no puede ser de un menor', () => {
    // El flujo del invitado nuevo pinta su campo también cuando `requireTutorDob` es
    // false (ahí dice «(opcional)»), y lo que se escriba PISA la fecha guardada. Sin
    // esto, ese camino seguía dejando entrar la fecha de un menor.
    //
    // Con un hijo en el lote entran también sus dos decisiones de imagen, que son
    // obligatorias y ajenas a esto (me lo cazó el test en rojo). Así que aquí se
    // mira SOLO lo que dice de la fecha: si se comparan las listas enteras, el test
    // pasa a hablar del consentimiento de imagen sin querer.
    const conHijos = rules({
      requireTutorDob: false,
      children: [{ playerId: 'p1', name: 'Hijo' }],
    });
    const deLaFecha = (fd: FormData) =>
      codes(fd, conHijos).filter((c) => c.startsWith('date_of_birth'));

    expect(deLaFecha(form())).toEqual([]);
    expect(deLaFecha(form({ date_of_birth: '2020-01-01' }))).toEqual([
      'date_of_birth_not_adult',
    ]);
    expect(deLaFecha(form({ date_of_birth: '1985-04-04' }))).toEqual([]);
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
