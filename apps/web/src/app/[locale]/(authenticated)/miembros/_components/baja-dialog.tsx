'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { setMembershipLeft, type MembershipLeftState } from '../actions';

/**
 * Diálogo de BAJA de un miembro. Pide la razón (nota INTERNA: se guarda pero NUNCA
 * se muestra al afectado). La autorización y las guardas las impone la RPC; aquí solo
 * se muestra el error que devuelva. La UI ya oculta el botón cuando no procede
 * (self/admin/director→director), pero la RPC es la autoridad.
 */
export function BajaDialog({
  targetProfileId,
  memberName,
}: {
  targetProfileId: string;
  memberName: string;
}) {
  const t = useTranslations('miembros.baja');
  const [open, setOpen] = useState(false);

  const action = setMembershipLeft.bind(null, targetProfileId);
  const [state, formAction, pending] = useActionState<
    MembershipLeftState,
    FormData
  >(action, {});

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.success) setOpen(false);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <UserMinus className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { name: memberName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="mode" value="baja" />

          <div className="flex flex-col gap-2">
            <Label htmlFor="baja-reason">{t('field.reason')}</Label>
            <Textarea
              id="baja-reason"
              name="reason"
              maxLength={500}
              rows={3}
              placeholder={t('field.reason_placeholder')}
            />
            <p className="text-xs text-muted-foreground">{t('field.reason_help')}</p>
          </div>

          {errorMsg && (
            <p className="text-sm text-destructive" role="alert">
              {errorMsg}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('confirm')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
