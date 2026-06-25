import { describe, it, expect } from 'vitest';
import { objectiveDisplayState } from '../development-report';

describe('objectiveDisplayState (F13.10h-1)', () => {
  it('achieved → conseguido (independiente del periodo)', () => {
    expect(objectiveDisplayState('achieved', 'inicial', 'junio')).toBe('conseguido');
    expect(objectiveDisplayState('achieved', 'junio', 'junio')).toBe('conseguido');
  });

  it('dropped → descartado', () => {
    expect(objectiveDisplayState('dropped', 'inicial', 'marzo')).toBe('descartado');
  });

  it('open creado en el periodo actual → nuevo', () => {
    expect(objectiveDisplayState('open', 'diciembre', 'diciembre')).toBe('nuevo');
    expect(objectiveDisplayState('open', 'inicial', 'inicial')).toBe('nuevo');
  });

  it('open creado en un periodo anterior → en_proceso', () => {
    expect(objectiveDisplayState('open', 'inicial', 'diciembre')).toBe('en_proceso');
    expect(objectiveDisplayState('open', 'diciembre', 'junio')).toBe('en_proceso');
  });

  it('open con periodo no situable (null/desconocido) → nuevo', () => {
    expect(objectiveDisplayState('open', null, 'marzo')).toBe('nuevo');
    expect(objectiveDisplayState('open', 'marzo', undefined)).toBe('nuevo');
    expect(objectiveDisplayState('open', 'xxx', 'marzo')).toBe('nuevo');
  });
});
