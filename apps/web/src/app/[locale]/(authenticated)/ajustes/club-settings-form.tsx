'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Lock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { setEvaluationsVisibility } from './actions';

type Props = {
  /** Valor actual del flag (sin fila en club_settings = false). */
  initialVisible: boolean;
  /** Solo el admin del club puede cambiarlo (D10); el coord lo ve deshabilitado. */
  canEdit: boolean;
};

/**
 * F8.5 — Toggle de visibilidad de valoraciones de partido para jugador/familia.
 * Optimistic UI con revert si la action falla (la RLS rechaza al no-admin).
 */
export function ClubSettingsForm({ initialVisible, canEdit }: Props) {
  const t = useTranslations('ajustes');
  const [visible, setVisible] = useState(initialVisible);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onToggle(next: boolean) {
    const prev = visible;
    setVisible(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setEvaluationsVisibility({ visible: next });
      if (res.error) {
        setVisible(prev); // revert
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-medium">{t('evaluations_visibility.label')}</span>
          <p className="text-sm text-muted-foreground">
            {t('evaluations_visibility.description')}
          </p>
        </div>
        <Switch
          checked={visible}
          disabled={!canEdit || pending}
          onCheckedChange={onToggle}
          aria-label={t('evaluations_visibility.label')}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {t('evaluations_visibility.default_hint')}
      </p>

      {!canEdit && (
        <p className="inline-flex items-center gap-1 text-xs italic text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          {t('evaluations_visibility.read_only')}
        </p>
      )}

      <div className="flex h-4 items-center gap-1 text-xs">
        {pending && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden /> {t('saving')}
          </span>
        )}
        {saved && !pending && (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="size-3" aria-hidden /> {t('saved')}
          </span>
        )}
        {error && (
          <span className="text-red-600 dark:text-red-400">
            {t(`error.${error}`)}
          </span>
        )}
      </div>
    </div>
  );
}
