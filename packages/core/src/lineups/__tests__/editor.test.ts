import { describe, expect, it } from 'vitest';
import { getFormation } from '../formations';
import {
  BENCH_ZONE_ID,
  OUT_ZONE_ID,
  applyDrop,
  fieldSlotDroppableId,
  playerDraggableId,
  resolveDrop,
} from '../editor';
import type { PositionAssignment } from '../types';

const f433 = getFormation('4-3-3')!;

function bench(playerId: string): PositionAssignment {
  return {
    playerId,
    location: 'bench',
    positionCode: null,
    xPct: null,
    yPct: null,
    outReason: null,
  };
}

describe('resolveDrop', () => {
  it('resuelve drop a un slot de campo', () => {
    const r = resolveDrop(playerDraggableId('p1'), fieldSlotDroppableId('GK'));
    expect(r).toEqual({ playerId: 'p1', target: { kind: 'field', slotCode: 'GK' } });
  });
  it('resuelve drop al banquillo y a fuera', () => {
    expect(resolveDrop(playerDraggableId('p1'), BENCH_ZONE_ID)?.target).toEqual({ kind: 'bench' });
    expect(resolveDrop(playerDraggableId('p1'), OUT_ZONE_ID)?.target).toEqual({ kind: 'out' });
  });
  it('devuelve null si el over no es zona o el active no es jugador', () => {
    expect(resolveDrop(playerDraggableId('p1'), 'algo-raro')).toBeNull();
    expect(resolveDrop('no-player', BENCH_ZONE_ID)).toBeNull();
    expect(resolveDrop(playerDraggableId('p1'), null)).toBeNull();
  });
});

describe('applyDrop', () => {
  it('coloca un suplente en un slot de campo con coords del preset', () => {
    const start = [bench('p1')];
    const { next, changed } = applyDrop(
      start,
      { playerId: 'p1', target: { kind: 'field', slotCode: 'GK' } },
      f433,
    );
    const me = next.find((a) => a.playerId === 'p1')!;
    const slot = f433.slots.find((s) => s.code === 'GK')!;
    expect(me.location).toBe('field');
    expect(me.positionCode).toBe('GK');
    expect(me.xPct).toBe(slot.xPct);
    expect(me.yPct).toBe(slot.yPct);
    expect(changed).toEqual(['p1']);
    expect(start[0]!.location).toBe('bench'); // no muta la entrada
  });

  it('al soltar sobre un slot ocupado por otro, lo desplaza al banquillo (swap)', () => {
    const start: PositionAssignment[] = [
      { playerId: 'titular', location: 'field', positionCode: 'GK', xPct: 50, yPct: 94, outReason: null },
      bench('suplente'),
    ];
    const { next, changed } = applyDrop(
      start,
      { playerId: 'suplente', target: { kind: 'field', slotCode: 'GK' } },
      f433,
    );
    const titular = next.find((a) => a.playerId === 'titular')!;
    const suplente = next.find((a) => a.playerId === 'suplente')!;
    expect(suplente.location).toBe('field');
    expect(suplente.positionCode).toBe('GK');
    expect(titular.location).toBe('bench');
    expect(titular.positionCode).toBeNull();
    expect(changed.sort()).toEqual(['suplente', 'titular']);
  });

  it('mover al banquillo limpia posición y coords', () => {
    const start: PositionAssignment[] = [
      { playerId: 'p1', location: 'field', positionCode: 'GK', xPct: 50, yPct: 94, outReason: null },
    ];
    const { next } = applyDrop(start, { playerId: 'p1', target: { kind: 'bench' } }, f433);
    const me = next[0]!;
    expect(me).toMatchObject({ location: 'bench', positionCode: null, xPct: null, yPct: null, outReason: null });
  });

  it('mover a fuera aplica out_reason por defecto y conserva el existente', () => {
    const r1 = applyDrop([bench('p1')], { playerId: 'p1', target: { kind: 'out' } }, f433);
    expect(r1.next[0]!.location).toBe('out');
    expect(r1.next[0]!.outReason).toBe('tecnico');

    const already: PositionAssignment[] = [
      { playerId: 'p1', location: 'out', positionCode: null, xPct: null, yPct: null, outReason: 'fisico' },
    ];
    const r2 = applyDrop(already, { playerId: 'p1', target: { kind: 'out' } }, f433);
    expect(r2.next[0]!.outReason).toBe('fisico');
  });

  it('out_reason por defecto configurable', () => {
    const r = applyDrop([bench('p1')], { playerId: 'p1', target: { kind: 'out' } }, f433, 'disciplinario');
    expect(r.next[0]!.outReason).toBe('disciplinario');
  });

  it('drop de un jugador inexistente es no-op', () => {
    const start = [bench('p1')];
    const { next, changed } = applyDrop(start, { playerId: 'fantasma', target: { kind: 'bench' } }, f433);
    expect(changed).toEqual([]);
    expect(next).toBe(start);
  });
});
