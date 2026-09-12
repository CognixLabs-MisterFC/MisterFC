'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * SU-6b — "ya me he suscrito desde el móvil", desde el muro de la WEB.
 *
 * El agujero es el mismo que tapa el botón de la nativa —una compra cuyo webhook se
 * perdió deja la cuenta sin fila, y sin fila la reconciliación nocturna no la puede ni
 * mirar— pero aquí hace más falta: quien paga en el móvil y luego entra por el navegador
 * se encuentra el muro sin nada que pulsar, porque por la web no se cobra.
 *
 * No hay pago aquí y sigue sin haberlo: esto solo pide al servidor que pregunte a la
 * tienda por esta cuenta. Si hay compra, la puerta se abre al recargar; si no la hay, se
 * dice.
 */
export function ClaimSubscriptionButton() {
  const t = useTranslations('subscription');
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      let outcome: string | null = null;
      try {
        const res = await fetch('/api/subscription/claim', { method: 'POST' });
        if (!res.ok) {
          setMessage(t('claim_error'));
          return;
        }
        const body = (await res.json()) as { outcome?: unknown };
        outcome = typeof body?.outcome === 'string' ? body.outcome : null;
      } catch {
        setMessage(t('claim_error'));
        return;
      }

      // Sin compra en la tienda se dice tal cual: no se deja recargando a quien no va a
      // entrar. `sandbox` cae aquí a propósito — una compra de pruebas no abre producción.
      if (outcome === 'no_entitlement' || outcome === 'sandbox') {
        setMessage(t('claim_none'));
        return;
      }

      // Recargar vuelve a pasar por el gate de la página: si ya hay acceso, ella misma
      // saca de aquí. Si sigue sin haberlo (una suscripción vencida, p. ej.), el muro se
      // queda y es lo correcto.
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={onClick} disabled={pending} variant="outline">
        {pending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            {t('claim_checking')}
          </>
        ) : (
          t('claim')
        )}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
