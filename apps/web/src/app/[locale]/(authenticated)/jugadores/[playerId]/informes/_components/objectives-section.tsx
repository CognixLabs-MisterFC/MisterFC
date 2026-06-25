'use client';

/**
 * F13.10b-2 — Sección de objetivos (individuales o grupales): lista + alta. El
 * CRUD por fila vive en ObjectiveItem. Diseño sobrio a propósito (el rediseño del
 * informe es un paso aparte).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ObjectiveItem } from './objective-item';
import { ObjectiveForm } from './objective-form';
import type { ObjectiveRow } from '../queries';

export function ObjectivesSection({
  kind,
  items,
  playerId,
  teamId,
  seasonId,
  period,
}: {
  kind: 'player' | 'team';
  items: ObjectiveRow[];
  playerId: string;
  teamId: string;
  seasonId: string;
  /** Periodo del informe en edición (deriva el estado mostrado de cada objetivo). */
  period: string;
}) {
  const t = useTranslations('informes');
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {kind === 'player' ? t('objectives_individual') : t('objectives_team')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('no_objectives')}</p>
        ) : (
          items.map((it) => (
            <ObjectiveItem
              key={it.id}
              kind={kind}
              item={it}
              playerId={playerId}
              teamId={teamId}
              seasonId={seasonId}
              period={period}
            />
          ))
        )}

        {adding ? (
          <ObjectiveForm
            kind={kind}
            playerId={playerId}
            teamId={teamId}
            seasonId={seasonId}
            initial={null}
            onClose={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" aria-hidden />
            {t('add_objective')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
