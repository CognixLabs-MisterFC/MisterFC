'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setMembershipLeft, type MembershipLeftState } from '../actions';

/**
 * Reactivar una membership de baja. Reutiliza la MISMA server action que la baja
 * (mode 'reactivar' → left_at NULL, limpia la razón). Sin diálogo: acción de bajo
 * riesgo. La RPC sigue siendo la autoridad; su error se muestra bajo el botón.
 */
export function ReactivarButton({ targetProfileId }: { targetProfileId: string }) {
  const t = useTranslations('miembros.reactivar');
  const action = setMembershipLeft.bind(null, targetProfileId);
  const [state, formAction, pending] = useActionState<
    MembershipLeftState,
    FormData
  >(action, {});

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="mode" value="reactivar" />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="gap-2"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="size-4" aria-hidden />
        )}
        <span>{t('action')}</span>
      </Button>
      {errorMsg && (
        <span className="text-xs text-destructive" role="alert">
          {errorMsg}
        </span>
      )}
    </form>
  );
}
