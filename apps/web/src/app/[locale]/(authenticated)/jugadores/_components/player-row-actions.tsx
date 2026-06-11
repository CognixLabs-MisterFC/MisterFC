'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { AssignTeamDialog } from './assign-team-dialog';
import { PlayerBajaButton } from './player-baja-button';

type Props = {
  playerId: string;
  playerName: string;
  hasActiveTeam: boolean;
  /** C11a: jugador dado de baja del club (muestra "Reactivar" en vez de "Baja"). */
  isLeftClub: boolean;
  /** Equipos disponibles para asignar (filtrados ya por permiso del usuario). */
  teams: Array<{ id: string; name: string }>;
  /** Si false, sólo se muestra "Abrir ficha". */
  canManage: boolean;
};

export function PlayerRowActions({
  playerId,
  playerName,
  hasActiveTeam,
  isLeftClub,
  teams,
  canManage,
}: Props) {
  const t = useTranslations('jugadores.row_actions');

  return (
    <div className="flex items-center justify-end gap-1">
      {canManage && !isLeftClub && (
        <AssignTeamDialog
          playerId={playerId}
          teams={teams}
          hasActiveAssignment={hasActiveTeam}
        />
      )}
      {canManage && (
        <PlayerBajaButton
          playerId={playerId}
          playerName={playerName}
          isLeftClub={isLeftClub}
        />
      )}
      <Button asChild variant="ghost" size="sm">
        <Link
          href={`/jugadores/${playerId}`}
          aria-label={t('open_card')}
          className="gap-1"
        >
          <ExternalLink className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t('open_card')}</span>
        </Link>
      </Button>
    </div>
  );
}
