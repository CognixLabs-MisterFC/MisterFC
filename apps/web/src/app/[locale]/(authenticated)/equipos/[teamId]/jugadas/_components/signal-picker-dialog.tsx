'use client';

/**
 * Selector de SEÑA por equipo (grid de 10 monigotes). La seña vive en team_plays:
 * cada equipo elige su propio gesto del catálogo de @misterfc/core para una jugada.
 * Se usa al AÑADIR una jugada al playbook del equipo y al CAMBIAR su seña. La seña
 * es obligatoria → el botón confirmar se habilita solo cuando hay una elegida.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PLAY_SIGNAL_CATALOG, type PlaySignalId } from '@misterfc/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SignalIcon } from '@/components/plays/signal-icon';
import { cn } from '@/lib/utils';

export function SignalPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  initial,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Seña preseleccionada (al cambiar la de una jugada ya añadida). */
  initial?: PlaySignalId | null;
  pending: boolean;
  onConfirm: (signalId: PlaySignalId) => void;
}) {
  const t = useTranslations('playbook_equipo.signal');
  const tSignal = useTranslations('jugadas.signals');
  // El padre remonta este diálogo (prop `key`) por cada jugada, así que `initial`
  // siembra el estado en el primer render — sin efecto de sincronización.
  const [selected, setSelected] = useState<PlaySignalId | null>(initial ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {PLAY_SIGNAL_CATALOG.map((sgn) => {
            const isSel = sgn.id === selected;
            return (
              <button
                type="button"
                key={sgn.id}
                onClick={() => setSelected(sgn.id)}
                aria-pressed={isSel}
                title={tSignal(sgn.labelKey)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border p-2 text-center text-[10px] leading-tight transition-colors',
                  isSel ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <SignalIcon signalId={sgn.id} className="size-10 text-foreground" />
                <span>{tSignal(sgn.labelKey)}</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button
            disabled={selected === null || pending}
            onClick={() => selected !== null && onConfirm(selected)}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
