import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Download } from 'lucide-react';
import {
  createSupabaseServerClient,
  getPlayerManagementAccessFromClient,
  canOfferSelfRevoke,
  getSelfAccountStatusFromClient,
  getSelfRevokeGateFromClient,
  selfAccountStatusMessageKey,
  type SelfAccountStatus,
  getPlayerMedicalFromClient,
  getMyPhoneFromClient,
  previewAccountDeletionFromClient,
} from '@misterfc/core';
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
import { DeleteAccountCard } from './delete-account-card';
import { InviteSelfDialog } from './invite-self-dialog';
import { RevokeSelfDialog } from './revoke-self-dialog';
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

  // Teléfono propio: `profiles.phone` no es legible por select (migración
  // 20261057000000), así que sale de la RPC `get_my_phone`. Si la lectura falla,
  // el formulario NO pinta el campo — mejor eso que enseñar un hueco vacío que
  // al guardar borraría el número bueno.
  const myPhone = await getMyPhoneFromClient(supabase);

  // BC-4 — jugadores activos de los que es ÚNICO tutor: al borrar la cuenta, la misma
  // pulsación pide su supresión al club, así que hay que enseñarlos ANTES de confirmar.
  // Si la lectura falla NO se pinta la tarjeta: prometer "no se pedirá la supresión de
  // nadie" cuando no lo sabemos sería peor que no ofrecer el botón (core devuelve
  // ok:false justo para poder distinguirlo).
  const deletionPreview = await previewAccountDeletionFromClient(supabase);

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
  let canManageSensitive = false;
  let playerPhotoPath: string | null = null;
  let playerPhotoSignedUrl: string | null = null;
  let playerInitials = '';
  let canManagePhoto = false;
  let canManageMedical = false;
  // MN-9 — estado de la cuenta propia del jugador activo: none | invited | linked.
  let selfStatus: SelfAccountStatus | null = null;
  // RC-2 — ¿se le ofrece RETIRAR esa cuenta? Hace falta algo más que el estado: ver
  // el comentario de la tarjeta, más abajo.
  let canRevokeSelf = false;
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

    // MN-6 — los gates son TRES porque en la base de datos son tres, y cada bloque
    // de esta pantalla pregunta por el que gobierna SU RPC:
    //   foto        → `set_player_photo`      → user_manages_player        (COMPARTIDA)
    //   médica      → `set_player_medical`    → user_manages_player_sensitive + consent
    //   expediente  → `record_data_export`    → user_manages_player_sensitive
    //   supresión   → `request_player_erasure`→ user_manages_player_sensitive
    // Antes los cuatro colgaban de un único `isTutor`, así que el menor con cuenta
    // propia veía botones que el SQL le iba a denegar — y el jugador ADULTO se
    // quedaba sin los suyos, que el SQL sí le permite.
    // O2-5 C2 — los gates + la lectura médica viven en core (mismo criterio).
    const access = await getPlayerManagementAccessFromClient(supabase, activePlayer.id);
    canManagePhoto = access.canManage;
    canManageSensitive = access.canManageSensitive;
    canManageMedical = access.canWriteMedical;
    // MN-9 — qué enseña la tarjeta de acceso. Sustituye al `!isSelf`, que la pintaba
    // para siempre porque miraba la relación de quien mira y no la del jugador.
    selfStatus = await getSelfAccountStatusFromClient(supabase, activePlayer.id);
    // RC-2 — los DOS predicados con los que se gatea `revoke_player_self_account`,
    // preguntados tal cual. La decisión vive en core porque nativa toma la misma.
    canRevokeSelf = canOfferSelfRevoke({
      status: selfStatus,
      gate: await getSelfRevokeGateFromClient(supabase, activePlayer.id),
    });
    if (canManageMedical) {
      medicalInitial = await getPlayerMedicalFromClient(supabase, activePlayer.id);
    }
  }

  const isSelf = activePlayer?.relation === 'self';
  const tMiFicha = await getTranslations('mi_ficha');
  const tJugadores = await getTranslations('jugadores');
  const tErasure = await getTranslations('erasure');
  const tAccountDeletion = await getTranslations('account_deletion');
  const tInviteSelf = await getTranslations('invite_self');

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

          {/* MN-5 — Dar acceso al JUGADOR: el tutor le abre su propia cuenta, y esa
              invitación ES la autorización.

              MN-9 — qué se enseña lo decide el ESTADO del jugador, no la relación de
              quien mira. Antes esto era `!isSelf`, y como la relación del tutor es
              'parent' para siempre, la tarjeta no se iba nunca: el hijo ya entraba con
              su cuenta y su padre seguía viendo el botón, que solo fallaba al pulsarlo.
              El estado lo da `player_self_account_status`, porque el tutor NO VE la
              fila 'self' de su hijo (se la oculta la RLS de `player_accounts`, y así
              debe seguir).

              Al PROPIO JUGADOR la tarjeta le desaparece por este MISMO camino, sin
              preguntar por la relación: la RPC está gateada con `user_manages_player`,
              así que a él le contesta 'linked' por construcción.

              `null` = no se ha podido saber → no se ofrece, igual que `canManage ??
              false` en esta misma pantalla: una lectura que falla no abre puertas.

              MN-10 — y cuando está bloqueado dice POR QUÉ, no «no se puede»: jugador
              de baja, club sin temporada abierta o decisiones de imagen sin responder.
              El texto es el MISMO que enseñaba la RPC después de pulsar (`errors.*`),
              reutilizado a propósito: dos frases para el mismo hecho divergen igual que
              divergen dos predicados.

              El cuarto motivo, `email_relation_conflict`, NO está aquí y no es un
              olvido: se mide contra la dirección que el tutor todavía no ha escrito,
              así que sigue saliendo como error bajo el campo.

              Y esto decide qué se OFRECE, no qué se permite: `invite_player_self`
              conserva su `already_linked` para el hueco entre el pintado y el envío. */}
          {canManagePhoto && selfStatus !== null && (
            <Card>
              <CardHeader>
                <CardTitle>{tInviteSelf('section.title')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {selfStatus === 'none' ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {tInviteSelf('section.hint')}
                    </p>
                    <div>
                      <InviteSelfDialog
                        locale={locale}
                        playerId={activePlayer.id}
                        playerName={activePlayer.name}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {tInviteSelf(selfAccountStatusMessageKey(selfStatus) ?? 'section.hint')}
                    </p>
                    {/* RC-2 — retirar. NO cuelga del estado a secas: `player_self_account_status`
                        está gateada con `user_manages_player`, así que al PROPIO jugador le
                        contesta 'linked' igual que a su padre (MN-9 lo hace a propósito). Si
                        colgara del estado, un chaval de 18 con su cuenta vería un «retirar mi
                        cuenta» que el SQL le niega: el botón muerto por gate mudo que MN-6 y
                        MN-9 llevan dos PRs quitando de esta misma pantalla. */}
                    {canRevokeSelf && (
                      <RevokeSelfDialog
                        playerId={activePlayer.id}
                        playerName={activePlayer.name}
                        invitedOnly={selfStatus === 'invited'}
                      />
                    )}
                  </>
                )}
              </CardContent>
            </Card>
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

          {/* Descargar expediente (derecho de acceso, PDF). RESERVADA:
              `record_data_export` exige user_manages_player_sensitive. */}
          {canManageSensitive && (
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

          {/* Derecho al olvido: solicita la supresión del player. RESERVADA:
              `request_player_erasure` exige user_manages_player_sensitive. */}
          {canManageSensitive && (
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
            phone={myPhone.ok ? { ok: true, value: myPhone.phone ?? '' } : { ok: false }}
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

      {/* Eliminar la cuenta. Al FINAL del todo y en su propia tarjeta: es lo más
          irreversible que un usuario puede hacer sobre sí mismo. */}
      {deletionPreview.ok && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">{tAccountDeletion('card_title')}</CardTitle>
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
    </div>
  );
}
