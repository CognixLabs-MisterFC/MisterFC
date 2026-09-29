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
 * V-3 y V-4 — YA NO QUEDA NINGUNA COPIA. Esta es la única, y cualquier sitio nuevo
 * que enmascare un correo para un log tiene que importarla de aquí.
 *
 * Las dos de `lib/platform/*` (los flujos de superadmin) tipaban `email: string` y no
 * toleraban nulo, así que al unificarlas una cadena vacía pasó de 'invalid' a 'none';
 * las dos son etiquetas de log, ninguna es el correo. La de aceptar invitación era
 * idéntica byte a byte a esta.
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
