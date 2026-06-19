'use client';

/**
 * F12.6 — "Guardar como plantilla": clona la sesión actual a una plantilla nueva
 * (is_template, sin fecha/equipo) con el nombre que elija el entrenador. El clonado
 * es atómico (RPC clone_session); aquí solo se recoge el nombre y se invoca la acción.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, BookmarkPlus } from 'lucide-react';
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
import { saveSessionAsTemplate } from '../actions';

export function SaveAsTemplateDialog({
  sessionId,
  defaultName,
}: {
  sessionId: string;
  defaultName: string;
}) {
  const t = useTranslations('sesiones');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [pending, startTransition] = useTransition();

  function submit() {
    const title = name.trim();
    if (title.length === 0) {
      toast.error(t('errors.invalid'));
      return;
    }
    startTransition(async () => {
      const res = await saveSessionAsTemplate({ source_id: sessionId, title });
      if (res.error) {
        toast.error(t(`errors.${res.error}`));
        return;
      }
      toast.success(t('templates.toast_saved'));
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <BookmarkPlus className="size-4" aria-hidden />
          {t('templates.save_as')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('templates.save_as')}</DialogTitle>
          <DialogDescription>{t('templates.save_help')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="tpl-name">{t('templates.name')}</Label>
          <Input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            placeholder={t('templates.name_ph')}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {t('templates.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <span>{t('templates.save')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
