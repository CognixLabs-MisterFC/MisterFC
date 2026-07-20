'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserCog, AlertTriangle } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changeAdminAction, type ChangeAdminFormState } from './actions';

/**
 * Cambiar el admin del club (superadmin). Muestra el admin actual, pide el email
 * del nuevo, avisa de que el corte es INMEDIATO, y llama a `changeAdminAction`.
 * Al éxito refresca: el club pasa a "sin owner" con la invitación pendiente.
 */
export function ChangeAdminDialog({
  clubId,
  locale,
  currentAdminName,
}: {
  clubId: string;
  locale: string;
  currentAdminName: string;
}) {
  const t = useTranslations('platform');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [state, formAction, pending] = useActionState<ChangeAdminFormState, FormData>(
    changeAdminAction.bind(null, clubId, locale),
    {},
  );

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserCog className="size-4" aria-hidden />
          <span>{t('changeAdmin.trigger')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('changeAdmin.title')}</DialogTitle>
          <DialogDescription>
            {t('changeAdmin.description', { admin: currentAdminName })}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-admin-email">{t('changeAdmin.email_label')}</Label>
            <Input
              id="new-admin-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder={t('changeAdmin.email_placeholder')}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('changeAdmin.warning', { admin: currentAdminName })}</span>
          </div>

          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {t(`changeAdmin.error.${state.error}`)}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t('changeAdmin.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{pending ? t('changeAdmin.submitting') : t('changeAdmin.submit')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
