'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LogIn, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { enterClubAsSuperadmin } from '@/lib/platform/enter-club';

/**
 * F14B-8 — "Entrar a este club" (superadmin). Dispara enterClubAsSuperadmin, que
 * fija la cookie de club activo, audita la entrada y redirige a la app del club.
 * En éxito el server action redirige (no vuelve); solo se maneja el error.
 */
export function EnterClubButton({ clubId, locale }: { clubId: string; locale: string }) {
  const t = useTranslations('platform');
  const [pending, startTransition] = useTransition();

  return (
    <Button
      onClick={() =>
        startTransition(async () => {
          const res = await enterClubAsSuperadmin(clubId, locale);
          if (res?.error) toast.error(t(`enter.error.${res.error}`));
        })
      }
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <LogIn className="size-4" aria-hidden />
      )}
      <span>{t('enter.button')}</span>
    </Button>
  );
}
