import { describe, it, expect } from 'vitest';
import { mapHeaders, parseTabular } from '../parse';

/**
 * La plantilla vieja (2026-07) pedía nombre y apellidos en UNA celda
 * («Nombre completo»). El importador guardaba la celda entera en `first_name` y
 * dejaba `last_name` vacío: fichas con el nombre entero dentro y, peor, la
 * detección de duplicados rota, porque compara (nombre, apellidos, fecha) contra
 * jugadores que sí están partidos.
 *
 * Desde 2026-09 la plantilla trae DOS columnas y esos ficheros se RECHAZAN. No se
 * parten por espacios: «Pepe Gómez García» es fácil, «Juan Carlos Pérez García»
 * no, y adivinar mal el nombre de un menor no es mejor que no importarlo.
 */

const FILA = { 'Fecha de nacimiento*': '15/03/2010', 'Email*': 'a@b.com' };

describe('plantilla vieja — se rechaza, no se adivina', () => {
  it('rechaza el fichero entero y nombra la columna tal cual venía', () => {
    const res = parseTabular([{ 'Nombre completo*': 'Pepe Gómez García', ...FILA }]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('old_template');
      if (res.error.code === 'old_template') {
        // El asterisco incluido: es lo que ve quien abre el Excel.
        expect(res.error.header).toBe('Nombre completo*');
      }
    }
  });

  // Lo que hacía falta comprobar de verdad: el fichero viejo trae TAMBIÉN fecha y
  // email, así que `mapping` no está vacío y el viejo `no_recognized_headers` no
  // lo habría frenado. Sin el rechazo explícito, se importaba sin nombre.
  it('el rechazo va ANTES de mirar si hay columnas reconocidas', () => {
    const res = parseTabular([{ 'Nombre completo*': 'Pepe Gómez García', ...FILA }]);
    const { mapping } = mapHeaders(['Nombre completo*', 'Fecha de nacimiento*', 'Email*']);
    expect(mapping.size).toBe(2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('old_template');
  });

  it.each([
    'Nombre completo',
    'nombre y apellidos',
    'Full name',
    'FullName',
    'Name and surname',
    'Nom complet',
    'Nom i cognoms',
  ])('reconoce «%s» como plantilla vieja en cualquier idioma y capitalización', (header) => {
    const res = parseTabular([{ [header]: 'Pepe Gómez García', ...FILA }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('old_template');
  });

  // Aunque alguien haya añadido a mano la columna de apellidos: la celda de
  // «Nombre completo» sigue trayendo el nombre Y los apellidos, así que el
  // fichero es contradictorio. Se rechaza igual.
  it('rechaza también si el fichero trae las dos cosas a la vez', () => {
    const res = parseTabular([
      { 'Nombre completo': 'Pepe Gómez García', Apellidos: 'Gómez García', ...FILA },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('old_template');
  });
});

describe('lo que NO se rechaza', () => {
  it('«Nombre» a secas se importa, y sin apellidos last_name queda vacío', () => {
    // Legítimo desde el hotfix F2.9: hay fichas con solo nombre. No se parte
    // nada aunque la celda traiga espacios — se guarda tal cual.
    const res = parseTabular([{ Nombre: 'Pepe Gómez García', ...FILA }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.rows[0]?.first_name).toBe('Pepe Gómez García');
      expect(res.data.rows[0]?.last_name).toBeNull();
    }
  });

  it('la plantilla de los tres idiomas pasa entera', () => {
    for (const headers of [
      ['Nombre*', 'Apellidos', 'Fecha de nacimiento*', 'Equipo', 'Email*'],
      ['First name*', 'Surname', 'Date of birth*', 'Team', 'Email*'],
      ['Nom*', 'Cognoms', 'Data de naixement*', 'Equip', 'Email*'],
    ]) {
      const { mapping, unmapped, fullNameHeader } = mapHeaders(headers);
      expect(unmapped).toEqual([]);
      expect(fullNameHeader).toBeNull();
      expect([...mapping.values()].sort()).toEqual([
        'date_of_birth',
        'first_name',
        'invite_email',
        'last_name',
        'team',
      ]);
    }
  });
});
