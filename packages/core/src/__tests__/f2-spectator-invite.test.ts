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
  onRpc?: () => void;
};

function makeUserClient(opts: UserOpts): SupabaseClient<Database> {
  return {
    rpc: (_name: string, _args: unknown) => ({
      single: async () => {
        opts.onRpc?.();
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
};

function makeAdminClient(opts: AdminOpts): SupabaseClient<Database> {
  const uid = opts.invitedUserId === undefined ? 'auth-user-1' : opts.invitedUserId;
  return {
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

/** Puerto de enlazado: por defecto OK. Espía para afirmar CON QUÉ se llamó. */
function makeLink(ok = true) {
  return vi.fn(async (_invitationId: string, _invitedUserId: string) => ({ ok }));
}

/**
 * Puerto de CORREO (Correo-B1). Por defecto manda bien. Es espía para poder afirmar
 * QUÉ enlace se manda y a quién: el enlace lleva el token, que es la credencial.
 */
function makeSendEmail(error: unknown = null) {
  return vi.fn(async (_args: { to: string; url: string; locale: string }) => ({
    error,
  }));
}

/**
 * Puerto de BÚSQUEDA del destinatario. Por defecto: no tiene cuenta (el caso normal
 * de un seguidor, que casi siempre es alguien de fuera).
 */
function makeLookup(
  found: { userId: string; invitePending: boolean; locale: string | null } | null = null,
) {
  return vi.fn(async (_email: string) => found);
}

const OK_INVITE = { id: 'inv-1', token: 'tok-1', email: 'abuelo@correo.com' };
const ARGS = {
  playerId: 'player-1',
  email: 'abuelo@correo.com',
  linkBase: 'https://misterfc.es/es/invite',
  locale: 'es',
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
  it('tutor + email nuevo → crea la cuenta, la enlaza y manda EL correo', async () => {
    const onCreate = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ onCreate });
    const link = makeLink();
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(user, admin, ARGS, link, sendEmail, makeLookup());

    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-user-1');
    // UN correo, el nuestro, con el enlace del token.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      to: ARGS.email,
      url: 'https://misterfc.es/es/invite/tok-1',
      locale: 'es',
    });
  });

  it('la cuenta se crea CONFIRMADA y con el invitation_id en el metadata', async () => {
    // Las dos cosas tienen dueño: `email_confirm` evita que GoTrue le niegue el login
    // al fijar la contraseña en /invite (BUG-4), y `invitation_id` es lo que exige
    // `handle_new_user` desde F14D para dejar nacer la cuenta.
    const onCreate = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ onCreate });

    await performSpectatorInvite(user, admin, ARGS, makeLink(), makeSendEmail(), makeLookup());

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: ARGS.email,
        email_confirm: true,
        user_metadata: expect.objectContaining({
          invitation_id: 'inv-1',
          invite_kind: 'seguidor',
        }),
      }),
    );
  });

  it('tutor + email YA usuario → mismo correo de invitación, sin crear ni enlazar', async () => {
    const onCreate = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ onCreate });
    const link = makeLink();
    const sendEmail = makeSendEmail();
    const lookup = makeLookup({ userId: 'auth-suya', invitePending: false, locale: null });

    const res = await performSpectatorInvite(user, admin, ARGS, link, sendEmail, lookup);

    expect(onCreate).not.toHaveBeenCalled(); // su cuenta no se toca

    expect(res).toEqual({ ok: { email: ARGS.email, existing: true } });
    // La cuenta es del propio invitado → invited_user_id NULL por diseño: NO se enlaza.
    expect(link).not.toHaveBeenCalled();
    // Y recibe EL MISMO correo que el que no tiene cuenta (Correo-B1: ya no hay
    // magic link). Mismo enlace, que es lo que le deja aceptar.
    expect(sendEmail).toHaveBeenCalledWith({
      to: ARGS.email,
      url: 'https://misterfc.es/es/invite/tok-1',
      locale: 'es',
    });
  });

  it('no-tutor → gate del RPC rechaza: ni cuenta ni correo', async () => {
    const onCreate = vi.fn();
    const user = makeUserClient({ rpcError: { message: 'forbidden' } });
    const admin = makeAdminClient({ onCreate });
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(user, admin, ARGS, makeLink(), sendEmail, makeLookup());

    expect(res).toEqual({ error: 'forbidden' });
    expect(onCreate).not.toHaveBeenCalled(); // service-role JAMÁS antes del gate
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('email inválido en el RPC → email_invalid, sin cuenta y sin correo', async () => {
    const onCreate = vi.fn();
    const user = makeUserClient({ rpcError: { message: 'invalid_email' } });
    const admin = makeAdminClient({ onCreate });
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(user, admin, ARGS, makeLink(), sendEmail, makeLookup());

    expect(res).toEqual({ error: 'email_invalid' });
    expect(onCreate).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('crear la cuenta falla por otra cosa → generic, y NO se manda correo', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ createError: { message: 'gotrue down' } });
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      makeLink(),
      sendEmail,
      makeLookup(),
      log,
    );

    expect(res).toEqual({ error: 'generic' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'createUser_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('el correo falla → generic y queda el rastro (la cuenta ya existe: se reintenta)', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      makeLink(),
      makeSendEmail({ message: 'resend 422' }),
      makeLookup(),
      log,
    );

    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'send_invite_email_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('si el puerto de correo LANZA, tampoco se escapa la excepción', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});
    const sendEmail = vi.fn(async () => {
      throw new Error('fetch abortado');
    });

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      makeLink(),
      sendEmail,
      makeLookup(),
      log,
    );

    expect(res).toEqual({ error: 'generic' });
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'send_invite_email_spectator_thrown',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('REENVÍO a quien nunca reclamó: no crea otra cuenta, ENLAZA la suya', async () => {
    // El agujero que abre dejar de usar inviteUserByEmail. GoTrue reinvitaba a una
    // cuenta sin reclamar y devolvía su id, así que el sender la enlazaba;
    // `createUser` solo dice "ya existe". Sin este camino, la invitación nueva se
    // queda sin `invited_user_id` y el invitado llega a /invite y se encuentra un
    // formulario pidiéndole una contraseña que nunca fijó: la trampa de agosto 2026.
    const onCreate = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ onCreate });
    const link = makeLink();
    const sendEmail = makeSendEmail();
    const lookup = makeLookup({
      userId: 'auth-sin-reclamar',
      invitePending: true,
      locale: null,
    });

    const res = await performSpectatorInvite(user, admin, ARGS, link, sendEmail, lookup);

    expect(onCreate).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-sin-reclamar');
    // Para él es su primera vez: no es una cuenta "existente".
    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('reenvío sin reclamar cuyo enlazado falla → generic, y el correo NO sale', async () => {
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});
    const sendEmail = makeSendEmail();
    const lookup = makeLookup({ userId: 'auth-x', invitePending: true, locale: null });

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      makeLink(false),
      sendEmail,
      lookup,
    );

    expect(res).toEqual({ error: 'generic' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('el idioma del DESTINATARIO manda sobre el de quien invita', async () => {
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});
    const sendEmail = makeSendEmail();
    const lookup = makeLookup({ userId: 'auth-suya', invitePending: false, locale: 'en' });

    await performSpectatorInvite(user, admin, ARGS, makeLink(), sendEmail, lookup);

    // Quien invita tiene la web en 'es'; el destinatario ya es de la casa y la tiene
    // en 'en'. Le escribimos en 'en'.
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it('si la BÚSQUEDA revienta, se sigue como si no tuviera cuenta (y queda rastro)', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});
    const sendEmail = makeSendEmail();
    const lookup = vi.fn(async () => {
      throw new Error('gotrue timeout');
    });

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      makeLink(),
      sendEmail,
      lookup,
      log,
    );

    // Camino normal: crear + enlazar + correo en el idioma de quien invita.
    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }));
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'lookup_recipient_spectator_thrown',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('carrera: la búsqueda dice que no hay cuenta y createUser dice que sí → existing + rastro', async () => {
    const log = vi.fn();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ createError: { code: 'email_exists' } });
    const link = makeLink();
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      link,
      sendEmail,
      makeLookup(),
      log,
    );

    // Lo conservador: no se enlaza nada ajeno, pero el correo sale igual.
    expect(res).toEqual({ ok: { email: ARGS.email, existing: true } });
    expect(link).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'createUser_spectator_race',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('el idioma de quien invita viaja al puerto (lo necesita si el invitado no tiene perfil)', async () => {
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});
    const sendEmail = makeSendEmail();

    await performSpectatorInvite(
      user,
      admin,
      { ...ARGS, locale: 'va', linkBase: 'https://misterfc.es/va/invite' },
      makeLink(),
      sendEmail,
      makeLookup(),
    );

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'va', url: 'https://misterfc.es/va/invite/tok-1' }),
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

    const res = await performSpectatorInvite(user, admin, ARGS, link, makeSendEmail(), makeLookup());

    expect(res).toEqual({ ok: { email: ARGS.email, existing: false } });
    expect(link).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledWith('inv-1', 'auth-abuelo');
  });

  it('cuenta creada sin user.id → generic + log ruidoso, sin enlazar y SIN correo', async () => {
    const log = vi.fn();
    const link = makeLink();
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({ invitedUserId: null });
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(
      user,
      admin,
      ARGS,
      link,
      sendEmail,
      makeLookup(),
      log,
    );

    expect(res).toEqual({ error: 'generic' });
    expect(link).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.anything(),
      'invited_user_missing_id_spectator',
      expect.objectContaining({ invitation_id: 'inv-1' }),
    );
  });

  it('enlazado que falla (≠1 fila) → generic, y el correo NO sale', async () => {
    const link = makeLink(false);
    const user = makeUserClient({ rpcData: OK_INVITE });
    const admin = makeAdminClient({});
    const sendEmail = makeSendEmail();

    const res = await performSpectatorInvite(user, admin, ARGS, link, sendEmail, makeLookup());

    // El puerto ya ha reportado por su cuenta (linkInvitedUser → Sentry): aquí solo
    // se corta. Y esto es lo que cambia con Correo-B1: el correo iba ANTES y salía
    // igual, así que el invitado recibía un enlace a una invitación sin enlazar —la
    // trampa de agosto de 2026—. Ahora el correo va el último y no llega a salir.
    expect(res).toEqual({ error: 'generic' });
    expect(link).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
