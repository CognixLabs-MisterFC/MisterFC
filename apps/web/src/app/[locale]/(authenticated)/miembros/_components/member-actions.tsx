'use client';

import type { Role } from '@misterfc/core';
import { BajaDialog } from './baja-dialog';
import { ReactivarButton } from './reactivar-button';

function isHigh(role: Role): boolean {
  return role === 'admin_club' || role === 'director';
}

/**
 * Acción de una fila según viewer×target, ESPEJANDO las guardas de la RPC (para no
 * pintar botones inútiles; la RPC es la autoridad):
 *  - admin_club → nunca botón: se muestra el "—" neutro. La explicación ("traspasar
 *    antes la administración", `row.admin_note`) NO va aquí: vive como línea
 *    secundaria bajo el nombre del admin (evita que el nowrap de la celda de
 *    Acciones convierta la frase en una línea larguísima que desborda la tabla).
 *  - uno mismo, o un no-admin sobre un rol alto (director) → sin acción (—).
 *  - de baja → Reactivar; activo → Dar de baja.
 * Aplica igual a los tres segmentos.
 */
export function MemberActions({
  profileId,
  clubRole,
  leftAt,
  name,
  viewerRole,
  viewerProfileId,
}: {
  profileId: string;
  clubRole: Role;
  leftAt: string | null;
  name: string;
  viewerRole: Role;
  viewerProfileId: string;
}) {
  if (clubRole === 'admin_club') {
    // Sin botón para el admin (la RPC lo prohíbe). El "—" neutro, igual que las
    // demás filas sin acción; la nota explicativa se pinta bajo el nombre.
    return (
      <span className="text-xs text-muted-foreground" aria-hidden>
        —
      </span>
    );
  }

  const isSelf = profileId === viewerProfileId;
  const canAct =
    !isSelf && !(isHigh(clubRole) && viewerRole !== 'admin_club');

  if (!canAct) {
    return (
      <span className="text-xs text-muted-foreground" aria-hidden>
        —
      </span>
    );
  }

  return leftAt != null ? (
    <ReactivarButton targetProfileId={profileId} />
  ) : (
    <BajaDialog targetProfileId={profileId} memberName={name} />
  );
}
