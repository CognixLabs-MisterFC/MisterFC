'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { nameToSlug } from '@misterfc/core';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createClub, type CreateClubFormState } from '@/lib/platform/create-club';

/**
 * F14B-7 — Dialog "Crear club" (superadmin). Preview del slug EN VIVO con
 * nameToSlug (aproximado); la propuesta ÚNICA la calcula el server action al
 * enviar (platform_propose_slug). Al crear OK, cierra y refresca la lista.
 */
export function CreateClubDialog({ locale }: { locale: string }) {
  const t = useTranslations('platform');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const [state, formAction, pending] = useActionState<CreateClubFormState, FormData>(
    createClub.bind(null, locale),
    {},
  );

  // Cierra el dialog y refresca la lista al crear OK (patrón create-player-dialog).
  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) {
      setOpen(false);
      setName('');
      router.refresh();
    }
  }

  const slugPreview = nameToSlug(name);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden />
          <span>{t('create_club')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('create_club')}</DialogTitle>
          <DialogDescription>{t('create_club_help')}</DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cc-name">{t('form.name_label')}</Label>
            <Input
              id="cc-name"
              name="name"
              required
              maxLength={120}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('form.name_placeholder')}
            />
            <p className="text-xs text-muted-foreground">
              {slugPreview
                ? t('form.slug_preview', { slug: slugPreview })
                : t('form.slug_preview_empty')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cc-locale">{t('form.locale_label')}</Label>
            <Select name="club_locale" defaultValue={locale}>
              <SelectTrigger id="cc-locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="va">Valencià</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {t(`form.error.${state.error}`)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('form.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{t('form.create')}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
