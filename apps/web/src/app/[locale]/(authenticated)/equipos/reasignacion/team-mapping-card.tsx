'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, Check, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { placePlayersInUpcoming, unplacePlayerFromUpcoming } from '../actions';

export type MappingPlayer = {
  id: string;
  name: string;
  /** Equipos de la upcoming donde el jugador ya está colocado (membresía abierta). */
  placedTeamIds: string[];
};

export type MappingDestTeam = {
  id: string;
  name: string;
  categoryName: string;
};

type Props = {
  sourceTeam: { id: string; name: string; categoryName: string };
  players: MappingPlayer[];
  destTeams: MappingDestTeam[];
  defaultDestId: string | null;
};

/**
 * Rework C · C7+C9 — tarjeta de mapeo de un equipo de la temporada ACTIVA hacia
 * un equipo de la UPCOMING. El admin elige destino (puede ser de otra categoría):
 * marca jugadores y "Colocar" los lleva al destino; los que ya están colocados en
 * ese destino muestran "Quitar" (C9, desasigna sin tocar la temporada activa).
 */
export function TeamMappingCard({
  sourceTeam,
  players,
  destTeams,
  defaultDestId,
}: Props) {
  const t = useTranslations('equipos');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [destId, setDestId] = useState<string>(
    defaultDestId ?? destTeams[0]?.id ?? '',
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<
    { kind: 'placed'; n: number } | { kind: 'removed' } | { error: string } | null
  >(null);

  // Jugadores aún no colocados en el destino seleccionado: candidatos a "colocar".
  const placeable = useMemo(
    () => players.filter((p) => !p.placedTeamIds.includes(destId)),
    [players, destId],
  );
  const effectiveChecked = useMemo(
    () => placeable.filter((p) => checked.has(p.id)).map((p) => p.id),
    [placeable, checked],
  );
  const canRun = destId !== '' && effectiveChecked.length > 0 && !pending;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChecked =
    placeable.length > 0 && placeable.every((p) => checked.has(p.id));
  const toggleAll = () =>
    setChecked(
      allChecked ? new Set() : new Set(placeable.map((p) => p.id)),
    );

  const place = () => {
    setResult(null);
    const ids = effectiveChecked;
    startTransition(async () => {
      const res = await placePlayersInUpcoming(destId, ids);
      if (res.ok) {
        setResult({ kind: 'placed', n: res.ok.placed });
        setChecked(new Set());
        router.refresh();
      } else {
        setResult({ error: res.error ?? 'generic' });
      }
    });
  };

  const unplace = (playerId: string) => {
    setResult(null);
    setBusyId(playerId);
    startTransition(async () => {
      const res = await unplacePlayerFromUpcoming(destId, playerId);
      setBusyId(null);
      if (res.ok) {
        setResult({ kind: 'removed' });
        router.refresh();
      } else {
        setResult({ error: res.error ?? 'generic' });
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{sourceTeam.name}</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {sourceTeam.categoryName}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor={`dest-${sourceTeam.id}`}>
            {t('reassign.dest_label')}
          </label>
          <select
            id={`dest-${sourceTeam.id}`}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={destId}
            onChange={(e) => {
              setDestId(e.target.value);
              setResult(null);
            }}
            disabled={pending}
          >
            {destTeams.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.categoryName}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {players.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('reassign.no_players')}
          </p>
        ) : (
          <>
            {placeable.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                disabled={pending}
              >
                {allChecked
                  ? t('reassign.unselect_all')
                  : t('reassign.select_all')}
              </button>
            )}
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {players.map((p) => {
                const placedHere = p.placedTeamIds.includes(destId);
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    {placedHere ? (
                      <>
                        <span className="flex flex-1 items-center gap-2 text-sm">
                          <Badge
                            variant="outline"
                            className="gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                          >
                            <Check className="size-3" aria-hidden />
                            {t('reassign.placed_here')}
                          </Badge>
                          {p.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-destructive hover:text-destructive"
                          disabled={pending}
                          onClick={() => unplace(p.id)}
                        >
                          {pending && busyId === p.id ? (
                            <Loader2 className="size-3 animate-spin" aria-hidden />
                          ) : (
                            <X className="size-3" aria-hidden />
                          )}
                          {t('reassign.remove')}
                        </Button>
                      </>
                    ) : (
                      <label className="flex flex-1 items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={checked.has(p.id)}
                          onChange={() => toggle(p.id)}
                          disabled={pending}
                        />
                        <span>{p.name}</span>
                        {p.placedTeamIds.length > 0 && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            {t('reassign.placed_elsewhere')}
                          </Badge>
                        )}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground" role="status">
            {result &&
              ('error' in result
                ? t(`reassign.error.${result.error}`)
                : result.kind === 'placed'
                  ? t('reassign.placed_result', { count: result.n })
                  : t('reassign.removed_result'))}
          </div>
          <Button size="sm" disabled={!canRun} onClick={place}>
            {pending && busyId === null && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            {t('reassign.run', { count: effectiveChecked.length })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
