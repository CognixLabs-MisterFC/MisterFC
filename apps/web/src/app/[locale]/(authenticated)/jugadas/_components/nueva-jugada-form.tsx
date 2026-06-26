'use client';

/**
 * JR-1 (ADR-0019) — Alta de jugada: solo NOMBRE → crea un BORRADOR del club (banco)
 * sembrando 1 frame vacío en el server y redirige al editor. Ya no pide equipo (la
 * selección por equipo es team_plays, JR-2); el ciclo (proponer/publicar) va en el
 * editor.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import { createPlay } from '../actions';

export function NuevaJugadaForm() {
  const t = useTranslations('jugadas');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const canSubmit = name.trim() !== '';

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createPlay({ name: name.trim() });
      if (res.error || !res.id) {
        toast.error(t(`errors.${res.error ?? 'generic'}`));
        return;
      }
      router.push(`/jugadas/${res.id}/editar`);
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-play-name">{t('fields.name')}</Label>
          <Input
            id="new-play-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('fields.name_ph')}
            maxLength={120}
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={submit} disabled={!canSubmit || pending}>
            {t('create')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
