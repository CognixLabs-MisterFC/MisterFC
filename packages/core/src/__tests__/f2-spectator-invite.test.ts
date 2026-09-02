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
  /** id de la cuenta que CREA el invite. `null` = respuesta sin user.id (#535). */
  invitedUserId?: string | null;
};

function makeAdminClient(opts: AdminOpts): SupabaseClient<Database> {
  const uid = opts.invitedUserId === undefined ? 'auth-user-1' : opts.invitedUserId;
  return {
    auth: {
      admin: {
        inviteUserByEmail: async () => {
          opts.onInvite?.();
          return {
            data: uid ? { user: { id: uid } } : {},
            error: opts.inviteError ?? null,
          };
        },
      },
    },
  } as unknown as SupabaseClient<Database>;
}

/** Puerto de enlazado: por defecto OK. Espía para afirmar CON QUÉ se llamó. */
function makeLink(ok = true) {
  return vi.fn(async (_invitationId: string, _invitedUserId: string) => ({ ok }));
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

    const link = makeLink();
    const res = await performSpectatorInvite(user, admin, ARGS, link);

    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(onInvite).toHaveBeenCalledTimes(1); // el email SÍ se envió
    // …y se ENLAZÓ la cuenta recién creada con la invitación (7º sender, #545-bis).
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-user-1');
  });

  it('tutor + email YA usuario → reenvía por reset, no revienta (existing:true)', async () => {
    const onReset = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE, onReset });
    const admin = makeAdminClient({ inviteError: { code: 'email_exists' } });

    const link = makeLink();
    const res = await performSpectatorInvite(user, admin, ARGS, link);

    expect(res).toEqual({ ok: { email: ARGS.email, existing: true } });
    expect(onReset).toHaveBeenCalledTimes(1); // fallback de reset ejecutado
    // La cuenta es del propio invitado → invited_user_id NULL por diseño: NO se enlaza.
    expect(link).not.toHaveBeenCalled();
  });

  it('no-tutor → gate del RPC rechaza y el ADMIN (email) NUNCA se llama', async () => {
    const onInvite = vi.fn();
    const user = makeUserClient({ rpcError: { message: 'forbidden' } });
    const admin = makeAdminClient({ onInvite });

    const res = await performSpectatorInvite(user, admin, ARGS, makeLink());

    expect(res).toEqual({ error: 'forbidden' });
    expect(onInvite).not.toHaveBeenCalled(); // service-role JAMÁS antes del gate
  });

  it('email inválido en el RPC → email_invalid, sin enviar email', async () => {
    const onInvite = vi.fn();
    const user = makeUserClient({ rpcError: { message: 'invalid_email' } });
    const admin = makeAdminClient({ onInvite });

    const res = await performSpectatorInvite(user, admin, ARGS, makeLink());

    expect(res).toEqual({ error: 'email_invalid' });
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('email otro error (no email_exists) → generic y loguea el crudo', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ inviteError: { message: 'smtp down' } });

    const res = await performSpectatorInvite(user, admin, ARGS, makeLink(), log);

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

    const res = await performSpectatorInvite(user, admin, ARGS, makeLink(), log);

    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'reset_fallback_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7º SENDER — ENLAZADO de invitations.invited_user_id (censo de link-invited-user).
// Sin esto, chooseInviteForm no enruta al form set_password por id y el seguidor
// nuevo cae en la trampa del incidente de agosto de 2026.
// ─────────────────────────────────────────────────────────────────────────────

describe('F2 · performSpectatorInvite · enlazado (7º sender)', () => {
  it('enlaza la invitación ANCLA con el id de la cuenta creada', async () => {
    const link = makeLink();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ invitedUserId: 'auth-abuelo' });

    const res = await performSpectatorInvite(user, admin, ARGS, link);

    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-abuelo');
  });

  it('invite sin user.id → generic + log ruidoso, y NO intenta enlazar', async () => {
    const log = vi.fn();
    const link = makeLink();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ invitedUserId: null });

    const res = await performSpectatorInvite(user, admin, ARGS, link, log);

    expect(res).toEqual({ error: 'generic' });
    expect(link).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'invited_user_missing_id_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('enlazado que falla (≠1 fila) → generic: no se entrega una invitación rota', async () => {
    const link = makeLink(false);
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});

    const res = await performSpectatorInvite(user, admin, ARGS, link);

    // El puerto ya ha reportado por su cuenta (linkInvitedUser → Sentry): aquí
    // solo se corta. El email YA salió; el reintento del tutor supersede la
    // invitación anterior (invite_spectator borra las pendientes del mismo par).
    expect(res).toEqual({ error: 'generic' });
    expect(link).toHaveBeenCalledTimes(1);
  });
});
