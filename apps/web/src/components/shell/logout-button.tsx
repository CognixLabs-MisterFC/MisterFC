import { LogOut } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { signout } from '@/app/[locale]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  locale: string;
  variant?: 'ghost' | 'outline';
  className?: string;
};

/**
 * Botón de cerrar sesión compartido entre header autenticado y onboarding.
 * Render como form server-action para no necesitar 'use client'.
 */
export async function LogoutButton({ locale, variant = 'ghost', className }: Props) {
  const t = await getTranslations('shell');
  const action = signout.bind(null, locale);

  return (
    <form action={action} className={cn('contents', className)}>
      <Button type="submit" variant={variant} size="sm">
        <LogOut className="size-4" aria-hidden />
        <span>{t('signout')}</span>
      </Button>
    </form>
  );
}
