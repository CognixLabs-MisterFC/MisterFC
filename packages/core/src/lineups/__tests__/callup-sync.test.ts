import { describe, expect, it } from 'vitest';
import { calledUpOnPlace, calledUpOnRemove } from '../callup-sync';

describe('calledUpOnPlace (BUG 2 — colocar en campo/banquillo → convocado)', () => {
  it('sin decisión y en borrador → inserta called_up', () => {
    expect(calledUpOnPlace(null, false)).toBe('insert_called_up');
  });

  it('ya convocado → noop (idempotente)', () => {
    expect(calledUpOnPlace('called_up', false)).toBe('noop');
  });

  it('descartado → noop (el descarte manda, no se pisa)', () => {
    expect(calledUpOnPlace('discarded', false)).toBe('noop');
  });

  it('convocatoria publicada → noop (regla 6.6, no auto-sync silencioso)', () => {
    expect(calledUpOnPlace(null, true)).toBe('noop');
    expect(calledUpOnPlace('discarded', true)).toBe('noop');
  });
});

describe('calledUpOnRemove (BUG 2 — sacar de la alineación → limpiar)', () => {
  it('borrador → borra called_up (no toca descartes, el DELETE filtra)', () => {
    expect(calledUpOnRemove(false)).toBe('delete_called_up');
  });

  it('publicada → noop (regla 6.6)', () => {
    expect(calledUpOnRemove(true)).toBe('noop');
  });
});
