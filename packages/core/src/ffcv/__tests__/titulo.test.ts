import { describe, expect, it } from 'vitest';
import { TITULO_MAX, tituloDePartido } from '../titulo';
import type { PartidoFfcv } from '../types';

const BASE: PartidoFfcv = {
  acta: '26539172',
  jornada: 1,
  fechaHoraIso: '2026-10-18T08:30:00.000Z',
  enCasa: false,
  rival: 'C.D. At. Nazaret C',
  codigoRival: '906821360',
  campo: 'Polideportivo Mpal. de Nazaret F-11',
  jugado: false,
  horaDeRelleno: false,
};

describe('tituloDePartido · el orden dice dónde se juega', () => {
  it('fuera: primero el rival', () => {
    expect(tituloDePartido('Infantil B', BASE)).toBe('C.D. At. Nazaret C - Infantil B');
  });

  it('en casa: primero nosotros', () => {
    expect(tituloDePartido('Infantil B', { ...BASE, enCasa: true })).toBe(
      'Infantil B - C.D. At. Nazaret C',
    );
  });

  it('nuestro lado va con el nombre de MisterFC, no con el de la FFCV', () => {
    const t = tituloDePartido('Infantil B', { ...BASE, enCasa: true });
    expect(t).toContain('Infantil B');
    expect(t).not.toContain('Fonteta');
  });

  it('el peor título REAL de la temporada cabe de sobra', () => {
    // Medido: 47 caracteres, con el nombre completo del rival y sin alias.
    const peor = tituloDePartido('Infantil B', {
      ...BASE,
      enCasa: true,
      rival: 'C.D. Jesuitas Valencia-S. Fútbol E',
    });
    expect(peor).toBe('Infantil B - C.D. Jesuitas Valencia-S. Fútbol E');
    expect(peor.length).toBe(47);
    expect(peor.length).toBeLessThanOrEqual(TITULO_MAX);
  });
});
