import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { performSelfInvite } from '../self-invite';
import type { Database } from '../../supabase/types';

// ─────────────────────────────────────────────────────────────────────────────
// Clientes mock — solo los métodos que toca performSelfInvite. Mismo andamiaje
// que f2-spectator-invite.test.ts, que cubre el sender hermano.
// ─────────────────────────────────────────────────────────────────────────────

type UserOpts = {
  rpcData?: { id: string; token: string; email: string } | null;
  rpcError?: { message: string } | null;
  resetError?: { message: string } | null;
  onRpc?: (name: string, args: unknown) => void;
  onReset?: () => void;
};

function makeUserClient(opts: UserOpts): SupabaseClient<Database> {
  return {
    rpc: (name: string, args: unknown) => ({
      single: async () => {
        opts.onRpc?.(name, args);
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
  /** Espía: el admin NO puede llamar a la RPC. */
  onRpc?: () => void;
};

function makeAdminClient(opts: AdminOpts): SupabaseClient<Database> {
  const uid = opts.invitedUserId === undefined ? 'auth-user-1' : opts.invitedUserId;
  return {
    rpc: () => ({
      single: async () => {
        opts.onRpc?.();
        return { data: null, error: null };
      },
    }),
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

function makeLink(ok = true) {
  return vi.fn(async (_invitationId: string, _invitedUserId: string) => ({ ok }));
}

const OK_INVITE = { id: 'inv-1', token: 'tok-1', email: 'hijo@correo.com' };
const ARGS = {
  playerId: 'player-1',
  email: 'hijo@correo.com',
  linkBase: 'https://misterfc.es/es/invite',
  locale: 'es',
};

describe('MN-5 · performSelfInvite', () => {
  it('crea la invitación, manda el correo y ENLAZA la cuenta creada', async () => {
    const link = makeLink();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({}),
      ARGS,
      link,
    );
    expect(res).toEqual({ ok: { email: 'hijo@correo.com', existing: false } });
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-user-1');
  });

  // LA GARANTÍA DE ORDEN: la RPC (que lleva los gates dentro) se llama con el
  // cliente del USUARIO. Si se llamara con admin, el gate de tutor no existiría.
  it('llama a invite_player_self con el cliente del usuario, nunca con el admin', async () => {
    const onUserRpc = vi.fn();
    const onAdminRpc = vi.fn();
    await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE, onRpc: onUserRpc }),
      makeAdminClient({ onRpc: onAdminRpc }),
      ARGS,
      makeLink(),
    );
    expect(onUserRpc).toHaveBeenCalledOnce();
    expect(onAdminRpc).not.toHaveBeenCalled();
    expect(onUserRpc.mock.calls[0]?.[0]).toBe('invite_player_self');
  });

  // La relación NO viaja desde el cliente: la RPC solo recibe jugador y correo, y
  // escribe ella `player_relation='self'`. Es lo que impide que esta vía sea otra
  // puerta al agujero de invite_email.
  it('no manda ninguna relación en los argumentos de la RPC', async () => {
    const onRpc = vi.fn();
    await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE, onRpc }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
    );
    expect(onRpc.mock.calls[0]?.[1]).toEqual({
      p_player_id: 'player-1',
      p_email: 'hijo@correo.com',
    });
  });

  it('si el gate falla, NO se manda ningún correo', async () => {
    const onInvite = vi.fn();
    const res = await performSelfInvite(
      makeUserClient({ rpcError: { message: 'forbidden' } }),
      makeAdminClient({ onInvite }),
      ARGS,
      makeLink(),
    );
    expect(res).toEqual({ error: 'forbidden' });
    expect(onInvite).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 'forbidden'],
    ['erased', 'erased'],
    ['already_linked', 'already_linked'],
    ['email_relation_conflict', 'email_relation_conflict'],
    ['consents_required', 'consents_required'],
    ['no_active_season', 'no_active_season'],
    ['invalid_email', 'email_invalid'],
  ] as const)('mapea el gate %s de la RPC', async (raised, expected) => {
    const res = await performSelfInvite(
      makeUserClient({
        rpcError: { message: `new row violates ... ${raised} ...` },
      }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
    );
    expect(res).toEqual({ error: expected });
  });

  it('un error desconocido de la RPC cae en generic y SÍ se reporta', async () => {
    const log = vi.fn();
    const res = await performSelfInvite(
      makeUserClient({ rpcError: { message: 'deadlock detected' } }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
      log,
    );
    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledOnce();
  });

  // Los gates son respuestas esperadas del negocio: llenar Sentry con ellas
  // esconde las incidencias de verdad.
  it('un gate conocido NO se reporta a Sentry', async () => {
    const log = vi.fn();
    await performSelfInvite(
      makeUserClient({ rpcError: { message: 'already_linked' } }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
      log,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('si el correo ya es usuario, reenvía por reset y NO enlaza', async () => {
    const onReset = vi.fn();
    const link = makeLink();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE, onReset }),
      makeAdminClient({ inviteError: { code: 'email_exists' } }),
      ARGS,
      link,
    );
    expect(res).toEqual({ ok: { email: 'hijo@correo.com', existing: true } });
    expect(onReset).toHaveBeenCalledOnce();
    // La cuenta NO la hemos creado nosotros: invited_user_id queda NULL por diseño.
    expect(link).not.toHaveBeenCalled();
  });

  it('si el reset tambien falla, es generic', async () => {
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE, resetError: { message: 'nope' } }),
      makeAdminClient({ inviteError: { code: 'email_exists' } }),
      ARGS,
      makeLink(),
    );
    expect(res).toEqual({ error: 'generic' });
  });

  // #535 — invite OK pero sin user.id: enlazar es imposible, así que se corta en
  // vez de dar por buena una invitación que nadie podrá completar.
  it('invite sin user.id corta con generic y no enlaza', async () => {
    const link = makeLink();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({ invitedUserId: null }),
      ARGS,
      link,
    );
    expect(res).toEqual({ error: 'generic' });
    expect(link).not.toHaveBeenCalled();
  });

  // #540 — el puerto exige 1 fila afectada; si no, la invitación queda rota.
  it('si el enlazado falla, el resultado es generic', async () => {
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({}),
      ARGS,
      makeLink(false),
    );
    expect(res).toEqual({ error: 'generic' });
  });

  it('la RPC sin fila devuelta es generic', async () => {
    const res = await performSelfInvite(
      makeUserClient({ rpcData: null }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
    );
    expect(res).toEqual({ error: 'generic' });
  });
});
