import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Smartphone } from 'lucide-react';
import {
  createSupabaseServerClient,
  getCurrentUser,
  getMyAccountDeletionStatusFromClient,
  getAccountDeletionHoldsFromClient,
  previewAccountDeletionFromClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { familyWebCutDoneMark } from '@misterfc/core';
import { APP_STORE_URL, PLAY_STORE_URL, evaluateFamilyWebCut } from '@/lib/family-web-cut';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogoutButton } from '@/components/shell/logout-button';
import { AccountDeletionPending } from '@/components/shell/account-deletion-pending';
import { DeleteAccountCard } from '../(authenticated)/perfil/delete-account-card';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ hecho?: string | string[] }>;
};



/**
 * W-B — DESTINO del corte de la web para familias.
 *
 * Vive FUERA de los grupos de rutas, igual que `/suscripcion` (SU-5) y
 * `/re-consentimiento` (F14-5): los dos layouts que cortan redirigen aquí, y al no
 * colgar de ninguno de ellos no hay bucle.
 *
 * ── NO ES SOLO UNA PÁGINA DE DESCARGA ────────────────────────────────────────────────
 *
 * Es también **la última pantalla del alta**: quien acepta la invitación en la web acaba
 * en `redirect('/{locale}')` (`invite/[token]/actions.ts`), que pasa por el layout
 * autenticado, que corta y trae aquí. Si esto solo dijera «descárgate la app», esa
 * persona se quedaría sin saber si su cuenta llegó a crearse ni con qué correo entrar —
 * después de haber rellenado un formulario largo. Por eso lo primero que se confirma es
 * la cuenta y el correo.
 *
 * Lo mismo vale para el CAMBIO DE CONTRASEÑA (`reset-password/actions.ts`): antes
 * acababa también en `redirect('/{locale}')`, el layout cortaba, y una familia se
 * quedaba mirando «descárgate la app» sin que nadie le hubiera confirmado que su
 * contraseña se había cambiado. Ahora llega con `?hecho=contrasena` y lo primero que
 * lee es la confirmación.
 *
 * Y lleva DENTRO el borrado de cuenta, por el mismo motivo que el muro de suscripción
 * (SU-5): una pantalla terminal no puede tapar el borrado sin romper Apple 5.1.1(v), que
 * es lo que toda la serie BC existe para cumplir. Con un agravante propio: si esta
 * pantalla fuera un callejón sin salida, la única forma de borrarse sería instalar la
 * app — pedirle a alguien que instale algo para poder irse no se sostiene.
 */
export default async function AplicacionPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // La lista de marcas válidas vive en core, que es donde el CI la ejecuta.
  const hecho = familyWebCutDoneMark((await searchParams).hecho);

  const adapter = await createCookieAdapter();
  const user = await getCurrentUser(adapter);
  if (!user) redirect(`/${locale}/signin`);

  const supabase = createSupabaseServerClient(adapter);

  // Quien no debería estar aquí, fuera. Con el interruptor apagado `closed` es siempre
  // false, así que esta pantalla es INALCANZABLE sin el corte puesto — igual que el muro
  // de suscripción sin su gate. Es lo correcto: sin corte no hay a quien mandar a la app.
  const cut = await evaluateFamilyWebCut(supabase);
  if (!cut.closed) redirect(`/${locale}`);

  const t = await getTranslations('app_only');
  const tDeletion = await getTranslations('account_deletion');

  // BC-4 — un borrado EN CURSO manda sobre el resto de la pantalla, igual que en
  // `/onboarding`: enseñar «borra tu cuenta» a quien ya la está borrando es ofrecerle
  // dos veces lo mismo, y encima le escondería el botón de CANCELAR, que es el único
  // que le queda mientras el plazo corre.
  const deletionStatus = await getMyAccountDeletionStatusFromClient(supabase);
  const pendingDeletion = deletionStatus.ok ? deletionStatus.status : null;

  // Los bloqueantes del borrado: mismo criterio que `/perfil` (BC-4) y que el muro. Si
  // no se pueden leer NO se ofrece el botón — decir "no se pedirá la supresión de nadie"
  // cuando no lo sabemos sería peor que no ofrecerlo.
  const deletionPreview = pendingDeletion ? null : await previewAccountDeletionFromClient(supabase);

  // RC-5 — los hijos que IMPIDEN el borrado. Lo responde `account_deletion_holds()`,
  // la misma función sobre la que se levanta el rechazo de la RPC. Mismo criterio que
  // en Perfil: si no se pudo saber, la tarjeta NO se pinta.
  // Con un borrado YA en curso la tarjeta no se pinta, así que tampoco se pregunta:
  // misma condición que el preview de arriba, para no gastar una consulta de más en
  // la pantalla que ve justo quien está a mitad del proceso.
  const deletionHolds = pendingDeletion
    ? null
    : await getAccountDeletionHoldsFromClient(supabase);

  const stores = [
    { href: APP_STORE_URL, label: t('download_app_store') },
    { href: PLAY_STORE_URL, label: t('download_play') },
  ].filter((s): s is { href: string; label: string } => s.href !== null);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      {/* Cuando se viene de hacer algo, ESO es el titular. Quien acaba de cambiar su
          contraseña ha venido a saber si funcionó, no a leer dónde está la app; el
          cartel de siempre se queda justo debajo, que sigue haciendo falta. */}
      {hecho === 'contrasena' ? (
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-emerald-600">
            {t('password_changed_title')}
          </h1>
          <p className="text-foreground">{t('password_changed_body')}</p>
          <p className="text-muted-foreground">{t('body')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('body')}</p>
        </div>
      )}

      {/* La confirmación del alta. `user.email` es `string | undefined` en supabase-js,
          así que hay un texto para cuando no lo sabemos: decir "entra con el mismo correo
          con el que has entrado aquí" sigue siendo cierto y útil, e inventarse un correo
          no lo sería.

          El correo va en su propia línea y no interpolado en la frase: es el dato que
          esta persona ha venido a leer, y `break-all` porque un correo largo en un móvil
          estrecho se sale de la tarjeta. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('account_title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          {user.email ? (
            <>
              <p>{t('account_email')}</p>
              <p className="font-medium text-foreground break-all">{user.email}</p>
            </>
          ) : (
            <p>{t('account_email_unknown')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" aria-hidden />
            {t('download_title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {/* Sin URLs (hoy) se explica cómo encontrarla; con URLs aparecen los botones.
              Ver la nota de `family-web-cut.ts`: un enlace muerto es peor que ninguno. */}
          {stores.length === 0 ? (
            <p>{t('download_soon')}</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {stores.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border px-4 py-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {s.label}
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Los textos legales siguen abiertos en la web, así que estos enlaces funcionan
          igual que antes del corte. */}
      <p className="flex justify-center gap-4 text-xs">
        <Link href={`/${locale}/legal/terminos`} className="underline">
          {t('terms_link')}
        </Link>
        <Link href={`/${locale}/legal/privacidad`} className="underline">
          {t('privacy_link')}
        </Link>
      </p>

      {pendingDeletion && (
        <AccountDeletionPending
          deadlineAt={pendingDeletion.deadlineAt}
          pendingPlayers={pendingDeletion.pendingPlayers}
        />
      )}

      {/* Apple 5.1.1(v): el borrado sigue alcanzable DESDE el corte. */}
      {deletionPreview?.ok && deletionHolds?.ok && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive text-base">{tDeletion('card_title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteAccountCard
              locale={locale}
              holds={deletionHolds.holds}
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
