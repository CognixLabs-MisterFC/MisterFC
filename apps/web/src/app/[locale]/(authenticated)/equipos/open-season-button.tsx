'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { openNextSeason } from './actions';

/**
 * Rework C · C6 — botón "Abrir temporada {label}". Crea/reanuda la temporada
 * upcoming + clona los equipos de la activa (idempotente, server-side) y navega
 * a esa temporada para revisarla. Solo se muestra a admin_club cuando aún no hay
 * upcoming.
 */
export function OpenSeasonButton({ nextLabel }: { nextLabel: string }) {
  const t = useTranslations('equipos');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await openNextSeason();
            if (result.ok) {
              router.push(`/equipos?season=${result.ok.season}`);
            } else {
              setError(t(`open_season_error.${result.error ?? 'generic'}`));
            }
          });
        }}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <CalendarPlus className="size-4" aria-hidden />
        )}
        <span>{t('open_season', { season: nextLabel })}</span>
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
