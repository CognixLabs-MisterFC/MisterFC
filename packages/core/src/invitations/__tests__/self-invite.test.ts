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
  onRpc?: (name: string, args: unknown) => void;
};

function makeUserClient(opts: UserOpts): SupabaseClient<Database> {
  return {
    rpc: (name: string, args: unknown) => ({
      single: async () => {
        opts.onRpc?.(name, args);
        return { data: opts.rpcData ?? null, error: opts.rpcError ?? null };
      },
    }),
  } as unknown as SupabaseClient<Database>;
}

type AdminOpts = {
  createError?: { message?: string; code?: string } | null;
  onCreate?: (attrs: unknown) => void;
  /** id de la cuenta creada. `null` = respuesta sin user.id (#535). */
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
        createUser: async (attrs: unknown) => {
          opts.onCreate?.(attrs);
          return {
            data: uid ? { user: { id: uid } } : {},
            error: opts.createError ?? null,
          };
        },
      },
    },
  } as unknown as SupabaseClient<Database>;
}

function makeLink(ok = true) {
  return vi.fn(async (_invitationId: string, _invitedUserId: string) => ({ ok }));
}

/** Puerto de correo (Correo-B2). Espía: afirma QUÉ enlace y en QUÉ idioma sale. */
function makeSendEmail(error: unknown = null) {
  return vi.fn(async (_args: { to: string; url: string; locale: string }) => ({ error }));
}

/**
 * Puerto de búsqueda. Por defecto: no tiene cuenta. OJO con el caso contrario en
 * este sender: la cuenta del menor suele llevar el correo del PADRE, que casi
 * siempre ya tiene cuenta, así que "ya existe" no es aquí el caso raro.
 */
function makeLookup(
  found: { userId: string; invitePending: boolean; locale: string | null } | null = null,
) {
  return vi.fn(async (_email: string) => found);
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
      makeSendEmail(),
      makeLookup(),
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
      makeSendEmail(),
      makeLookup(),
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
      makeSendEmail(),
      makeLookup(),
    );
    expect(onRpc.mock.calls[0]?.[1]).toEqual({
      p_player_id: 'player-1',
      p_email: 'hijo@correo.com',
    });
  });

  it('si el gate falla, NO se crea cuenta NI se manda ningún correo', async () => {
    const onCreate = vi.fn();
    const sendEmail = makeSendEmail();
    const res = await performSelfInvite(
      makeUserClient({ rpcError: { message: 'forbidden' } }),
      makeAdminClient({ onCreate }),
      ARGS,
      makeLink(),
      sendEmail,
      makeLookup(),
    );
    expect(res).toEqual({ error: 'forbidden' });
    expect(onCreate).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
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
      makeSendEmail(),
      makeLookup(),
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
      makeSendEmail(),
      makeLookup(),
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
      makeSendEmail(),
      makeLookup(),
      log,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('si el correo ya tiene cuenta propia: mismo correo de invitación, sin crear ni enlazar', async () => {
    const onCreate = vi.fn();
    const link = makeLink();
    const sendEmail = makeSendEmail();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({ onCreate }),
      ARGS,
      link,
      sendEmail,
      makeLookup({ userId: 'auth-padre', invitePending: false, locale: null }),
    );
    expect(res).toEqual({ ok: { email: 'hijo@correo.com', existing: true } });
    expect(onCreate).not.toHaveBeenCalled();
    // La cuenta NO la hemos creado nosotros: invited_user_id queda NULL por diseño.
    expect(link).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('REENVÍO a la cuenta del menor sin reclamar: la enlaza, no crea otra', async () => {
    const onCreate = vi.fn();
    const link = makeLink();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({ onCreate }),
      ARGS,
      link,
      makeSendEmail(),
      makeLookup({ userId: 'auth-menor', invitePending: true, locale: null }),
    );
    expect(res).toEqual({ ok: { email: 'hijo@correo.com', existing: false } });
    expect(onCreate).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-menor');
  });

  it('el idioma del destinatario manda: la cuenta del menor suele llevar el correo del padre', async () => {
    const sendEmail = makeSendEmail();
    await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
      sendEmail,
      makeLookup({ userId: 'auth-padre', invitePending: false, locale: 'va' }),
    );
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'hijo@correo.com',
      url: 'https://misterfc.es/es/invite/tok-1',
      locale: 'va',
    });
  });

  it('la cuenta nace CONFIRMADA y con su invitation_id (F14D) y kind menor', async () => {
    const onCreate = vi.fn();
    await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({ onCreate }),
      ARGS,
      makeLink(),
      makeSendEmail(),
      makeLookup(),
    );
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'hijo@correo.com',
        email_confirm: true,
        user_metadata: expect.objectContaining({
          invitation_id: 'inv-1',
          invite_kind: 'menor',
        }),
      }),
    );
  });

  it('si el correo no sale, es generic y queda el rastro', async () => {
    const log = vi.fn();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
      makeSendEmail({ message: 'resend 422' }),
      makeLookup(),
      log,
    );
    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'send_invite_email_self',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  // #535 — invite OK pero sin user.id: enlazar es imposible, así que se corta en
  // vez de dar por buena una invitación que nadie podrá completar.
  it('cuenta creada sin user.id corta con generic, no enlaza y NO manda correo', async () => {
    const link = makeLink();
    const sendEmail = makeSendEmail();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({ invitedUserId: null }),
      ARGS,
      link,
      sendEmail,
      makeLookup(),
    );
    expect(res).toEqual({ error: 'generic' });
    expect(link).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // #540 — el puerto exige 1 fila afectada; si no, la invitación queda rota.
  it('si el enlazado falla, es generic y el correo NO sale (va el último)', async () => {
    const sendEmail = makeSendEmail();
    const res = await performSelfInvite(
      makeUserClient({ rpcData: OK_INVITE }),
      makeAdminClient({}),
      ARGS,
      makeLink(false),
      sendEmail,
      makeLookup(),
    );
    expect(res).toEqual({ error: 'generic' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('la RPC sin fila devuelta es generic', async () => {
    const res = await performSelfInvite(
      makeUserClient({ rpcData: null }),
      makeAdminClient({}),
      ARGS,
      makeLink(),
      makeSendEmail(),
      makeLookup(),
    );
    expect(res).toEqual({ error: 'generic' });
  });
});
