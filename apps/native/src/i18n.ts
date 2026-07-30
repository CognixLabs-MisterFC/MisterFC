/**
 * i18n mínimo de apps/native (PR-1).
 *
 * apps/web usa next-intl (runtime de Next). Aquí, en RN, no hay ese runtime, así
 * que montamos un `t()` propio y autocontenido con los pocos textos de login/home.
 * Idioma detectado del dispositivo vía `Intl` (Hermes trae Intl), sin dep nativa.
 * Locales: es (default), en, va. PR-2 ampliará según haga falta.
 */

type Locale = 'es' | 'en' | 'va';

function detectLocale(): Locale {
  try {
    const raw = (
      Intl.DateTimeFormat().resolvedOptions().locale || 'es'
    ).toLowerCase();
    if (raw.startsWith('en')) return 'en';
    // El dispositivo reporta valenciano como 'ca'/'ca-ES-valencia' o 'va'.
    if (raw.startsWith('va') || raw.startsWith('ca')) return 'va';
    return 'es';
  } catch {
    return 'es';
  }
}

const MESSAGES: Record<Locale, Record<string, string>> = {
  es: {
    'login.title': 'MisterFC',
    'login.subtitle': 'Entra con tu cuenta',
    'login.email': 'Correo electrónico',
    'login.password': 'Contraseña',
    'login.submit': 'Entrar',
    'login.submitting': 'Entrando…',
    'login.error_invalid_input': 'Revisa el correo y la contraseña.',
    'login.error_invalid_credentials': 'Correo o contraseña incorrectos.',
    'login.error_email_not_confirmed': 'Confirma tu correo antes de entrar.',
    'login.error_generic': 'No se pudo entrar. Inténtalo de nuevo.',
    'home.greeting': 'Hola, {name}',
    'home.active_club': 'Club activo',
    'home.color_label': 'Color del club',
    'home.no_color': 'Sin color (neutro por defecto)',
    'home.switch_club': 'Cambiar de club',
    'home.sign_out': 'Cerrar sesión',
    'home.loading': 'Cargando…',
    'home.spectator_title': 'Seguidor',
    'home.spectator_body': 'Tu espacio de seguidor llega en la próxima entrega.',
    'home.no_access_title': 'Sin acceso',
    'home.no_access_body': 'Tu cuenta no pertenece a ningún club todavía.',
  },
  en: {
    'login.title': 'MisterFC',
    'login.subtitle': 'Sign in to your account',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.submitting': 'Signing in…',
    'login.error_invalid_input': 'Check your email and password.',
    'login.error_invalid_credentials': 'Wrong email or password.',
    'login.error_email_not_confirmed': 'Confirm your email before signing in.',
    'login.error_generic': "Couldn't sign in. Please try again.",
    'home.greeting': 'Hi, {name}',
    'home.active_club': 'Active club',
    'home.color_label': 'Club color',
    'home.no_color': 'No color (neutral default)',
    'home.switch_club': 'Switch club',
    'home.sign_out': 'Sign out',
    'home.loading': 'Loading…',
    'home.spectator_title': 'Follower',
    'home.spectator_body': 'Your follower space is coming in the next release.',
    'home.no_access_title': 'No access',
    'home.no_access_body': "Your account doesn't belong to any club yet.",
  },
  va: {
    'login.title': 'MisterFC',
    'login.subtitle': 'Entra amb el teu compte',
    'login.email': 'Correu electrònic',
    'login.password': 'Contrasenya',
    'login.submit': 'Entrar',
    'login.submitting': 'Entrant…',
    'login.error_invalid_input': 'Revisa el correu i la contrasenya.',
    'login.error_invalid_credentials': 'Correu o contrasenya incorrectes.',
    'login.error_email_not_confirmed': 'Confirma el teu correu abans d’entrar.',
    'login.error_generic': 'No s’ha pogut entrar. Torna-ho a provar.',
    'home.greeting': 'Hola, {name}',
    'home.active_club': 'Club actiu',
    'home.color_label': 'Color del club',
    'home.no_color': 'Sense color (neutre per defecte)',
    'home.switch_club': 'Canviar de club',
    'home.sign_out': 'Tancar sessió',
    'home.loading': 'Carregant…',
    'home.spectator_title': 'Seguidor',
    'home.spectator_body': 'El teu espai de seguidor arriba en la pròxima entrega.',
    'home.no_access_title': 'Sense accés',
    'home.no_access_body': 'El teu compte encara no pertany a cap club.',
  },
};

const LOCALE: Locale = detectLocale();

export function t(key: string, vars?: Record<string, string>): string {
  let msg = MESSAGES[LOCALE][key] ?? MESSAGES.es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(`{${k}}`, v);
    }
  }
  return msg;
}
