import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Download } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { loadAccountPlayers } from '@/lib/account-players';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { PerfilForm } from './perfil-form';
import { ConsentsSection, type TutorConsentRow } from './consents-section';
import { PlayerSelector } from '../mi-ficha/player-selector';
import { MedicalForm } from '../mi-ficha/medical-form';
import { ErasureRequestButton } from '../mi-ficha/erasure-request-button';
import { PlayerPhotoUploader } from '../jugadores/[playerId]/player-photo-uploader';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ player?: string }>;
};

const PHOTO_TTL = 3600;

export default async function PerfilPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { player: playerParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) {
    redirect(`/${locale}/signin`);
  }

  const t = await getTranslations('perfil');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // F14-13 — consentimientos del tutor en el club activo (estado latest-wins).
  const { data: consentRows } = await supabase.rpc('get_tutor_consents', {
    p_club_id: ctx.activeClub.club.id,
  });

  // ── Zona JUGADOR: players vinculados a la cuenta (self + hijos) ──────────────
  // Helper compartido con /mi-ficha y /mi-informe → mismo conjunto y mismo ORDEN
  // determinista (el default es el mismo player en las tres pantallas).
  const myPlayers = await loadAccountPlayers(
    supabase,
    ctx.user.id,
    ctx.activeClub.club.id,
  );
  const activePlayer =
    myPlayers.find((p) => p.id === playerParam) ?? myPlayers[0] ?? null;

  // Datos por-player del activo (foto + gates de gestión). Solo si hay player.
  let playerPhotoPath: string | null = null;
  let playerPhotoSignedUrl: string | null = null;
  let playerInitials = '';
  let canManagePhoto = false;
  let canManageMedical = false;
  let medicalInitial: {
    allergies: string | null;
    medication: string | null;
    medical_conditions: string | null;
    emergency_contact: string | null;
  } | null = null;

  if (activePlayer) {
    const { data: playerRow } = await supabase
      .from('players')
      .select('first_name, last_name, photo_url')
      .eq('id', activePlayer.id)
      .maybeSingle();
    playerPhotoPath = playerRow?.photo_url ?? null;
    playerInitials =
      (playerRow?.first_name?.[0] ?? '') + (playerRow?.last_name?.[0] ?? '');
    if (playerPhotoPath) {
      const { data: signed } = await supabase.storage
        .from('player-photos')
        .createSignedUrl(playerPhotoPath, PHOTO_TTL);
      playerPhotoSignedUrl = signed?.signedUrl ?? null;
    }

    // Gate de gestión por-player (foto, expediente, olvido): user_is_tutor_of_player
    // — desde la extensión self acepta relation parent/guardian/self (el propio
    // jugador adulto gestiona lo suyo). La médica exige ADEMÁS consentimiento vigente.
    const { data: isTutorOfPlayer } = await supabase.rpc(
      'user_is_tutor_of_player',
      { p_player_id: activePlayer.id },
    );
    canManagePhoto = Boolean(isTutorOfPlayer);

    const { data: hasMedicalConsent } = await supabase.rpc(
      'user_has_medical_consent_write',
      { p_player_id: activePlayer.id },
    );
    canManageMedical = Boolean(isTutorOfPlayer && hasMedicalConsent);
    if (canManageMedical) {
      const { data: medicalRows } = await supabase.rpc('get_player_medical', {
        p_player_id: activePlayer.id,
        p_ip: undefined,
        p_user_agent: undefined,
      });
      medicalInitial = medicalRows?.[0] ?? null;
    }
  }

  const isSelf = activePlayer?.relation === 'self';
  const tMiFicha = await getTranslations('mi_ficha');
  const tJugadores = await getTranslations('jugadores');
  const tErasure = await getTranslations('erasure');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* ── ZONA B · Datos y gestión del JUGADOR (players), ARRIBA ─────────── */}
      {activePlayer && (
        <>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {isSelf ? t('zone.player_self') : t('zone.player_child')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSelf ? t('zone.player_self_hint') : t('zone.player_child_hint')}
            </p>
          </div>

          {myPlayers.length > 1 && (
            <PlayerSelector
              locale={locale}
              activePlayerId={activePlayer.id}
              players={myPlayers}
              basePath="/perfil"
            />
          )}

          {/* Foto del JUGADOR: players.photo_url (única foto de la pantalla). */}
          {canManagePhoto && (
            <Card>
              <CardHeader>
                <CardTitle>{tMiFicha('section.photo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <PlayerPhotoUploader
                  playerId={activePlayer.id}
                  initialPath={playerPhotoPath}
                  initialSignedUrl={playerPhotoSignedUrl}
                  fallback={playerInitials}
                  canManage
                  labels={{
                    change: tJugadores('photo.change'),
                    remove: tJugadores('photo.remove'),
                    hint: tJugadores('photo.hint'),
                    errors: {
                      mime: tJugadores('photo.errors.mime'),
                      too_large: tJugadores('photo.errors.too_large'),
                      empty: tJugadores('photo.errors.empty'),
                      upload_failed: tJugadores('photo.errors.upload_failed'),
                      remove_failed: tJugadores('photo.errors.remove_failed'),
                    },
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* Información médica: exige consentimiento de escritura vigente. */}
          {canManageMedical && (
            <Card>
              <CardHeader>
                <CardTitle>{tMiFicha('medical.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  {tMiFicha('medical.tutor_hint')}
                </p>
                <MedicalForm playerId={activePlayer.id} initial={medicalInitial} />
              </CardContent>
            </Card>
          )}

          {/* Descargar expediente (derecho de acceso, PDF). */}
          {canManagePhoto && (
            <Card>
              <CardHeader>
                <CardTitle>{tMiFicha('data_export.title')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  {tMiFicha('data_export.hint')}
                </p>
                <Button asChild variant="outline" size="sm" className="w-fit gap-2">
                  <a href={`/${locale}/mi-ficha/export/${activePlayer.id}`}>
                    <Download className="size-4" aria-hidden />
                    <span>{tMiFicha('data_export.button')}</span>
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Derecho al olvido: solicita la supresión del player. */}
          {canManagePhoto && (
            <Card>
              <CardHeader>
                <CardTitle>{tErasure('card_title')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">{tErasure('card_hint')}</p>
                <ErasureRequestButton playerId={activePlayer.id} />
              </CardContent>
            </Card>
          )}

          <Separator className="my-2" />
        </>
      )}

      {/* ── Consentimientos (en medio) ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('section.consents')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ConsentsSection rows={(consentRows ?? []) as TutorConsentRow[]} locale={locale} />
        </CardContent>
      </Card>

      {/* ── ZONA A · Tu cuenta (datos del tutor), ABAJO ────────────────────── */}
      <Separator className="my-2" />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {t('zone.account')}
      </h2>

      <Card>
        <CardHeader>
          <CardTitle>{t('section.data')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PerfilForm
            locale={locale}
            email={ctx.user.email ?? ''}
            initial={{
              full_name: ctx.profile.full_name ?? '',
              date_of_birth: ctx.profile.date_of_birth ?? '',
              locale: ctx.profile.locale,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('section.account')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">{t('field.email')}</p>
            <p className="text-muted-foreground">{ctx.user.email}</p>
          </div>
          <Separator />
          <a
            href={`/${locale}/forgot-password`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {t('change_password')}
          </a>
          <Separator />
          <a
            href={`/${locale}/perfil/notificaciones`}
            className="text-sm text-misterfc-green underline underline-offset-4 hover:text-emerald-300"
          >
            {t('manage_notifications')}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
