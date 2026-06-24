'use client';

/**
 * F13.10d — Control de PUBLICAR/DESPUBLICAR el informe individual con la familia
 * (visibility staff↔team). Al publicar, la server action notifica a la familia.
 * Solo staff (la ficha ya está bajo gate D13). Patrón action-en-transición.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Share2, EyeOff } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { setReportVisibility, type PublishState } from '../actions';

export function PublishToggle({
  reportId,
  playerId,
  period,
  locale,
  initialVisibility,
}: {
  reportId: string;
  playerId: string;
  period: string;
  locale: string;
  initialVisibility: string;
}) {
  const t = useTranslations('informes');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [visibility, setVisibility] = useState(initialVisibility);
  const [error, setError] = useState<PublishState['error'] | null>(null);

  const shared = visibility === 'team';
  const target = shared ? 'staff' : 'team';

  const onClick = () => {
    const fd = new FormData();
    fd.set('id', reportId);
    fd.set('player_id', playerId);
    fd.set('period', period);
    fd.set('locale', locale);
    fd.set('visibility', target);
    setError(null);
    start(async () => {
      const res = await setReportVisibility({}, fd);
      if (res.error) setError(res.error);
      else {
        setVisibility(res.visibility ?? target);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span
          className={
            shared
              ? 'rounded-full bg-misterfc-green/15 px-2 py-0.5 text-xs font-medium text-misterfc-green'
              : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {shared ? t('shared') : t('draft')}
        </span>
        <Button
          type="button"
          size="sm"
          variant={shared ? 'outline' : 'default'}
          onClick={onClick}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : shared ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Share2 className="size-4" aria-hidden />
          )}
          {shared ? t('unpublish') : t('publish')}
        </Button>
      </div>
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {t(`errors.${error}`)}
        </span>
      ) : null}
    </div>
  );
}
