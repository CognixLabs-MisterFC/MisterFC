import { describe, expect, it } from 'vitest';
import { defaultLineupDraft, DEFAULT_LINEUP_NAME } from '../formations';

// Bug BB — al entrar a /alineacion sin alineación previa, el server auto-crea
// un borrador con estos defaults y el editor se abre directamente (sin prompt).
describe('defaultLineupDraft (auto-crear borrador, Bug BB)', () => {
  it('nombre por defecto "Plan A"', () => {
    expect(DEFAULT_LINEUP_NAME).toBe('Plan A');
    expect(defaultLineupDraft('F8').name).toBe('Plan A');
  });

  it('primera formación del catálogo por modalidad', () => {
    expect(defaultLineupDraft('F7').formationCode).toBe('1-3-3');
    expect(defaultLineupDraft('F8').formationCode).toBe('1-3-3-1');
    expect(defaultLineupDraft('F11').formationCode).toBe('4-3-3');
  });
});
