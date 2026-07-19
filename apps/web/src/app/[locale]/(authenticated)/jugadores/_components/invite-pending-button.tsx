'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import { Badge } from '@/components/ui/badge';
import { inviteBatch, type BatchInviteResult } from '../actions';

type Props = {
  locale: string;
  clubId: string;
  /** Nº de personas a invitar (para el texto de confirmación). */
  count: number;
  /** player_id → nombre, para el detalle por fila del resultado. */
  nameById: Record<string, string>;
  /**
   * Botón 1 (fin del import): lista de recién importados → se pasa a inviteBatch.
   * Botón 2 (listado): omitido = todos los pendientes del club.
   */
  playerIds?: string[];
  /** Solo cambia la etiqueta del disparador. */
  mode: 'imported' | 'pending';
};

/**
 * F14K-3 — Botón "invitar en lote" (recién importados o pendientes del club).
 * Confirma → envía (inviteBatch de K-2, que revalida el criterio server-side) →
 * muestra el resultado detallado (resumen + fila a fila). Gate de rol y visibilidad
 * los decide el padre (solo admin/director lo renderiza); inviteBatch lo reimpone.
 */
export function InvitePendingButton({
  locale,
  clubId,
  count,
  nameById,
  playerIds,
  mode,
}: Props) {
  const t = useTranslations('jugadores.invitePending');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BatchInviteResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    startTransition(async () => {
      const res = await inviteBatch(locale, clubId, playerIds);
      setResult(res);
    });
  }

  function onOpenChange(next: boolean) {
    // No permitir cerrar mientras se envía (evita dejar el envío a medias).
    if (pending) return;
    setOpen(next);
    if (!next) {
      // Al cerrar tras un envío OK, refresca para que la lista/pendientes cuadren.
      if (result && !result.error) router.refresh();
      setResult(null);
    }
  }

  const sent = result?.rows.filter((r) => r.status === 'sent') ?? [];
  const failed = result?.rows.filter((r) => r.status === 'error') ?? [];
  const skipped = result?.skipped ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="size-4" aria-hidden />
          <span>{mode === 'imported' ? t('trigger.imported') : t('trigger.pending')}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        {result === null ? (
          // Fase 1 — confirmación.
          <>
            <DialogHeader>
              <DialogTitle>{t('confirm.title')}</DialogTitle>
              <DialogDescription>{t('confirm.body', { count })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                {t('confirm.cancel')}
              </Button>
              <Button onClick={send} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {pending ? t('sending') : t('confirm.send')}
              </Button>
            </DialogFooter>
          </>
        ) : result.error === 'too_many_emails' ? (
          // Fase 2a — corte por límite de 100 emails (solo posible en el botón 2).
          <>
            <DialogHeader>
              <DialogTitle>{t('tooMany.title')}</DialogTitle>
              <DialogDescription>
                {t('tooMany.body', { count: result.count_emails, limit: result.limit })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('close')}</Button>
            </DialogFooter>
          </>
        ) : result.error ? (
          // Fase 2b — error de permisos / genérico.
          <>
            <DialogHeader>
              <DialogTitle>{t('errorState.title')}</DialogTitle>
              <DialogDescription>{t(`errorState.${result.error}`)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('close')}</Button>
            </DialogFooter>
          </>
        ) : (
          // Fase 3 — resultado detallado.
          <>
            <DialogHeader>
              <DialogTitle>{t('result.title')}</DialogTitle>
              <DialogDescription>
                {t('result.summary', {
                  sent: sent.length,
                  failed: failed.length,
                  skipped: skipped.length,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
              {result.rows.map((r) => (
                <div
                  key={r.player_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-1.5"
                >
                  <span className="truncate">{nameById[r.player_id] ?? r.email}</span>
                  {r.status === 'sent' ? (
                    <Badge variant="secondary" className="shrink-0">
                      {t('row.sent')}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="shrink-0">
                      {t(`row.reason.${r.reason ?? 'send_failed'}`)}
                    </Badge>
                  )}
                </div>
              ))}
              {skipped.map((s) => (
                <div
                  key={`skipped-${s.player_id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-1.5"
                >
                  <span className="truncate">{nameById[s.player_id] ?? s.player_id}</span>
                  <Badge variant="outline" className="shrink-0">
                    {t('row.skipped')}
                  </Badge>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('close')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
