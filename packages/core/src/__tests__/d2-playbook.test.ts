import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { eventScopedCacheKey, teamScopedCacheKey } from '../offline/read-cache';
import { getTeamPlaybookFromClient, getTeamPlayFromClient } from '../plays/queries';
import { sceneAtTime, playDurationMs, type Play } from '../diagram/play';

type TableResult = { data?: unknown[] };

/** Mock table-aware: cada tabla resuelve a su resultado; maybeSingle → 1ª fila. */
function tableClient(tables: Record<string, TableResult>): SupabaseClient<Database> {
  const res = (table: string): TableResult => tables[table] ?? { data: [] };
  function builder(table: string) {
    const r = res(table);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'or', 'not']) {
      chain[m] = () => chain;
    }
    (chain as { then: unknown }).then = (f: (v: TableResult) => unknown) => Promise.resolve(r).then(f);
    (chain as { maybeSingle: unknown }).maybeSingle = () =>
      Promise.resolve({ data: (r.data ?? [])[0] ?? null });
    return chain;
  }
  return { from: (tbl: string) => builder(tbl) } as unknown as SupabaseClient<Database>;
}

const twoFramePlay: Play = {
  version: 1,
  field: { kind: 'completo', orientation: 'vertical' },
  frames: [
    { elements: [{ type: 'jugador', id: 'p1', x_pct: 0, y_pct: 0, role: 'atacante' }], duration_ms: 1000 },
    { elements: [{ type: 'jugador', id: 'p1', x_pct: 100, y_pct: 100, role: 'atacante' }] },
  ],
};

describe('D2 · keys de caché', () => {
  it('team-scoped (playbook) y play-scoped (detalle) con id', () => {
    expect(teamScopedCacheKey('playbook', 'C1', 'T1')).toBe('playbook::C1::T1');
    expect(eventScopedCacheKey('play', 'PL1')).toBe('play::PL1');
    expect(eventScopedCacheKey('play', 'PL1')).not.toBe(eventScopedCacheKey('play', 'PL2'));
  });
});

describe('D2 · getTeamPlaybookFromClient', () => {
  it('mapea, calcula frame_count y ordena por updated_at desc', async () => {
    const sb = tableClient({
      team_plays: {
        data: [
          { signal_id: null, play: { id: 'A', name: 'Vieja', play: twoFramePlay, updated_at: '2026-01-01' } },
          { signal_id: 'puno_alto', play: { id: 'B', name: 'Nueva', play: twoFramePlay, updated_at: '2026-03-01' } },
          { signal_id: null, play: null }, // sin play → se filtra
        ],
      },
    });
    const rows = await getTeamPlaybookFromClient(sb, 'T1');
    expect(rows.map((r) => r.id)).toEqual(['B', 'A']); // más reciente primero
    expect(rows[0]!.frame_count).toBe(2);
  });
});

describe('D2 · getTeamPlayFromClient (gate team_plays)', () => {
  it('sin share compartida → null (no toca plays)', async () => {
    const sb = tableClient({ team_plays: { data: [] } });
    expect(await getTeamPlayFromClient(sb, 'C1', 'PL1')).toBeNull();
  });

  it('compartida → devuelve la jugada parseada + seña', async () => {
    const sb = tableClient({
      team_plays: { data: [{ play_id: 'PL1', signal_id: 'puno_alto' }] },
      plays: { data: [{ id: 'PL1', name: 'Córner', play: twoFramePlay }] },
    });
    const tp = await getTeamPlayFromClient(sb, 'C1', 'PL1');
    expect(tp).not.toBeNull();
    expect(tp!.name).toBe('Córner');
    expect(tp!.signal_id).toBe('puno_alto');
    expect(tp!.play.frames).toHaveLength(2);
  });
});

describe('D2 · motor puro reutilizado (sceneAtTime)', () => {
  it('interpola la posición del jugador a mitad de la transición', () => {
    expect(playDurationMs(twoFramePlay)).toBe(1000);
    const mid = sceneAtTime(twoFramePlay, 500);
    const p1 = mid.elements.find((e) => e.id === 'p1');
    expect(p1?.type).toBe('jugador');
    // A mitad: (0,0)→(100,100) ⇒ (50,50).
    if (p1 && p1.type === 'jugador') {
      expect(p1.x_pct).toBeCloseTo(50);
      expect(p1.y_pct).toBeCloseTo(50);
    }
  });
});
