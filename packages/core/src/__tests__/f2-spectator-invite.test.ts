import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isEmailAlreadyExistsError,
  performSpectatorInvite,
} from '../spectators/index';
import type { Database } from '../supabase/types';

// ─────────────────────────────────────────────────────────────────────────────
// Clientes mock — solo los métodos que toca performSpectatorInvite.
// ─────────────────────────────────────────────────────────────────────────────

type UserOpts = {
  rpcData?: { id: string; token: string; email: string } | null;
  rpcError?: { message: string } | null;
  resetError?: { message: string } | null;
  onRpc?: () => void;
  onReset?: () => void;
};

function makeUserClient(opts: UserOpts): SupabaseClient<Database> {
  return {
    rpc: (_name: string, _args: unknown) => ({
      single: async () => {
        opts.onRpc?.();
        return { data: opts.rpcData ?? null, error: opts.rpcError ?? null };
      },
    }),
    auth: {
      resetPasswordForEmail: async () => {
        opts.onReset?.();
        return { error: opts.resetError ?? null };
      },
    },
  } as unknown as SupabaseClient<Database>;
}

type AdminOpts = {
  inviteError?: { message?: string; code?: string } | null;
  onInvite?: () => void;
};

function makeAdminClient(opts: AdminOpts): SupabaseClient<Database> {
  return {
    auth: {
      admin: {
        inviteUserByEmail: async () => {
          opts.onInvite?.();
          return { data: {}, error: opts.inviteError ?? null };
        },
      },
    },
  } as unknown as SupabaseClient<Database>;
}

const OK_INVITE = { id: 'inv-1', token: 'tok-1', email: 'abuelo@correo.com' };
const ARGS = {
  playerId: 'player-1',
  email: 'abuelo@correo.com',
  linkBase: 'https://misterfc.es/es/invite',
};

describe('F2 · isEmailAlreadyExistsError (el caso delicado)', () => {
  it('detecta por code email_exists', () => {
    expect(isEmailAlreadyExistsError({ code: 'email_exists' })).toBe(true);
  });
  it('detecta por mensaje (variantes de GoTrue)', () => {
    expect(
      isEmailAlreadyExistsError({ message: 'A user with this email address has already been registered' }),
    ).toBe(true);
    expect(isEmailAlreadyExistsError({ message: 'User already exists' })).toBe(true);
  });
  it('no confunde otros errores', () => {
    expect(isEmailAlreadyExistsError({ message: 'rate limit exceeded' })).toBe(false);
    expect(isEmailAlreadyExistsError({ code: 'over_email_send_rate_limit' })).toBe(false);
    expect(isEmailAlreadyExistsError(null)).toBe(false);
    expect(isEmailAlreadyExistsError(undefined)).toBe(false);
    expect(isEmailAlreadyExistsError('boom')).toBe(false);
  });
});

describe('F2 · performSpectatorInvite (orden = seguridad)', () => {
  it('tutor + email nuevo → crea invitación y envía email', async () => {
    const onInvite = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ onInvite });

    const res = await performSpectatorInvite(user, admin, ARGS);

    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(onInvite).toHaveBeenCalledTimes(1); // el email SÍ se envió
  });

  it('tutor + email YA usuario → reenvía por reset, no revienta (existing:true)', async () => {
    const onReset = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE, onReset });
    const admin = makeAdminClient({ inviteError: { code: 'email_exists' } });

    const res = await performSpectatorInvite(user, admin, ARGS);

    expect(res).toEqual({ ok: { email: ARGS.email, existing: true } });
    expect(onReset).toHaveBeenCalledTimes(1); // fallback de reset ejecutado
  });

  it('no-tutor → gate del RPC rechaza y el ADMIN (email) NUNCA se llama', async () => {
    const onInvite = vi.fn();
    const user = makeUserClient({ rpcError: { message: 'forbidden' } });
    const admin = makeAdminClient({ onInvite });

    const res = await performSpectatorInvite(user, admin, ARGS);

    expect(res).toEqual({ error: 'forbidden' });
    expect(onInvite).not.toHaveBeenCalled(); // service-role JAMÁS antes del gate
  });

  it('email inválido en el RPC → email_invalid, sin enviar email', async () => {
    const onInvite = vi.fn();
    const user = makeUserClient({ rpcError: { message: 'invalid_email' } });
    const admin = makeAdminClient({ onInvite });

    const res = await performSpectatorInvite(user, admin, ARGS);

    expect(res).toEqual({ error: 'email_invalid' });
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('email otro error (no email_exists) → generic y loguea el crudo', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ inviteError: { message: 'smtp down' } });

    const res = await performSpectatorInvite(user, admin, ARGS, log);

    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'inviteUserByEmail_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('reset fallback falla → generic (no queda a medias en silencio)', async () => {
    const log = vi.fn();
    const user = makeUserClient({
      rpcData: OK_INVITE,
      resetError: { message: 'reset boom' },
    });
    const admin = makeAdminClient({ inviteError: { code: 'email_exists' } });

    const res = await performSpectatorInvite(user, admin, ARGS, log);

    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'reset_fallback_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });
});
