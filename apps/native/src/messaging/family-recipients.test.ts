import { describe, expect, it } from 'vitest';
import {
  recipientSections,
  roleLabelKey,
  tapActionFor,
  type Recipient,
} from '@/messaging/family-recipients';

const base: Recipient = {
  profileId: 'p',
  fullName: 'X',
  kind: 'team',
  staffRole: 'entrenador_principal',
  teamId: 't1',
  teamName: 'Cadete A',
  conversationId: null,
};
const r = (over: Partial<Recipient>): Recipient => ({ ...base, ...over });

describe('recipientSections', () => {
  it('el equipo va primero y el club despues', () => {
    const s = recipientSections([
      r({ profileId: 'd', fullName: 'Luis', kind: 'club', staffRole: 'director', teamId: null, teamName: null }),
      r({ profileId: 'm', fullName: 'Ana' }),
    ]);
    expect(s.map((x) => x.kind)).toEqual(['team', 'club']);
  });

  it('dentro de cada seccion, por nombre y sin distinguir acentos', () => {
    const s = recipientSections([
      r({ profileId: '1', fullName: 'Óscar' }),
      r({ profileId: '2', fullName: 'ana' }),
      r({ profileId: '3', fullName: 'Bea' }),
    ]);
    expect(s[0]?.data.map((x) => x.fullName)).toEqual(['ana', 'Bea', 'Óscar']);
  });

  it('un jugador en dos equipos da dos secciones, cada una con su nombre', () => {
    const s = recipientSections([
      r({ profileId: 'a', teamId: 't2', teamName: 'Juvenil B' }),
      r({ profileId: 'b', teamId: 't1', teamName: 'Cadete A' }),
    ]);
    expect(s.filter((x) => x.kind === 'team').map((x) => x.teamName)).toEqual([
      'Cadete A',
      'Juvenil B',
    ]);
  });

  it('sin dirección no aparece la seccion del club (club sin admin ni director)', () => {
    const s = recipientSections([r({ profileId: 'm' })]);
    expect(s.map((x) => x.kind)).toEqual(['team']);
  });

  it('sin nadie, ninguna seccion', () => {
    expect(recipientSections([])).toEqual([]);
  });

  it('una fila de equipo sin teamId no se pierde', () => {
    const s = recipientSections([r({ profileId: 'm', teamId: null, teamName: null })]);
    expect(s).toHaveLength(1);
    expect(s[0]?.data).toHaveLength(1);
  });
});

describe('tapActionFor', () => {
  it('con hilo, abre el que hay (no crea otro)', () => {
    expect(tapActionFor(r({ conversationId: 'c1' }))).toEqual({
      action: 'open',
      conversationId: 'c1',
    });
  });

  it('sin hilo, crea', () => {
    expect(tapActionFor(r({ profileId: 'm1', conversationId: null }))).toEqual({
      action: 'create',
      recipientProfileId: 'm1',
    });
  });
});

describe('roleLabelKey', () => {
  it('usa el rol concreto, que es lo que le dice a la familia con quien habla', () => {
    expect(roleLabelKey(r({ staffRole: 'delegado' }))).toBe('mensajes_familia.role.delegado');
    expect(roleLabelKey(r({ staffRole: 'director', kind: 'club' }))).toBe(
      'mensajes_familia.role.director',
    );
  });
});

/**
 * CENSO DE CLAVES. `roleLabelKey` compone la clave de i18n con un valor que viene de
 * la BD, así que un rol sin traducción no rompe nada: pinta la clave literal en la
 * pantalla. Eso es exactamente lo que pasó en R-4 (`phone_missing` contra
 * `missing_phone`) y no lo vio ningún test.
 *
 * El conjunto NO es una suposición: son los dos CHECK de producción, medidos.
 *   team_staff.staff_role  CHECK (entrenador_principal, entrenador_ayudante,
 *                                 preparador_fisico, delegado, coordinador)
 *   memberships.role       CHECK (…) — de ahí solo llegan admin_club y director,
 *                                 que es lo que devuelve la rama 'club' de la RPC.
 *
 * Si mañana una migración añade un staff_role, este test se pone rojo y alguien
 * escribe el texto antes de que un padre vea `mensajes_familia.role.utillero`.
 */
describe('cobertura de traducciones de los roles', () => {
  const ROLES_POSIBLES = [
    'admin_club',
    'director',
    'entrenador_principal',
    'entrenador_ayudante',
    'preparador_fisico',
    'delegado',
    'coordinador',
  ];

  for (const locale of ['es', 'en', 'va']) {
    it(`${locale} tiene texto para los ${ROLES_POSIBLES.length} roles`, async () => {
      const catalogo = (await import(`../../../../messages/${locale}.json`)) as {
        default: Record<string, Record<string, unknown>>;
      };
      const roles = catalogo.default.mensajes_familia?.role as Record<string, string> | undefined;
      const faltan = ROLES_POSIBLES.filter((r) => typeof roles?.[r] !== 'string');
      expect(faltan).toEqual([]);
    });
  }
});
