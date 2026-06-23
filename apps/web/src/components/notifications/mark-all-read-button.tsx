'use client';

/**
 * F13.9b — botón "marcar todas como leídas". Pasa a sent todas las in_app
 * pendientes del usuario y refresca: re-renderiza la ruta actual (feed/página) y
 * el layout (badges del sidebar) → todo queda consistente. Acción benigna, sin
 * confirmación; feedback visual mientras corre. Las etiquetas llegan ya
 * traducidas desde el server.
 */

import { useTransition } from 'react';
import { CheckCheck } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { markAllNotificationsRead } from '@/lib/notifications-actions';

export function MarkAllReadButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
      className="gap-2"
    >
      <CheckCheck className="size-4" aria-hidden />
      {pending ? pendingLabel : label}
    </Button>
  );
}
