import { describe, expect, it } from 'vitest';
import {
  findAcceptProblems,
  playerIdsFromFormKeys,
  validateChildRow,
  type AcceptFormRules,
} from '../accept-form';

/**
 * El formulario de aceptar invitación no tenía NINGÚN test. Es el alta de todas
 * las familias: si este validador se pasa de estricto, deja gente fuera; si se
 * queda corto, el servidor lo caza igual pero el padre se come un viaje.
 *
 * El caso que motivó todo esto: dos hijos, todo relleno salvo una foto, y el
 * botón sin decir nada. Desde la migración 20261055000000 ese caso ya ni
 * bloquea — la foto es opcional —, y aquí abajo está fijado en los dos
 * sentidos: sin foto se pasa, sin decisiones no.
 */

const CHILD_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const CHILD_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function baseRules(over: Partial<AcceptFormRules> = {}): AcceptFormRules {
  return {
    requireTerms: true,
    requirePrivacy: true,
    children: [],
    requireChildData: false,
    requireProfile: false,
    requireOwnPassword: false,
    ...over,
  };
}

function photo(bytes = 1024, type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], 'foto.jpg', { type });
}

/** Un hijo con las dos decisiones respondidas (con foto o sin ella). */
function completeChild(fd: FormData, pid: string, internal = 'yes', withPhoto = true) {
  fd.set(`image_internal_${pid}`, internal);
  fd.set(`image_social_${pid}`, 'no');
  if (withPhoto) fd.set(`image_file_${pid}`, photo());
}

function codes(fd: FormData, rules: AcceptFormRules) {
  return findAcceptProblems(fd, rules).map((p) => p.code);
}

describe('findAcceptProblems — consentimientos de cuenta', () => {
  it('un formulario vacío pide los consentimientos', () => {
    expect(codes(new FormData(), baseRules())).toEqual(['consent_required']);
  });

  it('con las dos casillas marcadas no queda nada', () => {
    const fd = new FormData();
    fd.set('accept_terms', 'true');
    fd.set('accept_privacy', 'true');
    expect(codes(fd, baseRules())).toEqual([]);
  });

  it('marcar solo una no basta', () => {
    const fd = new FormData();
    fd.set('accept_terms', 'true');
    expect(codes(fd, baseRules())).toEqual(['consent_required']);
  });

  it('un documento ya aceptado o ausente no se vuelve a pedir', () => {
    const rules = baseRules({ requireTerms: false, requirePrivacy: false });
    expect(codes(new FormData(), rules)).toEqual([]);
  });
});

describe('findAcceptProblems — decisiones de imagen (la foto ya no gatea)', () => {
  const rules = baseRules({
    requireTerms: false,
    requirePrivacy: false,
    children: [
      { playerId: CHILD_A, name: 'Marta' },
      { playerId: CHILD_B, name: 'Leo' },
    ],
  });

  it('sin responder nada pide las dos decisiones de CADA hijo, y nada más', () => {
    expect(codes(new FormData(), rules)).toEqual([
      'image_internal_missing',
      'image_social_missing',
      'image_internal_missing',
      'image_social_missing',
    ]);
  });

  it('el caso de Jose: dos hijos, uno sin foto — ya NO bloquea el alta', () => {
    const fd = new FormData();
    completeChild(fd, CHILD_A);
    completeChild(fd, CHILD_B, 'yes', false);
    expect(codes(fd, rules)).toEqual([]);
  });

  it('NINGÚN hijo sube foto y el alta sigue adelante', () => {
    const fd = new FormData();
    completeChild(fd, CHILD_A, 'yes', false);
    completeChild(fd, CHILD_B, 'no', false);
    expect(codes(fd, rules)).toEqual([]);
  });

  it('pero las decisiones siguen siendo obligatorias, y dice de qué hijo', () => {
    const fd = new FormData();
    completeChild(fd, CHILD_A);
    fd.set(`image_social_${CHILD_B}`, 'yes'); // a Leo le falta la interna

    const problems = findAcceptProblems(fd, rules);
    expect(problems).toEqual([{ code: 'image_internal_missing', playerId: CHILD_B }]);
  });

  it('"no" es una respuesta válida: no se confunde con no haber respondido', () => {
    const fd = new FormData();
    completeChild(fd, CHILD_A, 'no', false);
    completeChild(fd, CHILD_B, 'no', false);
    expect(codes(fd, rules)).toEqual([]);
  });

  it('un input de fichero vacío tampoco bloquea', () => {
    const fd = new FormData();
    completeChild(fd, CHILD_A);
    completeChild(fd, CHILD_B, 'yes', false);
    fd.set(`image_file_${CHILD_B}`, new File([], '', { type: 'application/octet-stream' }));
    expect(codes(fd, rules)).toEqual([]);
  });

  it('sin hijos no se pide nada de imagen (entrenador, staff, seguidor)', () => {
    expect(codes(new FormData(), baseRules({ requireTerms: false, requirePrivacy: false }))).toEqual(
      []
    );
  });
});

describe('findAcceptProblems — perfil y contraseña', () => {
  const rules = baseRules({
    requireTerms: false,
    requirePrivacy: false,
    requireProfile: true,
  });

  it('alta nueva vacía: nombre y contraseña', () => {
    expect(codes(new FormData(), rules)).toEqual(['full_name_too_short', 'password_too_short']);
  });

  it('contraseñas que no coinciden', () => {
    const fd = new FormData();
    fd.set('full_name', 'Ana Pérez');
    fd.set('password', 'unaclavelarga');
    fd.set('confirm', 'otraclavelarga');
    expect(codes(fd, rules)).toEqual(['password_mismatch']);
  });

  it('un alta completa no tiene problemas', () => {
    const fd = new FormData();
    fd.set('full_name', 'Ana Pérez');
    fd.set('password', 'unaclavelarga');
    fd.set('confirm', 'unaclavelarga');
    expect(codes(fd, rules)).toEqual([]);
  });

  it('la fecha del tutor es opcional, pero si se pone tiene que valer', () => {
    const fd = new FormData();
    fd.set('full_name', 'Ana Pérez');
    fd.set('password', 'unaclavelarga');
    fd.set('confirm', 'unaclavelarga');
    fd.set('date_of_birth', '1850-01-01');
    expect(codes(fd, rules)).toEqual(['date_of_birth_invalid']);
  });

  it('quien ya tenía cuenta solo necesita escribir su contraseña', () => {
    const own = baseRules({ requireTerms: false, requirePrivacy: false, requireOwnPassword: true });
    expect(codes(new FormData(), own)).toEqual(['password_missing']);

    const fd = new FormData();
    fd.set('password', 'x');
    expect(codes(fd, own)).toEqual([]);
  });
});

describe('findAcceptProblems — datos del hijo', () => {
  const rules = baseRules({
    requireTerms: false,
    requirePrivacy: false,
    requireChildData: true,
    children: [{ playerId: CHILD_A, name: 'Marta' }],
  });

  function withRows(rows: unknown): FormData {
    const fd = new FormData();
    fd.set(`image_internal_${CHILD_A}`, 'yes');
    fd.set(`image_social_${CHILD_A}`, 'no');
    fd.set('children_data', JSON.stringify(rows));
    return fd;
  }

  it('falta el nombre', () => {
    const problems = findAcceptProblems(
      withRows([{ playerId: CHILD_A, firstName: '  ', lastName: '', dob: '2015-04-01' }]),
      rules
    );
    expect(problems).toEqual([{ code: 'child_name_required', playerId: CHILD_A }]);
  });

  it('fecha de nacimiento futura', () => {
    expect(
      codes(
        withRows([{ playerId: CHILD_A, firstName: 'Marta', lastName: '', dob: '2999-01-01' }]),
        rules
      )
    ).toEqual(['child_dob_invalid']);
  });

  it('una fila completa no da problemas', () => {
    expect(
      codes(
        withRows([{ playerId: CHILD_A, firstName: 'Marta', lastName: 'Ruiz', dob: '2015-04-01' }]),
        rules
      )
    ).toEqual([]);
  });

  it('ignora filas de player_ids ajenos al lote', () => {
    expect(
      codes(withRows([{ playerId: CHILD_B, firstName: '', lastName: '', dob: '' }]), rules)
    ).toEqual([]);
  });

  it('un children_data roto no inventa problemas ni revienta', () => {
    const fd = new FormData();
    fd.set(`image_internal_${CHILD_A}`, 'yes');
    fd.set(`image_social_${CHILD_A}`, 'no');
    fd.set('children_data', '{esto no es json');
    expect(codes(fd, rules)).toEqual([]);
  });
});

describe('validateChildRow — la regla que comparten cliente y servidor', () => {
  it('acepta una fila normal', () => {
    expect(validateChildRow({ firstName: 'Marta', lastName: 'Ruiz', dob: '2015-04-01' })).toBeNull();
  });

  it('el apellido es opcional', () => {
    expect(validateChildRow({ firstName: 'Marta', lastName: '', dob: '2015-04-01' })).toBeNull();
  });

  it('nombre vacío o demasiado largo', () => {
    expect(validateChildRow({ firstName: '', lastName: '', dob: '2015-04-01' })).toBe(
      'child_name_required'
    );
    expect(validateChildRow({ firstName: 'x'.repeat(81), lastName: '', dob: '2015-04-01' })).toBe(
      'child_name_required'
    );
  });

  it('apellido demasiado largo', () => {
    expect(
      validateChildRow({ firstName: 'Marta', lastName: 'y'.repeat(121), dob: '2015-04-01' })
    ).toBe('child_name_required');
  });

  it('fechas que no valen', () => {
    for (const dob of ['', '01-04-2015', '2015-13-40', '1899-12-31', '2999-01-01']) {
      expect(validateChildRow({ firstName: 'Marta', lastName: '', dob })).toBe('child_dob_invalid');
    }
  });
});

describe('playerIdsFromFormKeys — la deducción del lote', () => {
  it('encuentra al hijo que dijo NO y por tanto NO tiene campo de foto', () => {
    const fd = new FormData();
    // Marta dice SÍ y sube foto; Leo dice NO y su selector ni se pinta.
    fd.set(`image_internal_${CHILD_A}`, 'yes');
    fd.set(`image_social_${CHILD_A}`, 'no');
    fd.set(`image_file_${CHILD_A}`, photo());
    fd.set(`image_internal_${CHILD_B}`, 'no');
    fd.set(`image_social_${CHILD_B}`, 'no');

    expect(playerIdsFromFormKeys(fd.keys()).sort()).toEqual([CHILD_A, CHILD_B].sort());
  });

  it('deducirlo del campo de la foto habría perdido a ese hijo', () => {
    const fd = new FormData();
    fd.set(`image_internal_${CHILD_A}`, 'yes');
    fd.set(`image_file_${CHILD_A}`, photo());
    fd.set(`image_internal_${CHILD_B}`, 'no');

    const porLaFoto = [...fd.keys()]
      .filter((k) => k.startsWith('image_file_'))
      .map((k) => k.slice('image_file_'.length));

    expect(porLaFoto).toEqual([CHILD_A]);
    expect(playerIdsFromFormKeys(fd.keys())).toContain(CHILD_B);
  });

  it('sin hijos devuelve lista vacía', () => {
    expect(playerIdsFromFormKeys(new FormData().keys())).toEqual([]);
  });
});
