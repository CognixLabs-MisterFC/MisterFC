import { describe, it, expect } from 'vitest';
import { validateRow, detectDuplicates, summarize, dedupKey } from '../validate';

/**
 * 4 escenarios de dedup según spec §7.
 */
describe('detectDuplicates', () => {
  // invite_email OBLIGATORIO (rework 2026-07): lo incluimos para que las filas
  // sean válidas y lleguen al dedup.
  const make = (first: string, last: string, dob: string) =>
    validateRow(
      {
        first_name: first,
        last_name: last,
        date_of_birth: dob,
        invite_email: 'x@example.com',
      },
      0
    );

  it('mismas filas (nombre+apellido+DOB idénticos) → primera valid, segunda duplicate_in_file', () => {
    const rows = [
      { ...make('Pepe', 'Gomez', '2010-05-15'), index: 0 },
      { ...make('Pepe', 'Gomez', '2010-05-15'), index: 1 },
    ];
    const out = detectDuplicates(rows, []);
    expect(out[0]!.status).toBe('valid');
    expect(out[1]!.status).toBe('duplicate');
    expect(out[1]!.reason).toBe('duplicate_in_file');
  });

  it('mismo nombre+apellido pero DOB distinto → ambos valid (caso hermanos)', () => {
    const rows = [
      { ...make('Pepe', 'Gomez', '2010-05-15'), index: 0 },
      { ...make('Pepe', 'Gomez', '2012-03-10'), index: 1 },
    ];
    const out = detectDuplicates(rows, []);
    expect(out[0]!.status).toBe('valid');
    expect(out[1]!.status).toBe('valid');
  });

  it('capitalización distinta normaliza vía lower (pepe vs Pepe → mismo)', () => {
    const rows = [
      { ...make('pepe', 'gomez', '2010-05-15'), index: 0 },
      { ...make('Pepe', 'Gomez', '2010-05-15'), index: 1 },
    ];
    const out = detectDuplicates(rows, []);
    expect(out[1]!.status).toBe('duplicate');
    // Documentación inline: NO normalizamos tildes — input limpio asumido.
    // Si la spec cambiase, ajustar dedupKey y este test.
  });

  it('fila inválida (sin DOB) no llega al dedup', () => {
    const invalid = validateRow(
      { first_name: 'Sin', last_name: 'Fecha', date_of_birth: '' },
      0
    );
    const dup = { ...make('Pepe', 'Gomez', '2010-05-15'), index: 1 };
    const out = detectDuplicates([invalid, dup], []);
    expect(out[0]!.status).toBe('invalid');
    expect(out[1]!.status).toBe('valid');
  });

  it('jugador existente en BD marca la fila como duplicate_in_db con existing_player_id', () => {
    const rows = [{ ...make('Pepe', 'Gomez', '2010-05-15'), index: 0 }];
    const existing = [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        first_name: 'Pepe',
        last_name: 'Gomez',
        date_of_birth: '2010-05-15',
      },
    ];
    const out = detectDuplicates(rows, existing);
    expect(out[0]!.status).toBe('duplicate');
    expect(out[0]!.reason).toBe('duplicate_in_db');
    expect(out[0]!.existing_player_id).toBe(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
  });
});

describe('summarize', () => {
  it('cuenta correctamente válidas/duplicadas/inválidas', () => {
    const rows = [
      { index: 0, status: 'valid' as const },
      { index: 1, status: 'valid' as const },
      { index: 2, status: 'duplicate' as const },
      { index: 3, status: 'invalid' as const },
    ];
    expect(summarize(rows)).toEqual({
      valid: 2,
      duplicates: 1,
      invalid: 1,
      total: 4,
    });
  });
});

describe('dedupKey', () => {
  it('trim + lowercase first+last, deja DOB intacta', () => {
    expect(dedupKey('  Pepe ', ' GoMez', '2010-05-15')).toBe(
      'pepe|gomez|2010-05-15'
    );
  });

  it('apellidos null → clave sin componente de apellido', () => {
    expect(dedupKey('Pepe', null, '2010-05-15')).toBe('pepe||2010-05-15');
  });

  it('apellidos vacío trimmed → clave sin apellido (mismo que null)', () => {
    expect(dedupKey('Pepe', '   ', '2010-05-15')).toBe('pepe||2010-05-15');
  });
});

describe('detectDuplicates — last_name opcional (F2.9 hotfix 2026-05-30)', () => {
  const makeNullLast = (first: string, dob: string) =>
    validateRow(
      {
        first_name: first,
        last_name: '',
        date_of_birth: dob,
        invite_email: 'x@example.com',
      },
      0
    );

  it('dos filas con apellidos null pero mismo first+DOB → 2ª duplicate_in_file', () => {
    const rows = [
      { ...makeNullLast('Solo', '2010-05-15'), index: 0 },
      { ...makeNullLast('Solo', '2010-05-15'), index: 1 },
    ];
    const out = detectDuplicates(rows, []);
    expect(out[0]!.status).toBe('valid');
    expect(out[1]!.status).toBe('duplicate');
    expect(out[1]!.reason).toBe('duplicate_in_file');
  });

  it('jugador BD con last_name NULL y fila con last_name NULL → match', () => {
    const rows = [{ ...makeNullLast('Solo', '2010-05-15'), index: 0 }];
    const existing = [
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        first_name: 'Solo',
        last_name: null,
        date_of_birth: '2010-05-15',
      },
    ];
    const out = detectDuplicates(rows, existing);
    expect(out[0]!.status).toBe('duplicate');
    expect(out[0]!.reason).toBe('duplicate_in_db');
  });

  it('fila con apellido y otra sin apellido del mismo jugador → NO se marcan duplicadas (claves distintas)', () => {
    // Decisión documentada: si el club tiene una fila con apellido y otra sin,
    // tratamos como entradas independientes (el usuario decide tras revisar).
    const rows = [
      { ...validateRow({ first_name: 'Pepe', last_name: 'Gomez', date_of_birth: '2010-05-15', invite_email: 'x@example.com' }, 0), index: 0 },
      { ...makeNullLast('Pepe', '2010-05-15'), index: 1 },
    ];
    const out = detectDuplicates(rows, []);
    expect(out[0]!.status).toBe('valid');
    expect(out[1]!.status).toBe('valid');
  });
});
