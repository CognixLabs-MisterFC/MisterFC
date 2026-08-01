import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  performSpectatorInvite as corePerformSpectatorInvite,
  type Database,
  type SpectatorInviteResult,
} from '@misterfc/core';

export type { SpectatorInviteResult };

/**
 * O2-5 F2 — Wrapper web de la orquestación "invitar seguidor" (core). Único punto
 * que inyecta el logger de Sentry (core no depende de Sentry). Lo usan tanto la
 * Server Action web (cookie) como el route handler nativo (bearer): misma lógica,
 * mismo logging. La orquestación se extrajo SIN cambiar el comportamiento web.
 */
export function performSpectatorInvite(
  userSupabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  args: { playerId: string; email: string; linkBase: string },
): Promise<SpectatorInviteResult> {
  return corePerformSpectatorInvite(userSupabase, admin, args, (error, step, extra) =>
    Sentry.captureException(error, {
      tags: { feature: 'invitations', step },
      extra,
    }),
  );
}
