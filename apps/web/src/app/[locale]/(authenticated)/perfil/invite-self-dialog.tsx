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
import { inviteSelfForPlayer, type InviteSelfState } from '../jugadores/actions';

type Props = {
  locale: string;
  playerId: string;
  playerName: string;
};

/**
 * MN-5 — Dialog "Dar acceso al jugador". Mismo patrón que InviteSpectatorDialog
 * (form en subcomponente montado solo con open=true → reset limpio) y, como aquel,
 * SIN selector de relación: el formulario manda únicamente el email y la RPC
 * escribe `player_relation='self'`. Que la relación no viaje desde el cliente es
 * justamente lo que impide que esta pantalla sea otra puerta al agujero de
 * `invite_email`.
 */
export function InviteSelfDialog({ locale, playerId, playerName }: Props) {
  const t = useTranslations('invite_self');
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { player: playerName })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <InviteSelfForm
            locale={locale}
            playerId={playerId}
            onClose={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteSelfForm({
  locale,
  playerId,
  onClose,
}: {
  locale: string;
  playerId: string;
  onClose: () => void;
}) {
  const t = useTranslations('invite_self');

  const action = inviteSelfForPlayer.bind(null, locale, playerId);
  const [state, formAction, pending] = useActionState<InviteSelfState, FormData>(
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
        <Label htmlFor="self-email">{t('field.email')}</Label>
        <Input
          id="self-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoFocus
        />
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
