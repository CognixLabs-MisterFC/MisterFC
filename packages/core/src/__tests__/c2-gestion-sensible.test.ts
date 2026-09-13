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
  // MN-6 — los gates son el espejo del reparto de MN-1: `user_manages_player` para
  // la superficie COMPARTIDA y `user_manages_player_sensitive` para la RESERVADA.
  it('el TUTOR tiene las dos superficies', async () => {
    const sb = mockClient({
      rpc: {
        user_manages_player: { data: true },
        user_manages_player_sensitive: { data: true },
        user_has_medical_consent_write: { data: true },
      },
    });
    expect(await getPlayerManagementAccessFromClient(sb, 'P1')).toEqual({
      canManage: true,
      canManageSensitive: true,
      canWriteMedical: true,
    });
  });

  // El caso que da nombre a MN-6: el menor con cuenta propia gestiona su foto y no
  // ve médica, expediente ni supresión.
  it('el MENOR self tiene la compartida y NO la reservada', async () => {
    const sb = mockClient({
      rpc: {
        user_manages_player: { data: true },
        user_manages_player_sensitive: { data: false },
        user_has_medical_consent_write: { data: true },
      },
    });
    expect(await getPlayerManagementAccessFromClient(sb, 'P1')).toEqual({
      canManage: true,
      canManageSensitive: false,
      // El consentimiento por sí solo NO abre la médica: sin superficie reservada
      // no hay escritura, y `set_player_medical` exige las dos cosas.
      canWriteMedical: false,
    });
  });

  // La regresión que MN-1 dejó suelta: el jugador ADULTO de su propia ficha, que es
  // para lo que existe la 20261038. El SQL se lo permitía; la interfaz no se lo pintaba.
  it('el jugador ADULTO self conserva las dos superficies', async () => {
    const sb = mockClient({
      rpc: {
        user_manages_player: { data: true },
        user_manages_player_sensitive: { data: true },
        user_has_medical_consent_write: { data: true },
      },
    });
    const access = await getPlayerManagementAccessFromClient(sb, 'P1');
    expect(access.canManageSensitive).toBe(true);
    expect(access.canWriteMedical).toBe(true);
  });

  it('sin consentimiento médico, la reservada sigue abierta pero la médica no', async () => {
    const sb = mockClient({
      rpc: {
        user_manages_player: { data: true },
        user_manages_player_sensitive: { data: true },
        user_has_medical_consent_write: { data: false },
      },
    });
    expect(await getPlayerManagementAccessFromClient(sb, 'P1')).toEqual({
      canManage: true,
      canManageSensitive: true,
      canWriteMedical: false,
    });
  });

  it('quien no está vinculado no tiene ninguna', async () => {
    const sb = mockClient({ rpc: {} });
    expect(await getPlayerManagementAccessFromClient(sb, 'P1')).toEqual({
      canManage: false,
      canManageSensitive: false,
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
