'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserCheck, UserMinus, UserX } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { placePlayersInUpcoming } from '../actions';
import { setPlayerLeftClub } from '../../jugadores/actions';
import type { MappingDestTeam } from './team-mapping-card';

export type PendingPlayer = {
  id: string;
  name: string;
  sourceTeam: string;
};

type Props = {
  players: PendingPlayer[];
  destTeams: MappingDestTeam[];
};

/**
 * Rework C · C11b — panel de jugadores PENDIENTES: activos en la temporada actual,
 * NO de baja y aún sin colocar en ningún equipo de la upcoming. Tres acciones por
 * jugador, reusando las acciones existentes:
 *   a) Dejar sin equipo → solo se quita de la lista (sin cambio de BD).
 *   b) Asignar a un equipo de la upcoming → place_players_in_upcoming (C7).
 *   c) Causa baja → set_player_left_club (C11a).
 * Tras b) o c) el jugador sale (ya colocado / de baja); se refresca el servidor.
 */
export function PendingPlayersPanel({ players, destTeams }: Props) {
  const t = useTranslations('equipos');
  // a) "dejar sin equipo" es local: no toca BD, solo lo oculta de la lista.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => players.filter((p) => !dismissed.has(p.id)),
    [players, dismissed],
  );

  const dismiss = (id: string) =>
    setDismissed((prev) => new Set(prev).add(id));

  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('reassign.pending.title')}
          <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">
            {visible.length}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('reassign.pending.subtitle')}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 p-3 pt-0">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('reassign.pending.empty')}
          </p>
        ) : (
          visible.map((p) => (
            <PendingItem
              key={p.id}
              player={p}
              destTeams={destTeams}
              onResolved={() => dismiss(p.id)}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PendingItem({
  player,
  destTeams,
  onResolved,
}: {
  player: PendingPlayer;
  destTeams: MappingDestTeam[];
  onResolved: () => void;
}) {
  const t = useTranslations('equipos');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [destId, setDestId] = useState<string>(destTeams[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assign = () => {
    if (destId === '') return;
    setError(null);
    startTransition(async () => {
      const res = await placePlayersInUpcoming(destId, [player.id]);
      if (res.ok) {
        onResolved();
        router.refresh();
      } else {
        setError(t(`reassign.error.${res.error ?? 'generic'}`));
      }
    });
  };

  const causeBaja = () => {
    setError(null);
    startTransition(async () => {
      const res = await setPlayerLeftClub(player.id, {
        reactivate: false,
        reason,
      });
      if (res.ok) {
        onResolved();
        router.refresh();
      } else {
        setError(t(`reassign.error.${res.error ?? 'generic'}`));
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{player.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {player.sourceTeam}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor={`pdest-${player.id}`}>
          {t('reassign.dest_label')}
        </label>
        <select
          id={`pdest-${player.id}`}
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          value={destId}
          onChange={(e) => setDestId(e.target.value)}
          disabled={pending}
        >
          {destTeams.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.categoryName}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          className="h-8"
          disabled={pending || destId === ''}
          onClick={assign}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <UserCheck className="size-3.5" aria-hidden />
          )}
          {t('reassign.pending.assign')}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          disabled={pending}
          onClick={onResolved}
        >
          <UserMinus className="size-3.5" aria-hidden />
          {t('reassign.pending.leave_no_team')}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
              disabled={pending}
            >
              <UserX className="size-3.5" aria-hidden />
              {t('reassign.pending.baja')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('reassign.pending.baja_title', { name: player.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('reassign.pending.baja_description')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`preason-${player.id}`}>
                {t('reassign.pending.reason_label')}
              </Label>
              <input
                id={`preason-${player.id}`}
                type="text"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('reassign.pending.reason_placeholder')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={pending}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                {t('reassign.pending.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  causeBaja();
                }}
                disabled={pending}
              >
                {t('reassign.pending.baja_confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
