'use client';

import { useEffect, useRef } from 'react';
import type { Database } from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { markNotificationsRead } from '@/lib/notifications-actions';

type NotificationType = Database['public']['Enums']['notification_type'];

/**
 * PART 3.4 — al montar (abrir la lista) marca como leídas las notificaciones
 * in_app de los tipos dados y refresca para que el badge del sidebar baje.
 * Fire-and-forget; solo refresca si marcó alguna.
 */
export function MarkNotificationsRead({ types }: { types: NotificationType[] }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markNotificationsRead(types).then((r) => {
      if (r.marked > 0) router.refresh();
    });
    // types es estable por página; intencionadamente sin deps cambiantes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
