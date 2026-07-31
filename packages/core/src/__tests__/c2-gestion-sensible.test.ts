import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  getPlayerManagementAccessFromClient,
  getPlayerMedicalFromClient,
  setPlayerMedicalFromClient,
  getPlayerPhotoPathFromClient,
  signPlayerPhotoFromClient,
  setPlayerPhotoPathFromClient,
  clearPlayerPhotoFromClient,
  requestPlayerErasureFromClient,
} from '../player-profile/sensitive';

type RpcCfg = Record<string, { data?: unknown; error?: { message: string } | null }>;

/** Mock: rpc por nombre; players.photo_url vía from().maybeSingle(); storage.createSignedUrl. */
function mockClient(cfg: {
  rpc?: RpcCfg;
  photoUrl?: string | null;
  signedUrl?: string | null;
}): SupabaseClient<Database> {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return cfg.rpc?.[name] ?? { data: null, error: null };
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({ data: { photo_url: cfg.photoUrl ?? null } });
      return chain;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: cfg.signedUrl ?? null } }),
      }),
    },
    __rpcCalls: rpcCalls,
  } as unknown as SupabaseClient<Database> & { __rpcCalls: typeof rpcCalls };
  return client;
}

describe('C2 · gates de gestión', () => {
  it('deriva isTutor y canWriteMedical de las dos RPC', async () => {
    const sb = mockClient({
      rpc: {
        user_is_tutor_of_player: { data: true },
        user_has_medical_consent_write: { data: false },
      },
    });
    expect(await getPlayerManagementAccessFromClient(sb, 'P1')).toEqual({
      isTutor: true,
      canWriteMedical: false,
    });
  });

  it('no-tutor → ambos false', async () => {
    const sb = mockClient({ rpc: {} });
    expect(await getPlayerManagementAccessFromClient(sb, 'P1')).toEqual({
      isTutor: false,
      canWriteMedical: false,
    });
  });
});

describe('C2 · datos médicos', () => {
  it('get devuelve la fila del RPC o null', async () => {
    const sb = mockClient({
      rpc: {
        get_player_medical: {
          data: [
            {
              allergies: 'polen',
              medication: null,
              medical_conditions: null,
              emergency_contact: '600',
            },
          ],
        },
      },
    });
    expect(await getPlayerMedicalFromClient(sb, 'P1')).toEqual({
      allergies: 'polen',
      medication: null,
      medical_conditions: null,
      emergency_contact: '600',
    });
    const empty = mockClient({ rpc: { get_player_medical: { data: [] } } });
    expect(await getPlayerMedicalFromClient(empty, 'P1')).toBeNull();
  });

  it('set: ok; forbidden (sin consentimiento); genérico con raw', async () => {
    const ok = mockClient({ rpc: { set_player_medical: { error: null } } });
    expect(
      await setPlayerMedicalFromClient(ok, 'P1', {
        allergies: '  polen  ',
        medication: '',
        medical_conditions: null,
        emergency_contact: '600',
      }),
    ).toEqual({ ok: true });

    const forbidden = mockClient({
      rpc: { set_player_medical: { error: { message: 'forbidden: no consent' } } },
    });
    expect(
      await setPlayerMedicalFromClient(forbidden, 'P1', {
        allergies: null,
        medication: null,
        medical_conditions: null,
        emergency_contact: null,
      }),
    ).toEqual({ error: 'forbidden' });

    const generic = mockClient({
      rpc: { set_player_medical: { error: { message: 'boom' } } },
    });
    const res = await setPlayerMedicalFromClient(generic, 'P1', {
      allergies: null,
      medication: null,
      medical_conditions: null,
      emergency_contact: null,
    });
    expect('error' in res && res.error).toBe('generic');
  });

  it('set normaliza los campos (trim, vacío → null) antes del RPC', async () => {
    const sb = mockClient({ rpc: { set_player_medical: { error: null } } }) as unknown as {
      __rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
    } & SupabaseClient<Database>;
    await setPlayerMedicalFromClient(sb, 'P1', {
      allergies: '  polen  ',
      medication: '   ',
      medical_conditions: null,
      emergency_contact: 'mamá 600',
    });
    const call = sb.__rpcCalls.find((c) => c.name === 'set_player_medical')!;
    expect(call.args.p_allergies).toBe('polen');
    expect(call.args.p_medication).toBeNull();
    expect(call.args.p_medical_conditions).toBeNull();
    expect(call.args.p_emergency_contact).toBe('mamá 600');
  });
});

describe('C2 · foto', () => {
  it('getPlayerPhotoPath lee photo_url; signPlayerPhoto firma', async () => {
    expect(await getPlayerPhotoPathFromClient(mockClient({ photoUrl: 'P1/a.jpg' }), 'P1')).toBe(
      'P1/a.jpg',
    );
    expect(await getPlayerPhotoPathFromClient(mockClient({ photoUrl: null }), 'P1')).toBeNull();
    expect(
      await signPlayerPhotoFromClient(mockClient({ signedUrl: 'https://signed' }), 'P1/a.jpg'),
    ).toBe('https://signed');
  });

  it('setPlayerPhotoPath: path ajeno o largo → forbidden sin tocar RPC', async () => {
    const sb = mockClient({ rpc: { set_player_photo: { error: null } } });
    expect(await setPlayerPhotoPathFromClient(sb, 'P1', 'P2/a.jpg')).toEqual({ error: 'forbidden' });
    expect(await setPlayerPhotoPathFromClient(sb, 'P1', '')).toEqual({ error: 'forbidden' });
    // Path válido → ok.
    expect(await setPlayerPhotoPathFromClient(sb, 'P1', 'P1/uuid.jpg')).toEqual({ ok: true });
  });

  it('clearPlayerPhoto: ok / forbidden', async () => {
    const ok = mockClient({ rpc: { set_player_photo: { error: null } } });
    expect(await clearPlayerPhotoFromClient(ok, 'P1')).toEqual({ ok: true });
    const forbidden = mockClient({
      rpc: { set_player_photo: { error: { message: 'forbidden' } } },
    });
    expect(await clearPlayerPhotoFromClient(forbidden, 'P1')).toEqual({ error: 'forbidden' });
  });
});

describe('C2 · derecho al olvido (SOLICITUD)', () => {
  it('ok; motivo vacío → p_reason undefined; forbidden si no tutor', async () => {
    const sb = mockClient({ rpc: { request_player_erasure: { data: 'req-id', error: null } } }) as unknown as {
      __rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
    } & SupabaseClient<Database>;
    expect(await requestPlayerErasureFromClient(sb, 'P1', '   ')).toEqual({ ok: true });
    const call = sb.__rpcCalls.find((c) => c.name === 'request_player_erasure')!;
    expect(call.args.p_reason).toBeUndefined();

    const forbidden = mockClient({
      rpc: { request_player_erasure: { error: { message: 'forbidden' } } },
    });
    expect(await requestPlayerErasureFromClient(forbidden, 'P1', 'motivo')).toEqual({
      error: 'forbidden',
    });
  });
});
