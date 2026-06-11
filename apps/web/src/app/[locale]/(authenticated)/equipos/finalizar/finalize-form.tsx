'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { finalizeSeason } from '../actions';

type Props = {
  activeSeason: string;
  upcomingSeason: string;
  defaultCutoff: string;
  unplacedCount: number;
};

/**
 * Rework C · C8 — confirma la finalización del rollover. El admin ajusta la fecha
 * de corte (default = límite de temporada) y confirma; ejecuta `finalizeSeason`
 * (atómico) y, al terminar, navega a /equipos con la nueva temporada activa.
 */
export function FinalizeForm({
  activeSeason,
  upcomingSeason,
  defaultCutoff,
  unplacedCount,
}: Props) {
  const t = useTranslations('equipos');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cutoff, setCutoff] = useState(defaultCutoff);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = cutoff !== '' && acknowledged && !pending;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cutoff">{t('finalize.cutoff_label')}</Label>
          <input
            id="cutoff"
            type="date"
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
            value={cutoff}
            onChange={(e) => {
              setCutoff(e.target.value);
              setError(null);
            }}
            disabled={pending}
          />
          <p className="text-xs text-muted-foreground">{t('finalize.cutoff_hint')}</p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={pending}
          />
          <span>
            {unplacedCount > 0
              ? t('finalize.ack_with_unplaced', {
                  active: activeSeason,
                  count: unplacedCount,
                })
              : t('finalize.ack', { active: activeSeason })}
          </span>
        </label>

        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <span />
          )}
          <Button
            disabled={!canRun}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await finalizeSeason(cutoff);
                if (res.ok) {
                  router.push(`/equipos?season=${res.ok.season}`);
                  router.refresh();
                } else {
                  setError(t(`finalize.error.${res.error ?? 'generic'}`));
                }
              });
            }}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            {t('finalize.confirm', { upcoming: upcomingSeason })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
