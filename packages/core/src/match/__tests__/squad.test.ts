import { describe, it, expect } from 'vitest';
import { deriveSquad, type FieldSlot } from '../squad';

// Once de 3 (simplificado): titulares T1,T2,T3 en sus huecos; banquillo S1,S2.
const slots: FieldSlot[] = [
  { playerId: 'T1', positionCode: 'GK', xPct: 50, yPct: 95 },
  { playerId: 'T2', positionCode: 'DF', xPct: 30, yPct: 60 },
  { playerId: 'T3', positionCode: 'FW', xPct: 50, yPct: 20 },
];
const bench = ['S1', 'S2'];

const base = { slots, bench, subs: [], expelled: [], absent: [] };

describe('deriveSquad — sin cambios', () => {
  it('campo = titulares; banquillo todo disponible', () => {
    const sq = deriveSquad(base);
    expect(sq.onFieldIds).toEqual(['T1', 'T2', 'T3']);
    expect(sq.eligibleInIds).toEqual(['S1', 'S2']);
    expect(sq.bench.every((b) => b.status === 'available')).toBe(true);
  });
});

describe('deriveSquad — sustitución', () => {
  it('entra ocupa el hueco del que sale; sale pasa al banquillo', () => {
    const sq = deriveSquad({ ...base, subs: [{ out: 'T2', in: 'S1' }] });
    expect(sq.onFieldIds).toEqual(['T1', 'S1', 'T3']);
    // S1 ocupa la posición de T2 (DF).
    const s1 = sq.onField.find((p) => p.playerId === 'S1');
    expect(s1?.positionCode).toBe('DF');
    expect(s1?.xPct).toBe(30);
    // T2 salió: no está en campo, figura en el banquillo y (sin cambios corridos)
    // no puede reentrar. S1 ya está en campo → no aparece en el banquillo.
    expect(sq.onFieldIds).not.toContain('T2');
    expect(sq.bench.find((b) => b.playerId === 'T2')?.status).toBe('out');
    expect(sq.bench.find((b) => b.playerId === 'S1')).toBeUndefined();
    // Solo S2 (suplente sin estrenar) es elegible.
    expect(sq.eligibleInIds).toEqual(['S2']);
  });

  it('doble cambio encadenado sobre el mismo hueco', () => {
    const sq = deriveSquad({
      ...base,
      subs: [
        { out: 'T3', in: 'S1' },
        { out: 'S1', in: 'S2' }, // S1 (que había entrado) sale, entra S2
      ],
    });
    expect(sq.onFieldIds).toEqual(['T1', 'T2', 'S2']);
    expect(sq.eligibleInIds).toEqual([]); // sin cambios corridos, nadie reentra
    // T3 y S1 salieron y no reentran; S2 está en campo.
    expect(sq.bench.find((b) => b.playerId === 'T3')?.status).toBe('out');
    expect(sq.bench.find((b) => b.playerId === 'S1')?.status).toBe('out');
    expect(sq.bench.find((b) => b.playerId === 'S2')).toBeUndefined();
  });
});

describe('deriveSquad — cambios corridos (allowReentry)', () => {
  it('un jugador que salió puede VOLVER a entrar con el flag activado', () => {
    const sq = deriveSquad({
      ...base,
      subs: [{ out: 'T2', in: 'S1' }],
      allowReentry: true,
    });
    // T2 salió pero puede reentrar; S2 sin estrenar también.
    expect(sq.bench.find((b) => b.playerId === 'T2')?.status).toBe('available');
    expect(sq.eligibleInIds).toEqual(['S2', 'T2']);
  });

  it('reentrada efectiva: T2 vuelve por S1 ocupando el hueco', () => {
    const sq = deriveSquad({
      ...base,
      subs: [
        { out: 'T2', in: 'S1' }, // sale T2, entra S1 (hueco DF)
        { out: 'S1', in: 'T2' }, // sale S1, vuelve T2 al mismo hueco
      ],
      allowReentry: true,
    });
    expect(sq.onFieldIds).toEqual(['T1', 'T2', 'T3']);
    const t2 = sq.onField.find((p) => p.playerId === 'T2');
    expect(t2?.positionCode).toBe('DF');
    // S1 salió pero puede volver a entrar (cambios corridos).
    expect(sq.bench.find((b) => b.playerId === 'S1')?.status).toBe('available');
  });

  it('expulsado y ausente NUNCA reentran aunque el flag esté activado', () => {
    const sq = deriveSquad({
      ...base,
      subs: [{ out: 'T1', in: 'S1' }],
      expelled: ['T2'],
      absent: ['T3'],
      allowReentry: true,
    });
    expect(sq.bench.find((b) => b.playerId === 'T2')?.status).toBe('expelled');
    expect(sq.bench.find((b) => b.playerId === 'T3')?.status).toBe('absent');
    expect(sq.eligibleInIds).not.toContain('T2');
    expect(sq.eligibleInIds).not.toContain('T3');
    // T1 salió por cambio → reentrada permitida.
    expect(sq.bench.find((b) => b.playerId === 'T1')?.status).toBe('available');
  });
});

describe('deriveSquad — expulsado (no vuelve, no elegible)', () => {
  it('titular expulsado deja su hueco vacío y no es elegible para nada', () => {
    const sq = deriveSquad({ ...base, expelled: ['T1'] });
    expect(sq.onFieldIds).toEqual(['T2', 'T3']); // T1 fuera
    expect(sq.bench.find((b) => b.playerId === 'T1')?.status).toBe('expelled');
  });

  it('suplente que entró y luego es expulsado: fuera del campo, banquillo=expelled', () => {
    const sq = deriveSquad({
      ...base,
      subs: [{ out: 'T2', in: 'S1' }],
      expelled: ['S1'],
    });
    expect(sq.onFieldIds).toEqual(['T1', 'T3']); // S1 expulsado, hueco vacío
    expect(sq.bench.find((b) => b.playerId === 'S1')?.status).toBe('expelled');
    expect(sq.eligibleInIds).toEqual(['S2']);
  });
});

describe('deriveSquad — ausente (no viene)', () => {
  it('suplente ausente no es elegible y figura como absent', () => {
    const sq = deriveSquad({ ...base, absent: ['S1'] });
    expect(sq.eligibleInIds).toEqual(['S2']);
    expect(sq.bench.find((b) => b.playerId === 'S1')?.status).toBe('absent');
  });

  it('titular ausente sale del campo (el operador mete a otro luego)', () => {
    const sq = deriveSquad({ ...base, absent: ['T3'] });
    expect(sq.onFieldIds).toEqual(['T1', 'T2']);
  });

  it('absent manda sobre out/expelled en el estado del banquillo', () => {
    const sq = deriveSquad({
      ...base,
      subs: [{ out: 'T1', in: 'S1' }],
      absent: ['S1'],
    });
    expect(sq.bench.find((b) => b.playerId === 'S1')?.status).toBe('absent');
    expect(sq.onFieldIds).not.toContain('S1');
  });
});

describe('deriveSquad — hidratación desde lo persistido', () => {
  it('mismo resultado recomputando solo desde subs/expelled/absent (sin optimista)', () => {
    const persisted = deriveSquad({
      ...base,
      subs: [{ out: 'T2', in: 'S1' }],
      expelled: ['T1'],
      absent: ['S2'],
    });
    expect(persisted.onFieldIds).toEqual(['S1', 'T3']);
    expect(persisted.eligibleInIds).toEqual([]); // S1 entró, S2 ausente, sin reentrada
  });
});
