import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  markHolidayFromClient,
  unmarkHolidayFromClient,
  decideEventApprovalFromClient,
} from '../actions';
import type { Database } from '../../supabase/types';

/** Mock de `.rpc(name)` con respuesta por nombre de RPC. */
function makeClient(responses: Record<string, { data?: unknown; error?: unknown }>) {
  return {
    rpc: (name: string) => Promise.resolve(responses[name] ?? { data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
}

const CLUB = 'cccccccc-0000-4000-8000-000000000001';

describe('markHolidayFromClient', () => {
  it('éxito con entrenos cancelados → fan-out DESPUÉS con (cancelled, "cancelled", reason)', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const sb = makeClient({
      mark_holiday: {
        data: {
          holiday_id: 'h1',
          reason: 'Nieve',
          cancelled: [{ event_id: 'e1', team_id: 't1', title: 'Entreno', starts_at: '2026-01-06T17:00:00Z' }],
        },
      },
    });
    const r = await markHolidayFromClient(sb, CLUB, '2026-01-06', 'Nieve', notify);
    expect(r).toEqual({ success: true, holidayId: 'h1' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![1]).toBe('cancelled');
    expect(notify.mock.calls[0]![2]).toBe('Nieve');
    expect((notify.mock.calls[0]![0] as unknown[]).length).toBe(1);
  });

  it('forbidden → error mapeado y NO se dispara el fan-out', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const sb = makeClient({ mark_holiday: { error: { message: 'forbidden' } } });
    const r = await markHolidayFromClient(sb, CLUB, '2026-01-06', 'x', notify);
    expect(r).toEqual({ success: false, error: 'forbidden' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sin entrenos cancelados → NO fan-out', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const sb = makeClient({ mark_holiday: { data: { holiday_id: 'h2', cancelled: [] } } });
    const r = await markHolidayFromClient(sb, CLUB, '2026-01-06', 'x', notify);
    expect(r).toEqual({ success: true, holidayId: 'h2' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('error de BD desconocido → error "db"', async () => {
    const sb = makeClient({ mark_holiday: { error: { message: 'weird_pg_error' } } });
    const r = await markHolidayFromClient(sb, CLUB, '2026-01-06', 'x', vi.fn());
    expect(r).toEqual({ success: false, error: 'db' });
  });

  it('fan-out que lanza → logger, la acción NO se rompe (blindado)', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('expo down'));
    const logError = vi.fn();
    const sb = makeClient({
      mark_holiday: {
        data: { holiday_id: 'h3', cancelled: [{ event_id: 'e1', team_id: 't1', title: 'X', starts_at: '2026-01-06T17:00:00Z' }] },
      },
    });
    const r = await markHolidayFromClient(sb, CLUB, '2026-01-06', 'x', notify, logError);
    expect(r).toEqual({ success: true, holidayId: 'h3' });
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('unmarkHolidayFromClient', () => {
  it('éxito con reactivados → fan-out "reinstated"', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const sb = makeClient({
      unmark_holiday: { data: { reactivated: [{ event_id: 'e1', team_id: 't1', title: 'X', starts_at: '2026-01-06T17:00:00Z' }] } },
    });
    const r = await unmarkHolidayFromClient(sb, 'h1', notify);
    expect(r).toEqual({ success: true, holidayId: 'h1' });
    expect(notify.mock.calls[0]![1]).toBe('reinstated');
  });
});

describe('decideEventApprovalFromClient', () => {
  it('aprobar → fan-out al creador con status approved', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const sb = makeClient({
      decide_event_approval: {
        data: { event_id: 'e1', team_id: 't1', title: 'X', starts_at: '2026-01-06T17:00:00Z', created_by: 'u9', status: 'approved' },
      },
    });
    const r = await decideEventApprovalFromClient(sb, 'e1', true, null, notify);
    expect(r).toEqual({ success: true, status: 'approved' });
    expect(notify.mock.calls[0]![0]).toMatchObject({ created_by: 'u9', status: 'approved' });
  });

  it('forbidden → 403 mapeado, sin fan-out', async () => {
    const notify = vi.fn();
    const sb = makeClient({ decide_event_approval: { error: { message: 'forbidden' } } });
    const r = await decideEventApprovalFromClient(sb, 'e1', true, null, notify);
    expect(r).toEqual({ success: false, error: 'forbidden' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('rechazar sin motivo → reason_required mapeado', async () => {
    const sb = makeClient({ decide_event_approval: { error: { message: 'reason_required' } } });
    const r = await decideEventApprovalFromClient(sb, 'e1', false, null, vi.fn());
    expect(r).toEqual({ success: false, error: 'reason_required' });
  });
});
