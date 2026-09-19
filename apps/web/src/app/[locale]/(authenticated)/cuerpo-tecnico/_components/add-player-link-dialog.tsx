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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { addPlayerLink, type AddPlayerLinkState } from '../actions';

type PlayerOption = { id: string; full_name: string };

/**
 * "Agregar jugador" (BUG 3 · B-1) — vincula un hijo o tutelado a un miembro del
 * club sin mandarle una invitación por correo a alguien que ya está dentro.
 *
 * Se vincula de uno en uno; para varios hijos, se repite. La tarjeta de al lado
 * va listando los que ya están, así que se ve lo que llevas.
 *
 * Solo `parent` y `guardian`: 'self' es la cuenta del PROPIO jugador, otra cosa
 * y otro camino.
 */
export function AddPlayerLinkDialog({
  membershipId,
  players,
}: {
  membershipId: string;
  players: PlayerOption[];
}) {
  const t = useTranslations('cuerpo_tecnico.players.add');
  const tRel = useTranslations('cuerpo_tecnico.players.relation');
  const [open, setOpen] = useState(false);

  const action = addPlayerLink.bind(null, membershipId);
  const [state, formAction, pending] = useActionState<AddPlayerLinkState, FormData>(
    action,
    {}
  );

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
          <UserPlus className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {players.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="apl-player">{t('field.player')}</Label>
              <Select name="player_id" required>
                <SelectTrigger id="apl-player">
                  <SelectValue placeholder={t('field.player_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {players.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="apl-relation">{t('field.relation')}</Label>
              <Select name="relation" defaultValue="parent">
                <SelectTrigger id="apl-relation">
                  <SelectValue placeholder={t('field.relation_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">{tRel('parent')}</SelectItem>
                  <SelectItem value="guardian">{tRel('guardian')}</SelectItem>
                </SelectContent>
              </Select>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
