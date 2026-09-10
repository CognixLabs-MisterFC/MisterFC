'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cancelAccountDeletion } from '@/app/[locale]/(authenticated)/perfil/account-deletion-actions';

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha límite como DD/MM/AAAA, igual que el resto de fechas del dead-end. */
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * BC-4 — pantalla terminal del borrado EN CURSO, dentro del dead-end de /onboarding
 * (quien pide el borrado se queda sin club activo y cae aquí solo).
 *
 * Enseña la fecha límite y cuántas supresiones de menor faltan por decidir, y deja
 * CANCELAR en cualquier momento hasta que el job remate el borrado (decisión de Jose:
 * sin ventana más corta). Por eso al pedir el borrado con bloqueantes NO se cierra la
 * sesión: sin ella, esta pantalla sería inalcanzable.
 */
export function AccountDeletionPending({
  deadlineAt,
  pendingPlayers,
}: {
  deadlineAt: string;
  pendingPlayers: number;
}) {
  const t = useTranslations('account_deletion');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelAccountDeletion();
      if (!res.ok) {
        setError(t(`errors.${res.error}`));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-left">
        <p className="text-sm font-semibold text-destructive">{t('pending_title')}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('pending_body', { date: formatDeadline(deadlineAt) })}
        </p>
        {pendingPlayers > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('pending_players', { count: pendingPlayers })}
          </p>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={onCancel} disabled={pending} className="w-fit">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        <span>{t('cancel_deletion')}</span>
      </Button>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
