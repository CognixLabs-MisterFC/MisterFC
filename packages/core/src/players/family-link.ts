/**
 * F14 — Estado del vínculo con la FAMILIA de un jugador (Slice A).
 *
 * Deriva de dos hechos que los loaders ya tienen a mano, SIN columna nueva:
 *  - `player_accounts` del jugador → una familia COMPLETÓ el alta.
 *  - invitación pendiente VIGENTE → correo enviado, sin aceptar y sin expirar.
 *
 * Tres estados:
 *  - `linked`    → hay familia vinculada. Recibe convocatorias y avisos.
 *  - `invited`   → sin familia, pero hay invitación pendiente (se envió, no entró).
 *  - `uninvited` → sin familia y sin invitación (nunca se le mandó).
 *
 * SOLO PRESENTACIÓN: nada gatea convocatoria/asistencia/estadísticas por esto.
 * Un jugador `invited`/`uninvited` se convoca, se le pasa lista y se le llevan
 * stats EXACTAMENTE igual que uno `linked`. Lo único cierto es que hoy NO recibe
 * convocatorias ni avisos (los fan-outs resuelven destinatarios vía
 * `player_accounts`); este estado solo lo hace visible. `invited` vs `uninvited`
 * le dice al club a quién le falta invitar.
 */
export type FamilyLinkStatus = 'linked' | 'invited' | 'uninvited';

/** ¿Alguna familia completó el alta? (basta con que exista alguna player_account). */
export function hasLinkedFamily(
  accounts: ReadonlyArray<unknown> | null | undefined,
): boolean {
  return (accounts?.length ?? 0) > 0;
}

/** Invitación VIGENTE = sin aceptar (`accepted_at` nulo) y sin expirar a `now`. */
export function hasPendingInvite(
  invites:
    | ReadonlyArray<{ accepted_at?: string | null; expires_at?: string | null }>
    | null
    | undefined,
  now: Date = new Date(),
): boolean {
  return (invites ?? []).some(
    (i) =>
      i.accepted_at == null &&
      (i.expires_at == null || new Date(i.expires_at) > now),
  );
}

/**
 * Deriva el estado de vínculo. `linked` manda sobre `invited`, e `invited` sobre
 * `uninvited`. Punto ÚNICO de la regla: web (plantilla/ficha) y nativo (dirección)
 * la llaman en vez de reimplementar `accounts.length > 0`.
 */
export function deriveFamilyLinkStatus(args: {
  accounts: ReadonlyArray<unknown> | null | undefined;
  invites:
    | ReadonlyArray<{ accepted_at?: string | null; expires_at?: string | null }>
    | null
    | undefined;
  now?: Date;
}): FamilyLinkStatus {
  if (hasLinkedFamily(args.accounts)) return 'linked';
  return hasPendingInvite(args.invites, args.now ?? new Date())
    ? 'invited'
    : 'uninvited';
}
