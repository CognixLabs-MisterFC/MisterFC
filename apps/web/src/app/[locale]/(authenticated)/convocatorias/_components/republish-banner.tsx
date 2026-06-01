'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { republishCallup } from '../actions';

/**
 * Bug G — banner "hay cambios sin publicar" sobre una convocatoria ya publicada.
 * El botón re-publica (callup_updated) y notifica a las familias afectadas.
 */
export function RepublishBanner({ eventId }: { eventId: string }) {
  const t = useTranslations('convocatorias.republish');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onPublish() {
    startTransition(async () => {
      const r = await republishCallup(eventId);
      if (r.success) {
        toast.success(t('done'));
        router.refresh();
        return;
      }
      if (r.error === 'too_many_called_up') {
        toast.error(t('too_many', { overflow: r.overflow ?? 0, max: r.maxCalledUp ?? 0 }));
      } else if (r.error === 'event_started') {
        toast.error(t('event_started'));
      } else {
        toast.error(t('error'));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {t('pending')}
      </span>
      <Button size="sm" onClick={onPublish} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('publish_changes')}
      </Button>
    </div>
  );
}
