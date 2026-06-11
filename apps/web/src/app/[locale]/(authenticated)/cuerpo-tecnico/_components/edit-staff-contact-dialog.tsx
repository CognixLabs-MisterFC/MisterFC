'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil } from 'lucide-react';
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
import { updateStaffContact, type UpdateStaffContactState } from '../actions';

type Props = {
  /** Profile del entrenador a editar (target de la función SECURITY DEFINER). */
  targetProfileId: string;
  currentPhone: string | null;
  currentContactEmail: string | null;
};

/**
 * Bug 2 · 2c — el admin edita el contacto (teléfono / email de contacto) de un
 * entrenador, gestionado por el club. NO es el email de login. Solo se renderiza
 * para admin_club y nunca para uno mismo (lo decide la page).
 */
export function EditStaffContactDialog({
  targetProfileId,
  currentPhone,
  currentContactEmail,
}: Props) {
  const t = useTranslations('cuerpo_tecnico.edit_contact');
  const [open, setOpen] = useState(false);

  const action = updateStaffContact.bind(null, targetProfileId);
  const [state, formAction, pending] = useActionState<
    UpdateStaffContactState,
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
          <Pencil className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-phone">{t('field.phone')}</Label>
            <input
              id="staff-phone"
              name="phone"
              type="tel"
              maxLength={32}
              defaultValue={currentPhone ?? ''}
              autoComplete="off"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="staff-contact-email">{t('field.contact_email')}</Label>
            <input
              id="staff-contact-email"
              name="contact_email"
              type="email"
              maxLength={254}
              defaultValue={currentContactEmail ?? ''}
              autoComplete="off"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('field.contact_email_hint')}</p>
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
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('save')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
