import { describe, expect, it } from 'vitest';
import { tutorContactRows, type TutorContact } from '@/player-contact/tutor-rows';

const ANA: TutorContact = {
  tutorProfileId: 'ana',
  fullName: 'Ana Pérez',
  relation: 'parent',
  email: 'ana@example.com',
  phone: '600 123 456',
};
const LUIS: TutorContact = {
  tutorProfileId: 'luis',
  fullName: 'Luis Gil',
  relation: 'guardian',
  email: 'luis@example.com',
  phone: '611 222 333',
};
const EL_JUGADOR: TutorContact = {
  tutorProfileId: 'nino',
  fullName: 'Nico',
  relation: 'self',
  email: 'nico@example.com',
  phone: '622 000 111',
};

describe('tutorContactRows', () => {
  it('el menor ve a sus dos tutores', () => {
    const rows = tutorContactRows([ANA, LUIS], 'nino');
    expect(rows.map((r) => r.tutorProfileId)).toEqual(['ana', 'luis']);
    expect(rows.every((r) => !r.isViewer)).toBe(true);
  });

  it('un tutor ve al OTRO tutor, y a sí mismo marcado', () => {
    const rows = tutorContactRows([ANA, LUIS], 'ana');
    expect(rows.find((r) => r.tutorProfileId === 'ana')?.isViewer).toBe(true);
    expect(rows.find((r) => r.tutorProfileId === 'luis')?.isViewer).toBe(false);
  });

  it('la fila del propio jugador NO se pinta: no es tutor, y la RLS se la oculta al tutor', () => {
    expect(tutorContactRows([ANA, EL_JUGADOR], 'ana').map((r) => r.tutorProfileId)).toEqual(['ana']);
    // Y tampoco al propio jugador: no se ve a sí mismo en su lista de tutores.
    expect(tutorContactRows([ANA, EL_JUGADOR], 'nino').map((r) => r.tutorProfileId)).toEqual(['ana']);
  });

  it('respeta el orden que trae SQL, no lo reordena', () => {
    expect(tutorContactRows([LUIS, ANA], null).map((r) => r.tutorProfileId)).toEqual(['luis', 'ana']);
  });

  it('sin sesión conocida nadie sale marcado (y por tanto nadie pierde acciones)', () => {
    expect(tutorContactRows([ANA], null)[0]?.isViewer).toBe(false);
  });

  it('sin tutores, lista vacía', () => {
    expect(tutorContactRows([], 'ana')).toEqual([]);
  });
});

/**
 * El filtro va en positivo (parent | guardian). Un valor que no conocemos no se
 * cuela en la lista de la familia solo por no ser 'self'.
 */
describe('tutorContactRows · el filtro es una lista de admitidos', () => {
  const DESCONOCIDA: TutorContact = {
    tutorProfileId: 'x',
    fullName: 'Quien sea',
    relation: 'abuela',
    email: null,
    phone: null,
  };

  it('una relación que no es tutor se queda fuera', () => {
    expect(tutorContactRows([ANA, DESCONOCIDA], null).map((r) => r.tutorProfileId)).toEqual([
      'ana',
    ]);
  });

  it('y la ficha de dirección, sin visor, sigue viendo a los tutores', () => {
    const rows = tutorContactRows([ANA, LUIS, EL_JUGADOR], null);
    expect(rows.map((r) => r.tutorProfileId)).toEqual(['ana', 'luis']);
    expect(rows.every((r) => !r.isViewer)).toBe(true);
  });
});
