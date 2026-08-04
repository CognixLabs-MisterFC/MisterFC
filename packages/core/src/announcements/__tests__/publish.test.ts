import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  publishAnnouncementFromClient,
  updateAnnouncementFromClient,
  deleteAnnouncementFromClient,
} from '../publish';
import type { Database } from '../../supabase/types';

const CLUB = 'cccccccc-0000-4000-8000-000000000001';
const OTHER_CLUB = 'cccccccc-0000-4000-8000-000000000002';
const TEAM = 'bbbbbbbb-0000-4000-8000-000000000001';
const AUTHOR = 'dddddddd-0000-4000-8000-000000000001';
const ANN = 'eeeeeeee-0000-4000-8000-000000000001';

type Term = { data?: unknown; error?: unknown; count?: number };

/** Cliente mock por tabla (mismo patrón que messaging/create): cada terminal
 * (maybeSingle / single / await) consume la siguiente respuesta en cola. */
function makeClient(responses: Record<string, Term[]>) {
  const next = (table: string): Term => {
    const arr = responses[table];
    if (!arr || arr.length === 0) throw new Error(`sin respuesta para ${table}`);
    return arr.shift()!;
  };
  const build = (table: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain;
    q.eq = chain;
    q.insert = chain;
    q.update = chain;
    q.delete = chain;
    q.maybeSingle = () => Promise.resolve(next(table));
    q.single = () => Promise.resolve(next(table));
    q.then = (onF: (v: Term) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(onF, onR);
    return q;
  };
  return { from: (table: string) => build(table) } as unknown as SupabaseClient<Database>;
}

const input = {
  clubId: CLUB,
  authorProfileId: AUTHOR,
  teamId: TEAM,
  title: 'Aviso',
  body: 'Entreno movido',
  pinned: false,
  expiresAt: null,
  locale: 'es',
};

describe('publishAnnouncementFromClient', () => {
  it('publica como el usuario y DISPARA el fan-out tras el insert', async () => {
    const sb = makeClient({
      teams: [{ data: { id: TEAM, categories: { club_id: CLUB } } }],
      announcements: [{ data: { id: ANN } }],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await publishAnnouncementFromClient(sb, input, notify);
    expect(r).toEqual({ ok: { announcementId: ANN } });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(ANN);
  });

  it('GATE server-side: la RLS rechaza el INSERT (42501) → forbidden y el fan-out NO se llama', async () => {
    const sb = makeClient({
      teams: [{ data: { id: TEAM, categories: { club_id: CLUB } } }],
      announcements: [{ data: null, error: { code: '42501' } }],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await publishAnnouncementFromClient(sb, input, notify);
    expect(r).toEqual({ error: 'forbidden' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('equipo de otro club → team_not_in_club, sin insert ni fan-out', async () => {
    const sb = makeClient({
      teams: [{ data: { id: TEAM, categories: { club_id: OTHER_CLUB } } }],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await publishAnnouncementFromClient(sb, input, notify);
    expect(r).toEqual({ error: 'team_not_in_club' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('un fallo del fan-out NO revierte la publicación', async () => {
    const sb = makeClient({
      teams: [{ data: { id: TEAM, categories: { club_id: CLUB } } }],
      announcements: [{ data: { id: ANN } }],
    });
    const notify = vi.fn().mockRejectedValue(new Error('expo down'));
    const r = await publishAnnouncementFromClient(sb, input, notify);
    expect(r).toEqual({ ok: { announcementId: ANN } });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe('updateAnnouncementFromClient (RLS directa, sin fan-out)', () => {
  it('edita y devuelve el teamId (para revalidar) — NO notifica', async () => {
    const sb = makeClient({
      announcements: [{ data: { id: ANN, team_id: TEAM } }, { error: null }],
    });
    const r = await updateAnnouncementFromClient(sb, ANN, { title: 'Nuevo' });
    expect(r).toEqual({ ok: { announcementId: ANN, teamId: TEAM } });
  });

  it('42501 → forbidden', async () => {
    const sb = makeClient({
      announcements: [{ data: { id: ANN, team_id: TEAM } }, { error: { code: '42501' } }],
    });
    const r = await updateAnnouncementFromClient(sb, ANN, { body: 'x' });
    expect(r).toEqual({ error: 'forbidden' });
  });

  it('no existe → not_found', async () => {
    const sb = makeClient({ announcements: [{ data: null }] });
    const r = await updateAnnouncementFromClient(sb, ANN, { title: 'x' });
    expect(r).toEqual({ error: 'not_found' });
  });
});

describe('deleteAnnouncementFromClient', () => {
  it('borra y devuelve el teamId', async () => {
    const sb = makeClient({
      announcements: [{ data: { id: ANN, team_id: TEAM } }, { error: null, count: 1 }],
    });
    const r = await deleteAnnouncementFromClient(sb, ANN);
    expect(r).toEqual({ ok: { teamId: TEAM } });
  });

  it('count 0 (RLS no dejó) → forbidden', async () => {
    const sb = makeClient({
      announcements: [{ data: { id: ANN, team_id: TEAM } }, { error: null, count: 0 }],
    });
    const r = await deleteAnnouncementFromClient(sb, ANN);
    expect(r).toEqual({ error: 'forbidden' });
  });
});
