import { describe, expect, it } from 'vitest';
import { foldForSearch } from '../search';

/**
 * Fija el comportamiento de foldForSearch al subirla de apps/native a core: mismo
 * resultado para las mismas entradas (los consumidores nativos —cuerpo-tecnico.tsx,
 * jugadores.tsx— la siguen usando por re-exportación y NO pueden cambiar).
 */
describe('foldForSearch', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(foldForSearch('José')).toBe('jose');
    expect(foldForSearch('MARÍA')).toBe('maria');
    expect(foldForSearch('Núñez')).toBe('nunez');
    expect(foldForSearch('Vallès')).toBe('valles');
  });

  it('la coincidencia vale en ambos sentidos (término y texto normalizados)', () => {
    expect(foldForSearch('José').includes(foldForSearch('jose'))).toBe(true);
    expect(foldForSearch('jose').includes(foldForSearch('José'))).toBe(true);
  });

  it('es idempotente y respeta lo ya normalizado', () => {
    expect(foldForSearch('jose')).toBe('jose');
    expect(foldForSearch(foldForSearch('Ángel'))).toBe('angel');
    expect(foldForSearch('')).toBe('');
  });
});
