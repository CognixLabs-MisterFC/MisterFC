import { describe, it, expect } from 'vitest';
import {
  TACTICAL_OBJECTIVES,
  TECHNICAL_OBJECTIVES,
  EXERCISE_INTENSITIES,
  EXERCISE_SPACE_TYPES,
  METHODOLOGY_STATUSES,
  isTacticalObjective,
  isTechnicalObjective,
  isMethodologyStatus,
} from '../exercises';

describe('vocabularios de ejercicios (F11)', () => {
  it('tácticos: 20 valores únicos', () => {
    expect(TACTICAL_OBJECTIVES.length).toBe(20);
    expect(new Set(TACTICAL_OBJECTIVES).size).toBe(20);
  });

  it('técnicos: 8 valores únicos', () => {
    expect(TECHNICAL_OBJECTIVES.length).toBe(8);
    expect(new Set(TECHNICAL_OBJECTIVES).size).toBe(8);
  });

  it('intensidad y espacio con los valores de la spec', () => {
    expect([...EXERCISE_INTENSITIES]).toEqual(['baja', 'media', 'alta']);
    expect([...EXERCISE_SPACE_TYPES]).toEqual([
      'campo_completo',
      'medio_campo',
      'cuarto_campo',
      'reducido',
    ]);
  });

  it('estados del ciclo de metodología', () => {
    expect([...METHODOLOGY_STATUSES]).toEqual(['draft', 'proposed', 'published', 'rejected']);
  });

  it('guards reconocen miembros y rechazan ajenos', () => {
    expect(isTacticalObjective('salida_de_balon')).toBe(true);
    expect(isTacticalObjective('marcar_gol')).toBe(false);
    expect(isTechnicalObjective('cabeceo')).toBe(true);
    expect(isTechnicalObjective('posesion')).toBe(false); // es táctico, no técnico
    expect(isMethodologyStatus('published')).toBe(true);
    expect(isMethodologyStatus('archived')).toBe(false); // archivado es archived_at, no un status
  });
});
