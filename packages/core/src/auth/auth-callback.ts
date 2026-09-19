/**
 * QUÉ HACER EN `/auth/callback`, como decisión pura y testeable.
 *
 * La ruta es un Route Handler, así que solo ve la QUERY. Los flujos implícitos
 * de GoTrue devuelven los tokens en el FRAGMENTO, que el servidor no puede leer
 * (BUG-4) — de ahí `passthrough`: sin artefactos pero con destino, lo correcto
 * NO es dar el enlace por roto, sino dejar pasar y que el cliente
 * (`AuthHashHandler`) canjee el fragmento donde corresponda.
 */

export type AuthOtpType = 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'signup' | 'email';

const OTP_TYPES: ReadonlySet<string> = new Set<AuthOtpType>([
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'signup',
  'email',
]);

export function isAuthOtpType(value: string | null): value is AuthOtpType {
  return value !== null && OTP_TYPES.has(value);
}

/**
 * `next` solo se acepta como ruta relativa de este mismo sitio. Cualquier otra
 * cosa (absoluta, protocol-relative `//host`, vacía) cae a la raíz.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return '/';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export type AuthCallbackInput = {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  error: string | null;
  next: string | null;
};

export type AuthCallbackPlan =
  /** PKCE: hay que canjear el `code` por sesión. */
  | { kind: 'exchange_code'; code: string; destination: string }
  /** OTP: hay que verificar el `token_hash`. */
  | { kind: 'verify_otp'; tokenHash: string; otpType: AuthOtpType; destination: string }
  /** Flujo implícito: la sesión viene en el fragmento. Solo redirigir. */
  | { kind: 'passthrough'; destination: string }
  /** Ni artefactos ni destino, o Supabase mandó un error explícito. */
  | { kind: 'fail'; reason: 'error_param' | 'sin_artefactos' };

export function planAuthCallback(input: AuthCallbackInput): AuthCallbackPlan {
  const destination = safeNextPath(input.next);

  if (input.error) return { kind: 'fail', reason: 'error_param' };

  if (input.code !== null) {
    return { kind: 'exchange_code', code: input.code, destination };
  }

  if (input.tokenHash !== null && isAuthOtpType(input.type)) {
    return { kind: 'verify_otp', tokenHash: input.tokenHash, otpType: input.type, destination };
  }

  // Sin artefactos en la query. Si hay un destino propio al que ir, puede que la
  // sesión venga en el fragmento: dejamos pasar. Si ni eso hay, el enlace está
  // roto de verdad y no tenemos a dónde mandar a nadie.
  if (destination === '/') return { kind: 'fail', reason: 'sin_artefactos' };
  return { kind: 'passthrough', destination };
}
