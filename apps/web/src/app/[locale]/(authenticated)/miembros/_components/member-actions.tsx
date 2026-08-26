'use client';

import { useTranslations } from 'next-intl';
import type { Role } from '@misterfc/core';
import { BajaDialog } from './baja-dialog';
import { ReactivarButton } from './reactivar-button';

function isHigh(role: Role): boolean {
  return role === 'admin_club' || role === 'director';
}

/**
 * Acción de una fila según viewer×target, ESPEJANDO las guardas de la RPC (para no
 * pintar botones inútiles; la RPC es la autoridad):
 *  - admin_club → nunca botón: nota de "traspasar antes la administración".
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
  const t = useTranslations('miembros');

  if (clubRole === 'admin_club') {
    return (
      <span className="text-xs text-muted-foreground">{t('row.admin_note')}</span>
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
