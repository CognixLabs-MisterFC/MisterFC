/**
 * F14K-1 — Agrupado por email de los jugadores "pendientes de invitar".
 *
 * La parte con lógica (y la que Jose remarcó) es el CONTEO POR EMAIL: el límite de
 * 100/h de K-2 se mide en EMAILS distintos, no en jugadores. Hermanos con el mismo
 * `invite_email` = 1 email. Esta pieza es pura (sin BD) para poder testearla sola;
 * la query que aplica el criterio vive en el `queries.ts` de jugadores.
 */

export type PendingInviteCandidate = {
  player_id: string;
  first_name: string;
  last_name: string;
  invite_email: string;
};

export type PendingInviteEmailGroup = {
  /** Email tal cual (trim) del primer jugador visto con esa dirección. */
  email: string;
  /** Jugadores que comparten ese email (hermanos → varios). */
  player_ids: string[];
};

export type PendingInviteSummary = {
  players: PendingInviteCandidate[];
  /** Nº de jugadores pendientes. */
  count_players: number;
  /** Nº de EMAILS distintos (case-insensitive) — la medida del tope de 100 de K-2. */
  count_emails: number;
  /** Emails distintos con sus jugadores (para que K-2 envíe UN email por grupo). */
  emails: PendingInviteEmailGroup[];
};

/**
 * Resume la lista de candidatos agrupando por email (case-insensitive + trim).
 * Preserva el orden de aparición tanto de emails como de jugadores dentro de cada
 * email. No filtra nada: recibe ya la lista que cumple el criterio de pendiente.
 */
export function summarizePendingInvites(
  players: PendingInviteCandidate[],
): PendingInviteSummary {
  const byEmail = new Map<string, PendingInviteEmailGroup>();
  for (const p of players) {
    const key = p.invite_email.trim().toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.player_ids.push(p.player_id);
    } else {
      byEmail.set(key, {
        email: p.invite_email.trim(),
        player_ids: [p.player_id],
      });
    }
  }
  const emails = [...byEmail.values()];
  return {
    players,
    count_players: players.length,
    count_emails: emails.length,
    emails,
  };
}
