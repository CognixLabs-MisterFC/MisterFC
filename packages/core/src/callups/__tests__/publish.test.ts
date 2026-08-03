import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  publishCallupFromClient,
  republishCallupFromClient,
} from '../publish';
import type { Database } from '../../supabase/types';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Mock table-aware para publicar/republicar. `match_callup_meta` y `events` responden
 * `maybeSingle`; `team_members`/`callup_decisions` se awaitan (thenable → lista).
 * Registra los writes sobre `match_callup_meta` (update/insert) y permite programar
 * su error (42501 → forbidden).
 */
type Calls = { metaUpdates: unknown[]; metaInserts: unknown[] };

function makeClient(opts: {
  meta?: { event_id?: string; published_at?: string | null } | null;
  event?: {
    type: string;
    team_id: string | null;
    starts_at: string;
    teams: { format: string };
  } | null;
  roster?: Array<{ player_id: string; joined_at: string; left_at: string | null }>;
  decisions?: Array<{ player_id: string; decision: string }>;
  metaUpdateError?: { code?: string; message?: string } | null;
  metaInsertError?: { code?: string; message?: string } | null;
}): { client: SupabaseClient<Database>; calls: Calls } {
  const calls: Calls = { metaUpdates: [], metaInserts: [] };

  const from = (table: string) => {
    const listData =
      table === 'team_members'
        ? (opts.roster ?? [])
        : table === 'callup_decisions'
          ? (opts.decisions ?? [])
          : [];
    const singleData =
      table === 'match_callup_meta'
        ? (opts.meta ?? null)
        : table === 'events'
          ? (opts.event ?? null)
          : null;

    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lte', 'in']) builder[m] = () => builder;
    builder.maybeSingle = async () => ({ data: singleData });
    builder.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: listData, error: null });
    builder.update = (patch: unknown) => ({
      eq: () => {
        calls.metaUpdates.push(patch);
        return Promise.resolve({ error: opts.metaUpdateError ?? null });
      },
    });
    builder.insert = (row: unknown) => {
      calls.metaInserts.push(row);
      return Promise.resolve({ error: opts.metaInsertError ?? null });
    };
    return builder;
  };

  return { client: { from } as unknown as SupabaseClient<Database>, calls };
}

const validPublishInput = (over: Record<string, unknown> = {}) => ({
  event_id: EVENT_ID,
  meeting_at: '2026-06-01T17:00:00Z',
  meeting_location: 'Campo municipal',
  publish: true,
  ...over,
});

const friendlyEvent = {
  type: 'friendly',
  team_id: 't-1',
  starts_at: '2999-06-01T18:00:00Z',
  teams: { format: 'F11' },
};

describe('O2-7b-2 · publishCallupFromClient', () => {
  it('primera publicación (sin meta, publish=true) → INSERT con published_at + fan-out callup_published', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = makeClient({ meta: null, event: friendlyEvent });
    const res = await publishCallupFromClient(client, validPublishInput(), fanOut);
    expect(res).toEqual({ ok: true, published: true });
    expect(calls.metaInserts).toHaveLength(1);
    expect(
      (calls.metaInserts[0] as { published_at: string | null }).published_at,
    ).not.toBeNull();
    expect(fanOut).toHaveBeenCalledTimes(1);
    expect(fanOut).toHaveBeenCalledWith(EVENT_ID, 'callup_published');
  });

  it('guardar borrador (publish=false) → INSERT sin published_at, SIN fan-out', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = makeClient({ meta: null, event: friendlyEvent });
    const res = await publishCallupFromClient(
      client,
      validPublishInput({ publish: false }),
      fanOut,
    );
    expect(res).toEqual({ ok: true, published: false });
    expect(
      (calls.metaInserts[0] as { published_at: string | null }).published_at,
    ).toBeNull();
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('publicar un borrador existente (meta con published_at null) → UPDATE + fan-out', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = makeClient({
      meta: { event_id: EVENT_ID, published_at: null },
      event: friendlyEvent,
    });
    const res = await publishCallupFromClient(client, validPublishInput(), fanOut);
    expect(res).toEqual({ ok: true, published: true });
    expect(calls.metaUpdates).toHaveLength(1);
    expect(fanOut).toHaveBeenCalledTimes(1);
  });

  it('re-guardar una YA publicada (publish=true) → UPDATE SIN fan-out (no es 1ª publicación)', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = makeClient({
      meta: { event_id: EVENT_ID, published_at: '2026-05-01T00:00:00Z' },
      event: friendlyEvent,
    });
    const res = await publishCallupFromClient(client, validPublishInput(), fanOut);
    expect(res).toEqual({ ok: true, published: true });
    expect(calls.metaUpdates).toHaveLength(1);
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('GATE server-side: INSERT rechazado (42501) → forbidden, fan-out NO se llama', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({
      meta: null,
      event: friendlyEvent,
      metaInsertError: { code: '42501' },
    });
    const res = await publishCallupFromClient(client, validPublishInput(), fanOut);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('tope de convocados (partido oficial, F7, 13 convocados) → too_many_called_up, sin escribir ni fan-out', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const roster = Array.from({ length: 13 }, (_, i) => ({
      player_id: `p-${i}`,
      joined_at: '2020-01-01',
      left_at: null,
    }));
    const { client, calls } = makeClient({
      meta: null,
      event: {
        type: 'match',
        team_id: 't-1',
        starts_at: '2999-06-01T18:00:00Z',
        teams: { format: 'F7' },
      },
      roster,
      decisions: [],
    });
    const res = await publishCallupFromClient(client, validPublishInput(), fanOut);
    expect(res).toEqual({
      ok: false,
      error: 'too_many_called_up',
      overflow: 1,
      maxCalledUp: 12,
    });
    expect(calls.metaInserts).toHaveLength(0);
    expect(calls.metaUpdates).toHaveLength(0);
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('validación: meeting_location vacío → meeting_location_required, sin tocar BD ni fan-out', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = makeClient({ meta: null });
    const res = await publishCallupFromClient(
      client,
      validPublishInput({ meeting_location: '' }),
      fanOut,
    );
    expect(res).toEqual({ ok: false, error: 'meeting_location_required' });
    expect(calls.metaInserts).toHaveLength(0);
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('un fallo del fan-out NO rompe la publicación (best-effort) y lo reporta', async () => {
    const fanOut = vi.fn().mockRejectedValue(new Error('expo down'));
    const log = vi.fn();
    const { client } = makeClient({ meta: null, event: friendlyEvent });
    const res = await publishCallupFromClient(
      client,
      validPublishInput(),
      fanOut,
      log,
    );
    expect(res).toEqual({ ok: true, published: true });
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('O2-7b-2 · republishCallupFromClient', () => {
  it('sin meta → not_found', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ meta: null });
    const res = await republishCallupFromClient(client, EVENT_ID, fanOut);
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('meta sin publicar → not_published', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ meta: { published_at: null } });
    const res = await republishCallupFromClient(client, EVENT_ID, fanOut);
    expect(res).toEqual({ ok: false, error: 'not_published' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('partido ya empezado → event_started', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({
      meta: { published_at: '2026-05-01T00:00:00Z' },
      event: {
        type: 'friendly',
        team_id: 't-1',
        starts_at: '2000-01-01T00:00:00Z',
        teams: { format: 'F11' },
      },
    });
    const res = await republishCallupFromClient(client, EVENT_ID, fanOut);
    expect(res).toEqual({ ok: false, error: 'event_started' });
    expect(fanOut).not.toHaveBeenCalled();
  });

  it('éxito → UPDATE published_at + fan-out callup_updated con dedupe token', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client, calls } = makeClient({
      meta: { published_at: '2026-05-01T00:00:00Z' },
      event: friendlyEvent,
    });
    const res = await republishCallupFromClient(client, EVENT_ID, fanOut);
    expect(res).toEqual({ ok: true });
    expect(calls.metaUpdates).toHaveLength(1);
    expect(fanOut).toHaveBeenCalledTimes(1);
    const call = fanOut.mock.calls[0]!;
    expect(call[0]).toBe(EVENT_ID);
    expect(call[1]).toBe('callup_updated');
    expect(typeof call[2]).toBe('string');
  });

  it('GATE server-side: UPDATE rechazado (42501) → forbidden, fan-out NO se llama', async () => {
    const fanOut = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({
      meta: { published_at: '2026-05-01T00:00:00Z' },
      event: friendlyEvent,
      metaUpdateError: { code: '42501' },
    });
    const res = await republishCallupFromClient(client, EVENT_ID, fanOut);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(fanOut).not.toHaveBeenCalled();
  });
});
