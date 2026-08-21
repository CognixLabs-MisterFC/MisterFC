import * as Sentry from '@sentry/react-native';

/**
 * Reporta a Sentry un fallo de LECTURA de datos que antes se TRAGABA sin rastro:
 *  · los loaders de core que destructuran solo `{ data }` e ignoran `{ error }` de
 *    PostgREST (un fallo de RLS/Postgres se convertía en pantalla vacía silenciosa);
 *  · una excepción de la capa de caché (p. ej. secure-store) que dejaba una carga
 *    sin resolver.
 *
 * Mismo criterio que `reportPushFailure` (#464): señal técnica en producción, SIN
 * PII. NUNCA se manda user_id, email ni ids de menores — solo la OPERACIÓN (el token
 * de recurso, sin ids) y el mensaje/código técnico. El `op` debe ser un recurso
 * estable ('staff-teams', 'staff-roster', …), no una key con ids.
 */
export function reportDataError(op: string, error: unknown): void {
  // PostgrestError no es `Error`: preserva su `message`/`code` sin volcar el objeto.
  const pg =
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown; code?: unknown; details?: unknown })
      : null;
  const err =
    error instanceof Error
      ? error
      : new Error(pg?.message != null ? String(pg.message) : String(error ?? 'unknown_data_error'));

  Sentry.withScope((scope) => {
    scope.setTag('data_op', op);
    if (pg?.code != null) scope.setTag('pg_code', String(pg.code));
    scope.setContext('data', {
      op,
      code: pg?.code != null ? String(pg.code) : undefined,
      details: pg?.details != null ? String(pg.details) : undefined,
    });
    Sentry.captureException(err);
  });
}
