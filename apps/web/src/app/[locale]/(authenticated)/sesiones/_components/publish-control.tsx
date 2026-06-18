'use client';

/**
 * F12.4 — Control de publicación (staff). Cambia visibility 'staff' (borrador,
 * por defecto) ↔ 'team' (publicada). Publicar la hace visible read-only para
 * jugadores y familias del team_id (D3). Efecto inmediato (no espera al "Guardar"
 * de la cabecera): publicar es una intención distinta de editar campos.
 *
 * El gate real (owner∪admin) es la RLS de 12.1; si no puede, la acción devuelve
 * error y se muestra un toast. Si la sesión no tiene equipo, publicar no tendría
 * destinatarios → el switch se deshabilita y se explica.
 */

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { SessionVisibility } from '@misterfc/core';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useRouter } from '@/i18n/navigation';
import { setSessionVisibility } from '../actions';

export function PublishControl({
  sessionId,
  visibility,
  hasTeam,
}: {
  sessionId: string;
  visibility: SessionVisibility;
  hasTeam: boolean;
}) {
  const t = useTranslations('sesiones.publish');
  const tErr = useTranslations('sesiones.errors');
  const router = useRouter();
  const [published, setPublished] = useState(visibility === 'team');
  const [pending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    const target: SessionVisibility = next ? 'team' : 'staff';
    setPublished(next); // optimista
    startTransition(async () => {
      const res = await setSessionVisibility({ id: sessionId, visibility: target });
      if (res.error) {
        setPublished(!next); // revierte
        toast.error(tErr(res.error));
        return;
      }
      toast.success(next ? t('toast_published') : t('toast_unpublished'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="publish" className="text-sm font-medium">
              {t('label')}
            </Label>
            <Badge variant={published ? 'default' : 'outline'}>
              {published ? t('published') : t('draft')}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {!hasTeam ? t('no_team') : published ? t('help_published') : t('help_draft')}
          </p>
        </div>
        <Switch
          id="publish"
          checked={published}
          onCheckedChange={onToggle}
          disabled={pending || !hasTeam}
          aria-label={t('label')}
        />
      </CardContent>
    </Card>
  );
}
