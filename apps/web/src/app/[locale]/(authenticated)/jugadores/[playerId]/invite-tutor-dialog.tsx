'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Mail } from 'lucide-react';
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
import {
  inviteTutorForPlayer,
  type InviteTutorState,
} from '../actions';

type Props = {
  locale: string;
  playerId: string;
  playerName: string;
};

export function InviteTutorDialog({ locale, playerId, playerName }: Props) {
  const t = useTranslations('jugadores.tutor');
  const [open, setOpen] = useState(false);

  const action = inviteTutorForPlayer.bind(null, locale, playerId);
  const [state, formAction, pending] = useActionState<InviteTutorState, FormData>(
    action,
    {}
  );

  const [lastHandled, setLastHandled] = useState(state);
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) {
      setSentTo(state.ok.email);
      // Reset el form al cerrar — dejamos el dialog abierto con confirmación.
    }
  }

  const errorMsg = state.error ? t(`errors.${state.error}`) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSentTo(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="size-4" aria-hidden />
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

        {sentTo ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {t('sent', { email: sentTo })}
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                {t('close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="it-email">{t('field.email')}</Label>
              <Input
                id="it-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="it-relation">{t('field.relation')}</Label>
              <Select name="relation" defaultValue="parent">
                <SelectTrigger id="it-relation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">
                    {t('relation.parent')}
                  </SelectItem>
                  <SelectItem value="guardian">
                    {t('relation.guardian')}
                  </SelectItem>
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                <span>{t('send')}</span>
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
