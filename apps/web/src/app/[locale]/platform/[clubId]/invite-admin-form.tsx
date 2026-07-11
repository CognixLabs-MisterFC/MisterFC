'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Mail } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inviteAdminAction, type InviteAdminFormState } from './actions';

/**
 * F14B-7 — Form "invitar / reinvitar admin" (superadmin, club SIN owner).
 * Reutiliza inviteClubAdmin (F14B-5b) vía inviteAdminAction. Al invitar OK,
 * refresca la página para reflejar la nueva invitación pendiente.
 */
export function InviteAdminForm({
  clubId,
  locale,
  hasPending,
}: {
  clubId: string;
  locale: string;
  /** Ya hay una invitación admin pendiente → el CTA es "reinvitar/cambiar email". */
  hasPending: boolean;
}) {
  const t = useTranslations('platform');
  const router = useRouter();

  const [state, formAction, pending] = useActionState<InviteAdminFormState, FormData>(
    inviteAdminAction.bind(null, clubId, locale),
    {},
  );

  const [lastHandled, setLastHandled] = useState(state);
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) router.refresh();
  }

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">{t('invite.email_label')}</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t('invite.email_placeholder')}
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {t(`invite.error.${state.error}`)}
        </p>
      )}
      {state.ok && (
        <p className="text-sm text-emerald-400" role="status">
          {t('invite.ok', { email: state.ok.email })}
        </p>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Mail className="size-4" aria-hidden />
        )}
        <span>{hasPending ? t('invite.resend') : t('invite.send')}</span>
      </Button>
    </form>
  );
}
