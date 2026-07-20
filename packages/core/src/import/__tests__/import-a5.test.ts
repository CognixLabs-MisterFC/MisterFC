import { describe, it, expect } from 'vitest';
import { parseTabular, mapHeaders } from '../parse';
import { playerImportRowSchema } from '../schema';
import {
  buildTeamNameIndex,
  resolveTeamName,
  applyTeamResolution,
  validateRow,
  type ValidatedRow,
} from '../validate';

/**
 * Rework A · A5 — equipo por fila + columna invite_email (🔒 O2).
 * Cubre: alias de cabecera (equipo/email), validación de email, y la resolución
 * nombre-de-equipo → team_id dentro del club + temporada activa.
 */

describe('A5 — alias de cabecera de equipo y email', () => {
  it('mapea "Equipo" y "Email" (ES) a las columnas canónicas', () => {
    const { mapping, unmapped } = mapHeaders(['Equipo', 'Email']);
    expect(mapping.get('Equipo')).toBe('team');
    expect(mapping.get('Email')).toBe('invite_email');
    expect(unmapped).toEqual([]);
  });

  it('reconoce alias variados (team, correo, e-mail, invite_email, equipo destino)', () => {
    const { mapping } = mapHeaders([
      'team',
      'Correo',
      'E-mail',
      'invite_email',
      'Equipo destino',
    ]);
    expect(mapping.get('team')).toBe('team');
    expect(mapping.get('Correo')).toBe('invite_email');
    expect(mapping.get('E-mail')).toBe('invite_email');
    expect(mapping.get('invite_email')).toBe('invite_email');
    expect(mapping.get('Equipo destino')).toBe('team');
  });

  it('parseTabular incluye team/invite_email (null si ausentes)', () => {
    const out = parseTabular([
      { nombre: 'Ana', 'fecha de nacimiento': '2012-03-01', Equipo: 'Infantil B' },
    ]);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const row = out.data.rows[0]!;
      expect(row.team).toBe('Infantil B');
      expect(row.invite_email).toBe(null);
    }
  });
});

describe('A5 — validación de invite_email', () => {
  // invite_email OBLIGATORIO desde el rework 2026-07; base lo incluye para los
  // casos que validan OTROS campos.
  const base = {
    first_name: 'Pepe',
    date_of_birth: '2010-05-15',
    invite_email: 'pepe@example.com',
  };

  it('acepta email válido', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      invite_email: 'familia@example.com',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.invite_email).toBe('familia@example.com');
  });

  it('email vacío → invite_email_required (obligatorio)', () => {
    const r = playerImportRowSchema.safeParse({ ...base, invite_email: '  ' });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('invite_email_required');
  });

  it('rechaza email sin dominio con punto', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      invite_email: 'familia@localhost',
    });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(r.error.issues[0]?.message).toBe('invite_email_invalid');
  });

  it('rechaza email con espacios', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      invite_email: 'a b@example.com',
    });
    expect(r.success).toBe(false);
  });

  it('conserva el nombre de equipo crudo en data.team', () => {
    const r = playerImportRowSchema.safeParse({ ...base, team: 'Alevín A' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.team).toBe('Alevín A');
  });
});

describe('A5 — resolución de equipo por nombre', () => {
  const teams = [
    { id: 't-inf-b', name: 'Infantil B' },
    { id: 't-ale-a', name: 'Alevín A' },
  ];
  const index = buildTeamNameIndex(teams);

  it('resuelve por nombre exacto', () => {
    expect(resolveTeamName('Infantil B', index)).toEqual({
      kind: 'resolved',
      teamId: 't-inf-b',
    });
  });

  it('resuelve case-insensitive y sin acentos', () => {
    expect(resolveTeamName('alevin a', index)).toEqual({
      kind: 'resolved',
      teamId: 't-ale-a',
    });
  });

  it('nombre vacío/nulo → none (fallback al lote)', () => {
    expect(resolveTeamName(null, index)).toEqual({ kind: 'none' });
    expect(resolveTeamName('   ', index)).toEqual({ kind: 'none' });
  });

  it('nombre desconocido → not_found', () => {
    expect(resolveTeamName('Cadete Z', index)).toEqual({ kind: 'not_found' });
  });

  it('applyTeamResolution: resuelve, marca no_encontrado y aplica fallback/obligatorio de equipo', () => {
    const email = 'x@example.com';
    const rows: ValidatedRow[] = [
      validateRow(
        {
          first_name: 'A',
          date_of_birth: '2012-01-01',
          team: 'Infantil B',
          invite_email: email,
        },
        0
      ),
      validateRow(
        {
          first_name: 'B',
          date_of_birth: '2012-01-02',
          team: 'No Existe',
          invite_email: email,
        },
        1
      ),
      validateRow(
        { first_name: 'C', date_of_birth: '2012-01-03', invite_email: email },
        2
      ),
    ];

    // Sin selector de lote: la fila sin equipo pasa a error team_required.
    const out = applyTeamResolution(rows, teams);
    expect(out[0]!.status).toBe('valid'); // resuelve por nombre
    expect(out[1]!.status).toBe('invalid'); // no resuelve
    expect(out[1]!.reason).toBe('team_not_found');
    expect(out[2]!.status).toBe('invalid'); // sin equipo + sin lote
    expect(out[2]!.reason).toBe('team_required');

    // Con selector de lote: la fila sin equipo es válida (fallback).
    const outBatch = applyTeamResolution(rows, teams, 't-ale-a');
    expect(outBatch[2]!.status).toBe('valid');
    // El equipo no resoluble sigue siendo error aunque haya lote.
    expect(outBatch[1]!.status).toBe('invalid');
    expect(outBatch[1]!.reason).toBe('team_not_found');
  });
});
