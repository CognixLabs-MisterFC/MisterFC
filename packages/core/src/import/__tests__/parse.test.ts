import { describe, it, expect } from 'vitest';
import { parseTabular, mapHeaders } from '../parse';

/**
 * 5 escenarios de parsing según spec §7. Estos tests trabajan sobre el shape
 * que devolverían papaparse / read-excel-file con `header:true` — la lógica
 * de decoding del archivo (UTF-8 vs windows-1252) vive en el cliente.
 */
describe('parseTabular', () => {
  it('CSV happy-path con cabeceras canónicas mapea a snake_case', () => {
    const raw = [
      {
        first_name: 'Pepe',
        last_name: 'Gomez',
        date_of_birth: '2010-05-15',
        dorsal: '10',
      },
    ];
    const out = parseTabular(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const row = out.data.rows[0]!;
      expect(row.first_name).toBe('Pepe');
      expect(row.dorsal).toBe('10');
      // Columnas no presentes vienen como null para que Zod no falle por shape.
      expect(row.positions_secondary).toBe(null);
    }
  });

  it('caracteres acentuados llegan intactos (decoder es responsabilidad del cliente)', () => {
    const raw = [
      { nombre: 'José', apellidos: 'Núñez', fecha_nacimiento: '2010-05-15' },
    ];
    const out = parseTabular(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const row = out.data.rows[0]!;
      expect(row.first_name).toBe('José');
      expect(row.last_name).toBe('Núñez');
    }
  });

  it('headers ES (Nombre, Apellido, Fecha de nacimiento) mapean a canonical', () => {
    const raw = [
      {
        Nombre: 'Pepe',
        Apellido: 'Gomez',
        'Fecha de nacimiento': '15/05/2010',
      },
    ];
    const out = parseTabular(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const row = out.data.rows[0]!;
      expect(row.first_name).toBe('Pepe');
      expect(row.last_name).toBe('Gomez');
      expect(row.date_of_birth).toBe('15/05/2010');
    }
  });

  it('archivo vacío → error empty_file (no crash)', () => {
    const out = parseTabular([]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('empty_file');
  });

  it('columnas extra (medical_notes, foo) se ignoran silenciosamente y van a unmapped_headers', () => {
    const raw = [
      {
        first_name: 'Pepe',
        last_name: 'Gomez',
        date_of_birth: '2010-05-15',
        medical_notes: 'asma',
        foo: 'bar',
      },
    ];
    const out = parseTabular(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.unmapped_headers).toEqual(
        expect.arrayContaining(['medical_notes', 'foo'])
      );
      // No deben aparecer en la row mapeada.
      const row = out.data.rows[0]! as Record<string, unknown>;
      expect(row.medical_notes).toBeUndefined();
    }
  });

  it('sin headers reconocibles → error no_recognized_headers con received[]', () => {
    const raw = [{ foo: 'a', bar: 'b' }];
    const out = parseTabular(raw);
    expect(out.ok).toBe(false);
    if (!out.ok && out.error.code === 'no_recognized_headers') {
      expect(out.error.received).toEqual(['foo', 'bar']);
    }
  });
});

describe('mapHeaders', () => {
  it('detecta aliases y aglutina unmapped', () => {
    const { mapping, unmapped } = mapHeaders([
      'Nombre',
      'Apellido',
      'date_of_birth',
      'foo',
    ]);
    expect(mapping.get('Nombre')).toBe('first_name');
    expect(mapping.get('Apellido')).toBe('last_name');
    expect(mapping.get('date_of_birth')).toBe('date_of_birth');
    expect(unmapped).toEqual(['foo']);
  });

  it('headers castellanos con asterisco de obligatorio se aceptan ("Nombre*")', () => {
    const { mapping, unmapped } = mapHeaders([
      'Nombre*',
      'Apellidos',
      'Fecha de nacimiento*',
    ]);
    expect(mapping.get('Nombre*')).toBe('first_name');
    expect(mapping.get('Apellidos')).toBe('last_name');
    expect(mapping.get('Fecha de nacimiento*')).toBe('date_of_birth');
    expect(unmapped).toHaveLength(0);
  });

  it('tolera tildes y mayúsculas ("POSICIÓN" / "Posición principal")', () => {
    const { mapping } = mapHeaders(['POSICIÓN', 'Posición principal']);
    // Ambos mapean al mismo destino → ambos válidos.
    expect(mapping.get('POSICIÓN')).toBe('position_main');
    expect(mapping.get('Posición principal')).toBe('position_main');
  });

  it('tolera espacios extra y minúsculas', () => {
    const { mapping } = mapHeaders([
      '  pie dominante  ',
      'Posiciones Secundarias',
    ]);
    expect(mapping.get('  pie dominante  ')).toBe('foot');
    expect(mapping.get('Posiciones Secundarias')).toBe('positions_secondary');
  });
});
