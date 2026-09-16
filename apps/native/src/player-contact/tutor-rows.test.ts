import { describe, expect, it } from 'vitest';
import {
  contactActionsFor,
  tutorContactRows,
  type TutorContact,
} from '@/player-contact/tutor-rows';

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

describe('contactActionsFor', () => {
  const fila = (over: Partial<TutorContact> & { isViewer?: boolean } = {}) => ({
    ...ANA,
    isViewer: false,
    ...over,
  });

  it('con teléfono y correo ofrece llamar y escribir, en ese orden', () => {
    expect(contactActionsFor(fila())).toEqual([
      { kind: 'call', href: 'tel:600123456', value: '600 123 456' },
      { kind: 'mail', href: 'mailto:ana@example.com', value: 'ana@example.com' },
    ]);
  });

  it('el tel: va sin espacios pero lo que se le enseña al usuario los conserva', () => {
    const [call] = contactActionsFor(fila({ phone: ' 600 12 34 56 ' }));
    expect(call?.href).toBe('tel:600123456');
    expect(call?.value).toBe('600 12 34 56');
  });

  it('sin teléfono no hay botón de llamar', () => {
    expect(contactActionsFor(fila({ phone: null })).map((a) => a.kind)).toEqual(['mail']);
  });

  it('sin correo no hay botón de escribir', () => {
    expect(contactActionsFor(fila({ email: null })).map((a) => a.kind)).toEqual(['call']);
  });

  it('un campo en blanco cuenta como que no lo hay', () => {
    expect(contactActionsFor(fila({ phone: '   ', email: '' }))).toEqual([]);
  });

  it('sobre uno mismo no hay acciones', () => {
    expect(contactActionsFor(fila({ isViewer: true }))).toEqual([]);
  });
});
