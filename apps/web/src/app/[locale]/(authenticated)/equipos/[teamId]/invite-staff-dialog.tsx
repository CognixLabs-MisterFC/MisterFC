'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Mail } from 'lucide-react';
import { TEAM_STAFF_ROLES } from '@misterfc/core';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { inviteStaffToTeam, type InviteStaffState } from './actions';

type Props = {
  locale: string;
  teamId: string;
};

/**
 * Dialog "Invitar staff" — F2.6 hotfix 2026-05-30: el formulario y su estado
 * (useActionState, sentTo, lastHandled) viven en un subcomponente que sólo se
 * monta cuando el dialog está abierto. Al cerrarlo, React desmonta el form y
 * todo su estado; al reabrirlo, arranca limpio (email vacío, role default,
 * sin mensaje de error de un intento previo).
 *
 * El bug previo: estos hooks vivían en el componente padre y persistían entre
 * opens — un coach que cerraba el dialog tras un error y lo reabría volvía a
 * ver el error y la confusión "enviando otra invitación distinta a la previa".
 */
export function InviteStaffDialog({ locale, teamId }: Props) {
  const t = useTranslations('staff.invite');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {open && (
          <InviteStaffForm
            locale={locale}
            teamId={teamId}
            onClose={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteStaffForm({
  locale,
  teamId,
  onClose,
}: {
  locale: string;
  teamId: string;
  onClose: () => void;
}) {
  const t = useTranslations('staff.invite');
  const tRoles = useTranslations('staff.role');

  const action = inviteStaffToTeam.bind(null, locale, teamId);
  const [state, formAction, pending] = useActionState<InviteStaffState, FormData>(
    action,
    {},
  );

  const [lastHandled, setLastHandled] = useState(state);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) setSentTo(state.ok.email);
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('sent', { email: sentTo })}</p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('close')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="is-email">{t('field.email')}</Label>
        <Input
          id="is-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="is-role">{t('field.role')}</Label>
        <Select name="team_staff_role" defaultValue="entrenador_ayudante">
          <SelectTrigger id="is-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEAM_STAFF_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {tRoles(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('field.help')}</p>
      </div>

      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          <span>{t('send')}</span>
        </Button>
      </DialogFooter>
    </form>
  );
}
