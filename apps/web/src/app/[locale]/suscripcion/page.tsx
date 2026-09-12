import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Smartphone } from 'lucide-react';
import {
  createSupabaseServerClient,
  getCurrentUser,
  previewAccountDeletionFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { evaluateSubscriptionGate } from '@/lib/subscription-gate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogoutButton } from '@/components/shell/logout-button';
import { DeleteAccountCard } from '../(authenticated)/perfil/delete-account-card';
import { ClaimSubscriptionButton } from './claim-button';

type Props = { params: Promise<{ locale: string }> };

/**
 * SU-5 — MURO de suscripción de la web.
 *
 * Vive FUERA del grupo `(authenticated)` a propósito, igual que
 * `/re-consentimiento` (F14-5): los dos layouts redirigen aquí, y al no colgar de
 * ninguno de ellos no hay bucle. Tampoco cuelga de `/spectator`, que es el otro punto
 * que redirige.
 *
 * Aquí NO se cobra. Decisión 6 de Jose: solo se paga desde el MÓVIL, no hay pasarela
 * web y no se va a montar. Así que esta pantalla explica dónde pagar y poco más.
 *
 * Lleva DENTRO la tarjeta de borrar la cuenta, con la misma excepción que la nativa
 * (SU-4): el muro no puede tapar el borrado, porque eso rompería Apple 5.1.1(v) —lo que
 * toda la serie BC existe para cumplir— y porque una persona que decide no pagar tiene
 * derecho a irse sin pagar para poder irse.
 */
export default async function SuscripcionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) redirect(`/${locale}/signin`);

  const supabase = createSupabaseServerClient(adapter);

  // Quien no debería estar aquí, fuera. Si el gate está apagado `blocked` es siempre
  // false, así que esta pantalla es inalcanzable sin el interruptor puesto — y eso es
  // lo correcto: sin gate no hay a quien enseñarle un muro.
  const gate = await evaluateSubscriptionGate(supabase);
  if (!gate.blocked) redirect(`/${locale}`);

  const t = await getTranslations('subscription');
  const tDeletion = await getTranslations('account_deletion');

  // Los bloqueantes del borrado: mismo criterio que `/perfil` (BC-4). Si no se pueden
  // leer, NO se ofrece el botón — decir "no se pedirá la supresión de nadie" cuando no
  // lo sabemos sería peor que no ofrecerlo.
  const deletionPreview = await previewAccountDeletionFromClient(supabase);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('body')}</p>
      </div>

      {/* Un impago DENTRO de la gracia no llega aquí (tiene acceso). Si se ve esto, la
          gracia ya venció. */}
      {gate.status.billingIssue && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t('billing_issue')}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" aria-hidden />
            {t('web.pay_on_mobile_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t('web.pay_on_mobile_body')}</p>
          <p>{t('web.pay_on_mobile_then')}</p>
        </CardContent>
      </Card>

      {/* SU-6b — el que YA pagó. Un webhook perdido lo deja sin fila, y sin fila la
          reconciliación nocturna no puede ni preguntar por él: sin esto, una familia que
          ha pagado se queda mirando un muro que por la web no se puede pagar. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('web.claim_title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{t('web.claim_body')}</p>
          <ClaimSubscriptionButton />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t('terms_note')}</p>

      {/* Apple 5.1.1(v): el borrado sigue alcanzable DESDE el muro. */}
      {deletionPreview.ok && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive text-base">
              {tDeletion('card_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteAccountCard
              locale={locale}
              blockers={deletionPreview.blockers.map((b) => ({
                playerId: b.playerId,
                playerName: b.playerName,
                clubName: b.clubName,
              }))}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <LogoutButton locale={locale} variant="outline" />
      </div>
    </main>
  );
}
