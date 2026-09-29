import 'server-only';

/**
 * Identificador de un correo SEGURO PARA LOGS: no la dirección completa.
 *
 *   "alice@example.com" → "al***@e***.com"
 *
 * W-6 — vive en un solo sitio. Estaba copiada cuatro veces en `apps/web` (la Server
 * Action de invitar, la de aceptar y las dos de plataforma), todas con el mismo cuerpo.
 * Cuatro copias de una función que existe para no filtrar PII es cuatro veces la
 * oportunidad de que una se equivoque y nadie lo note: un log no falla, solo dice más
 * de lo que debía.
 *
 * V-3 — las dos de `lib/platform/*` (los flujos de superadmin) ya importan esta. Nota
 * de paso: eran las dos que tipaban `email: string` y NO toleraban nulo, así que al
 * unificarlas una cadena vacía pasa de 'invalid' a 'none'; las dos son etiquetas de
 * log, ninguna es el correo.
 *
 * QUEDA UNA, en `app/[locale]/invite/[token]/actions.ts`: la de ACEPTAR invitación,
 * hoy idéntica byte a byte a esta. El comentario anterior decía que solo quedaban las
 * de plataforma y no era cierto. Unificarla es trabajo aparte.
 *
 * Tolera null/undefined: hay sitios donde el correo de la fila puede no estar, y ahí
 * «none» es más útil que reventar el log.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'none';
  const [user, domain] = email.split('@');
  if (!user || !domain) return 'invalid';
  const [domainName, ...tld] = domain.split('.');
  return `${user.slice(0, 2)}***@${(domainName ?? '').slice(0, 1)}***${tld.length ? '.' + tld.join('.') : ''}`;
}
