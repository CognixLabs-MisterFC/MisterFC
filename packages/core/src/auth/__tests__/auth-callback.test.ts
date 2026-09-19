import { describe, it, expect } from 'vitest';
import { planAuthCallback, safeNextPath, isAuthOtpType } from '../auth-callback';

const vacio = { code: null, tokenHash: null, type: null, error: null, next: null };

describe('safeNextPath', () => {
  it('acepta rutas relativas de este sitio', () => {
    expect(safeNextPath('/es/reset-password')).toBe('/es/reset-password');
    expect(safeNextPath('/es/invite/abc?x=1')).toBe('/es/invite/abc?x=1');
  });

  it('cae a la raíz con destinos ajenos o vacíos', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath('//evil.com/robo')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('es/reset-password')).toBe('/');
  });
});

describe('isAuthOtpType', () => {
  it('reconoce los tipos de GoTrue y rechaza el resto', () => {
    expect(isAuthOtpType('recovery')).toBe(true);
    expect(isAuthOtpType('invite')).toBe(true);
    expect(isAuthOtpType('inventado')).toBe(false);
    expect(isAuthOtpType(null)).toBe(false);
  });
});

describe('planAuthCallback', () => {
  it('PKCE: con `code` hay que canjear, y al destino pedido', () => {
    const plan = planAuthCallback({ ...vacio, code: 'abc', next: '/es/reset-password' });
    expect(plan).toEqual({
      kind: 'exchange_code',
      code: 'abc',
      destination: '/es/reset-password',
    });
  });

  it('OTP: con `token_hash` + `type` válido hay que verificar', () => {
    const plan = planAuthCallback({
      ...vacio,
      tokenHash: 'hhh',
      type: 'recovery',
      next: '/es/reset-password',
    });
    expect(plan).toEqual({
      kind: 'verify_otp',
      tokenHash: 'hhh',
      otpType: 'recovery',
      destination: '/es/reset-password',
    });
  });

  it('un `type` que no es de GoTrue no cuenta como artefacto', () => {
    const plan = planAuthCallback({
      ...vacio,
      tokenHash: 'hhh',
      type: 'inventado',
      next: '/es/reset-password',
    });
    expect(plan.kind).toBe('passthrough');
  });

  // EL BUG-4. Sin artefactos en la query la sesión puede venir en el FRAGMENTO,
  // que el servidor no ve. Antes esto mandaba a signin y tiraba el destino, y el
  // usuario acababa dentro de la app sin que le pidieran contraseña nueva.
  it('flujo implícito: sin artefactos pero con destino, deja pasar', () => {
    const plan = planAuthCallback({ ...vacio, next: '/es/reset-password' });
    expect(plan).toEqual({ kind: 'passthrough', destination: '/es/reset-password' });
  });

  it('dejar pasar NUNCA manda fuera del sitio', () => {
    expect(planAuthCallback({ ...vacio, next: '//evil.com' }).kind).toBe('fail');
    expect(planAuthCallback({ ...vacio, next: 'https://evil.com' }).kind).toBe('fail');
  });

  it('sin artefactos y sin destino, el enlace está roto', () => {
    expect(planAuthCallback(vacio)).toEqual({ kind: 'fail', reason: 'sin_artefactos' });
    expect(planAuthCallback({ ...vacio, next: '/' })).toEqual({
      kind: 'fail',
      reason: 'sin_artefactos',
    });
  });

  it('un error explícito de Supabase manda a signin aunque venga `code`', () => {
    const plan = planAuthCallback({
      ...vacio,
      code: 'abc',
      error: 'access_denied',
      next: '/es/reset-password',
    });
    expect(plan).toEqual({ kind: 'fail', reason: 'error_param' });
  });
});
