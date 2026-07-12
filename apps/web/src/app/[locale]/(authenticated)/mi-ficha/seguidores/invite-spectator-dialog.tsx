'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, UserPlus } from 'lucide-react';
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
  inviteSpectatorForPlayer,
  type InviteSpectatorState,
} from '../../jugadores/actions';

type Props = {
  locale: string;
  playerId: string;
  playerName: string;
};

/**
 * F14C-5 — Dialog "Invitar seguidor". Mismo patrón que InviteTutorDialog (form
 * en subcomponente montado solo con open=true → reset limpio), pero SIN relación:
 * el seguidor solo se invita por email. Reusa la acción inviteSpectatorForPlayer.
 */
export function InviteSpectatorDialog({ locale, playerId, playerName }: Props) {
  const t = useTranslations('seguidores');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="size-4" aria-hidden />
          <span>{t('invite.action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('invite.title')}</DialogTitle>
          <DialogDescription>
            {t('invite.description', { player: playerName })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <InviteSpectatorForm
            locale={locale}
            playerId={playerId}
            onClose={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteSpectatorForm({
  locale,
  playerId,
  onClose,
}: {
  locale: string;
  playerId: string;
  onClose: () => void;
}) {
  const t = useTranslations('seguidores');

  const action = inviteSpectatorForPlayer.bind(null, locale, playerId);
  const [state, formAction, pending] = useActionState<
    InviteSpectatorState,
    FormData
  >(action, {});

  const [lastHandled, setLastHandled] = useState(state);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) setSentTo(state.ok.email);
  }

  const errorMsg = state.error ? t(`invite.errors.${state.error}`) : null;

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('invite.sent', { email: sentTo })}</p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('invite.close')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="is-email">{t('invite.field.email')}</Label>
        <Input
          id="is-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">{t('invite.field.help')}</p>
      </div>

      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('invite.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          <span>{t('invite.send')}</span>
        </Button>
      </DialogFooter>
    </form>
  );
}
