'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, Check } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { placePlayersInUpcoming } from '../actions';

export type MappingPlayer = {
  id: string;
  name: string;
  alreadyPlaced: boolean;
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
 * Rework C · C7 — tarjeta de mapeo de un equipo de la temporada ACTIVA hacia un
 * equipo de la UPCOMING. El admin elige destino (puede ser de otra categoría) y
 * marca qué jugadores llevar. "Ejecutar" COLOCA a los marcados en el destino sin
 * cerrar su membresía de la activa (idempotente: los ya colocados se saltan).
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
  const [destId, setDestId] = useState<string>(
    defaultDestId ?? destTeams[0]?.id ?? '',
  );
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(players.filter((p) => !p.alreadyPlaced).map((p) => p.id)),
  );
  const [result, setResult] = useState<
    { placed: number } | { error: string } | null
  >(null);

  const checkedCount = checked.size;
  const canRun = destId !== '' && checkedCount > 0 && !pending;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChecked = useMemo(
    () => players.length > 0 && players.every((p) => checked.has(p.id)),
    [players, checked],
  );
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(players.map((p) => p.id)));

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
            <button
              type="button"
              onClick={toggleAll}
              className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
              disabled={pending}
            >
              {allChecked ? t('reassign.unselect_all') : t('reassign.select_all')}
            </button>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <label className="flex flex-1 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={pending}
                    />
                    <span>{p.name}</span>
                  </label>
                  {p.alreadyPlaced && (
                    <Badge
                      variant="outline"
                      className="gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                    >
                      <Check className="size-3" aria-hidden />
                      {t('reassign.already_placed')}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground" role="status">
            {result &&
              ('placed' in result
                ? t('reassign.placed_result', { count: result.placed })
                : t(`reassign.error.${result.error}`))}
          </div>
          <Button
            size="sm"
            disabled={!canRun}
            onClick={() => {
              setResult(null);
              const ids = [...checked];
              startTransition(async () => {
                const res = await placePlayersInUpcoming(destId, ids);
                if (res.ok) {
                  setResult({ placed: res.ok.placed });
                  router.refresh();
                } else {
                  setResult({ error: res.error ?? 'generic' });
                }
              });
            }}
          >
            {pending && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            {t('reassign.run', { count: checkedCount })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
