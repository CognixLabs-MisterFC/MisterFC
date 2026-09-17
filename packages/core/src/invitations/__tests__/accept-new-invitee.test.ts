import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types';
import {
  acceptPendingInvitationsFromClient,
  claimInviteeAccount,
  mapAcceptRpcError,
} from '../accept-new-invitee';

/**
 * R-1 — la extracción del alta del invitado nuevo.
 *
 * Estas pruebas no existían antes de moverlo: el flujo vivía en una Server Action
 * y no había forma de ejecutarlo. Son la mitad de la red que R-0 no podía poner —
 * R-0 fijó el borde de ENTRADA (el schema) y pgTAP cubre el de SALIDA (la RPC);
 * esto es lo de en medio.
 *
 * Los errores se devuelven como `{ error }`, NUNCA lanzándolos: supabase-js no
 * rechaza la promesa, y un mock que lanza probaría un camino que en producción no
 * existe.
 */

type Llamada = { metodo: string; args: unknown };

function mockAdmin(cfg: { updateErrors?: ({ message: string } | null)[] }, llamadas: Llamada[]) {
  let i = 0;
  return {
    auth: {
      admin: {
        updateUserById: async (uid: string, payload: unknown) => {
          llamadas.push({ metodo: 'updateUserById', args: { uid, payload } });
          const err = cfg.updateErrors?.[i++] ?? null;
          return { data: null, error: err };
        },
      },
    },
  } as unknown as SupabaseClient<Database>;
}

function mockUser(
  cfg: {
    signIn?: { user?: { id: string } | null; error?: { message: string } | null };
    profileError?: { message: string; code?: string } | null;
    rpc?: { data?: unknown; error?: { message: string } | null };
  },
  llamadas: Llamada[],
) {
  return {
    auth: {
      signInWithPassword: async (args: unknown) => {
        llamadas.push({ metodo: 'signInWithPassword', args });
        // Ojo: `?? ` convertiria un `user: null` EXPLICITO en el valor por
        // defecto, y ese es justo el caso que hay que poder probar.
        const user = cfg.signIn && 'user' in cfg.signIn ? cfg.signIn.user : { id: 'u1' };
        return {
          data: { user, session: null },
          error: cfg.signIn?.error ?? null,
        };
      },
    },
    from: () => ({
      update: (patch: unknown) => ({
        eq: async (col: string, val: string) => {
          llamadas.push({ metodo: 'profiles.update', args: { patch, col, val } });
          return { error: cfg.profileError ?? null };
        },
      }),
    }),
    rpc: async (name: string, args: unknown) => {
      llamadas.push({ metodo: `rpc:${name}`, args });
      return { data: cfg.rpc?.data ?? null, error: cfg.rpc?.error ?? null };
    },
  } as unknown as SupabaseClient<Database>;
}

const PERFIL = {
  full_name: 'Ana Ruiz',
  phone: '600123456',
  date_of_birth: '2010-05-04',
  password: '12345678',
  confirm: '12345678',
};

describe('mapAcceptRpcError', () => {
  it('cada candado de la RPC tiene su nombre', () => {
    const tabla = {
      account_deletion_in_progress: 'account_deletion_in_progress',
      consent_required: 'consent_required',
      wrong_email: 'wrong_email',
      not_found: 'not_found',
      no_session: 'no_session',
      image_decision_required: 'image_decision_required',
      image_required: 'image_required',
      reserved_for_tutor: 'reserved_for_tutor',
    } as const;
    for (const [msg, esperado] of Object.entries(tabla)) {
      expect(mapAcceptRpcError(`ERROR: ${msg} (SQLSTATE P0001)`)).toBe(esperado);
    }
  });

  it('lo que no reconoce cae a generic, y null tambien', () => {
    expect(mapAcceptRpcError('deadlock detected')).toBe('generic');
    expect(mapAcceptRpcError(null)).toBe('generic');
    expect(mapAcceptRpcError(undefined)).toBe('generic');
    expect(mapAcceptRpcError('')).toBe('generic');
  });

  it('image_decision_required gana a image_required, que es substring del otro', () => {
    // El orden de las comprobaciones NO es cosmetico: 'image_required' aparece
    // dentro de 'image_decision_required'? No, pero ambos comparten prefijo y el
    // mensaje real puede traer los dos. Si se invirtiera el orden, la decision sin
    // responder se reportaria como foto que falta y el tutor miraria donde no es.
    expect(mapAcceptRpcError('image_decision_required')).toBe('image_decision_required');
  });
});

describe('acceptPendingInvitationsFromClient', () => {
  it('manda los siete parametros, y el vacio como {} no como null', () => {
    const ll: Llamada[] = [];
    const sb = mockUser({ rpc: { data: 3 } }, ll);
    return acceptPendingInvitationsFromClient(sb, {
      token: 'tok-1',
      accepts: { terms: true, privacy: true },
      audit: { ip: null, userAgent: null },
    }).then((r) => {
      expect(r).toEqual({ ok: { processed: 3 } });
      expect(ll[0]?.metodo).toBe('rpc:accept_pending_invitations');
      expect(ll[0]?.args).toEqual({
        p_clicked_token: 'tok-1',
        p_accept_terms: true,
        p_accept_privacy: true,
        // null -> undefined: asi la RPC aplica su DEFAULT en vez de escribir null
        // en la auditoria del consentimiento.
        p_ip: undefined,
        p_user_agent: undefined,
        p_children: {},
        p_medical: {},
      });
    });
  });

  it('pasa hijos y medica cuando el llamador los trae', async () => {
    const ll: Llamada[] = [];
    const sb = mockUser({ rpc: { data: 1 } }, ll);
    await acceptPendingInvitationsFromClient(sb, {
      token: 't',
      accepts: { terms: true, privacy: false },
      audit: { ip: '1.2.3.4', userAgent: 'UA' },
      children: { p1: { internal: true, social: false } },
      medical: { p1: { consent: true } },
    });
    const args = ll[0]?.args as Record<string, unknown>;
    expect(args.p_ip).toBe('1.2.3.4');
    expect(args.p_user_agent).toBe('UA');
    expect(args.p_children).toEqual({ p1: { internal: true, social: false } });
    expect(args.p_accept_privacy).toBe(false);
  });

  it('un error de la RPC sale mapeado y con el crudo para registrarlo', async () => {
    const sb = mockUser({ rpc: { error: { message: 'reserved_for_tutor' } } }, []);
    const r = await acceptPendingInvitationsFromClient(sb, {
      token: 't',
      accepts: { terms: true, privacy: true },
      audit: { ip: null, userAgent: null },
    });
    expect(r).toMatchObject({ error: 'reserved_for_tutor' });
    expect('raw' in r && r.raw).toBeTruthy();
  });

  it('sin filas procesadas devuelve 0, no null', async () => {
    const sb = mockUser({ rpc: { data: null } }, []);
    const r = await acceptPendingInvitationsFromClient(sb, {
      token: 't',
      accepts: { terms: true, privacy: true },
      audit: { ip: null, userAgent: null },
    });
    expect(r).toEqual({ ok: { processed: 0 } });
  });
});

describe('claimInviteeAccount', () => {
  it('fija contrasena, inicia sesion y escribe el perfil, en ese orden', async () => {
    const ll: Llamada[] = [];
    const r = await claimInviteeAccount(
      mockUser({}, ll),
      mockAdmin({}, ll),
      { targetUid: 'uid-1', email: 'a@b.test', locale: 'es', profile: PERFIL },
    );
    expect(r).toEqual({ ok: { userId: 'u1' } });
    expect(ll.map((c) => c.metodo)).toEqual([
      'updateUserById',
      'signInWithPassword',
      'profiles.update',
    ]);
  });

  it('apaga invite_pending en los DOS buckets', async () => {
    // GoTrue FUSIONA metadata, no reemplaza. El gate de la pantalla lee
    // user_metadata: si solo se apagara en app_metadata, un usuario ya configurado
    // volveria a la pantalla de poner contrasena al aceptar otra invitacion.
    const ll: Llamada[] = [];
    await claimInviteeAccount(mockUser({}, ll), mockAdmin({}, ll), {
      targetUid: 'uid-1',
      email: 'a@b.test',
      locale: 'es',
      profile: PERFIL,
    });
    const payload = (ll[0]?.args as { payload: Record<string, never> }).payload;
    expect(payload.user_metadata).toMatchObject({ invite_pending: false, locale: 'es' });
    expect(payload.app_metadata).toEqual({ invite_pending: false });
  });

  it('si la contrasena YA era esa, reintenta solo la metadata (doble envio)', async () => {
    const ll: Llamada[] = [];
    const r = await claimInviteeAccount(
      mockUser({}, ll),
      mockAdmin({ updateErrors: [{ message: 'New password should be different from the old password.' }] }, ll),
      { targetUid: 'uid-1', email: 'a@b.test', locale: 'es', profile: PERFIL },
    );
    expect(r).toEqual({ ok: { userId: 'u1' } });
    // Dos updateUserById: el que fallo y el de solo metadata.
    const updates = ll.filter((c) => c.metodo === 'updateUserById');
    expect(updates).toHaveLength(2);
    expect((updates[1]?.args as { payload: Record<string, unknown> }).payload).not.toHaveProperty(
      'password',
    );
  });

  it('un fallo REAL de contrasena no sigue adelante', async () => {
    const ll: Llamada[] = [];
    const r = await claimInviteeAccount(
      mockUser({}, ll),
      mockAdmin({ updateErrors: [{ message: 'algo se rompio' }] }, ll),
      { targetUid: 'uid-1', email: 'a@b.test', locale: 'es', profile: PERFIL },
    );
    expect(r).toEqual({ error: 'auth_update_failed' });
    expect(ll.some((c) => c.metodo === 'signInWithPassword')).toBe(false);
  });

  it('si no hay sesion tras el sign-in, para: no se escribe perfil', async () => {
    const ll: Llamada[] = [];
    const r = await claimInviteeAccount(
      mockUser({ signIn: { user: null } }, ll),
      mockAdmin({}, ll),
      { targetUid: 'uid-1', email: 'a@b.test', locale: 'es', profile: PERFIL },
    );
    expect(r).toEqual({ error: 'sign_in_failed' });
    expect(ll.some((c) => c.metodo === 'profiles.update')).toBe(false);
  });

  it('un fallo de perfil tiene codigo propio, no generico', async () => {
    const ll: Llamada[] = [];
    const r = await claimInviteeAccount(
      mockUser({ profileError: { message: 'rls', code: '42501' } }, ll),
      mockAdmin({}, ll),
      { targetUid: 'uid-1', email: 'a@b.test', locale: 'es', profile: PERFIL },
    );
    expect(r).toEqual({ error: 'profile_update_failed' });
  });

  it('CONFIRMA el correo al reclamar la cuenta', async () => {
    // BUG-4: la cuenta nace SIN confirmar (inviteUserByEmail) y quien la confirmaba era
    // el verify de Supabase, por el que el enlace dejo de pasar al cambiar la plantilla
    // a {{ .RedirectTo }} en BUG-3. Sin esto GoTrue rechaza el sign-in por contrasena y
    // el alta NO se puede completar nunca. Medido en produccion: 21 cuentas, 17 han
    // entrado, cero lo han hecho sin el correo confirmado.
    const ll: Llamada[] = [];
    await claimInviteeAccount(mockUser({}, ll), mockAdmin({}, ll), {
      targetUid: 'uid-1',
      email: 'a@b.test',
      locale: 'es',
      profile: PERFIL,
    });
    const payload = (ll[0]?.args as { payload: Record<string, unknown> }).payload;
    expect(payload.email_confirm).toBe(true);
  });

  it('el perfil se escribe sobre el id de la SESION, no sobre targetUid', async () => {
    // Son el mismo en la practica, pero el que manda es quien acaba de iniciar
    // sesion: escribir sobre otro id seria escribir en la ficha de otra persona.
    const ll: Llamada[] = [];
    await claimInviteeAccount(
      mockUser({ signIn: { user: { id: 'sesion-99' } } }, ll),
      mockAdmin({}, ll),
      { targetUid: 'uid-1', email: 'a@b.test', locale: 'es', profile: PERFIL },
    );
    const upd = ll.find((c) => c.metodo === 'profiles.update');
    expect((upd?.args as { val: string }).val).toBe('sesion-99');
    expect((upd?.args as { patch: Record<string, unknown> }).patch).toEqual({
      full_name: 'Ana Ruiz',
      phone: '600123456',
      date_of_birth: '2010-05-04',
      locale: 'es',
    });
  });
});
