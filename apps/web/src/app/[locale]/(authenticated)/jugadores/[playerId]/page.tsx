import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { PlayerForm } from './player-form';
import { MedicalNotesForm } from './medical-notes-form';
import { PlayerPhotoUploader } from './player-photo-uploader';

type Props = {
  params: Promise<{ locale: string; playerId: string }>;
};

const ROLES_THAT_CAN_MANAGE: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
];

const PLAYER_PHOTO_TTL_SECONDS = 600; // 10 min

export default async function PlayerDetailPage({ params }: Props) {
  const { locale, playerId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data: player } = await supabase
    .from('players')
    .select(
      'id, club_id, first_name, last_name, date_of_birth, dorsal, position_main, positions_secondary, foot, height_cm, weight_kg, origin, photo_url'
    )
    .eq('id', playerId)
    .maybeSingle();

  if (!player || player.club_id !== ctx.activeClub.club.id) notFound();

  const t = await getTranslations('jugadores');
  const tShell = await getTranslations('shell');

  const canManage = ROLES_THAT_CAN_MANAGE.includes(ctx.activeClub.role);

  // Visibilidad de medical_notes: helper SQL es la autoridad
  const { data: canSeeMedical } = await supabase.rpc(
    'user_can_see_player_medical',
    { p_player_id: player.id }
  );

  let medicalNotes: string | null = null;
  if (canSeeMedical) {
    const { data: row } = await supabase
      .from('players')
      .select('medical_notes')
      .eq('id', player.id)
      .maybeSingle();
    medicalNotes = row?.medical_notes ?? null;
  }

  // Signed URL para la foto actual (server side, TTL corto)
  let photoSignedUrl: string | null = null;
  if (player.photo_url) {
    const { data } = await supabase.storage
      .from('player-photos')
      .createSignedUrl(player.photo_url, PLAYER_PHOTO_TTL_SECONDS);
    photoSignedUrl = data?.signedUrl ?? null;
  }

  // Trayectoria (F2.5)
  const { data: history } = await supabase
    .from('team_members')
    .select(
      'id, joined_at, left_at, dorsal_in_team, position_in_team, teams!inner(name, categories!inner(name, season))'
    )
    .eq('player_id', player.id)
    .order('joined_at', { ascending: false });

  const fullName = `${player.first_name} ${player.last_name}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/jugadores">
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back_to_list')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <PlayerPhotoUploader
          playerId={player.id}
          initialPath={player.photo_url}
          initialSignedUrl={photoSignedUrl}
          fallback={fullName.slice(0, 2).toUpperCase()}
          canManage={canManage}
          labels={{
            change: t('photo.change'),
            remove: t('photo.remove'),
            hint: t('photo.hint'),
            errors: {
              mime: t('photo.errors.mime'),
              too_large: t('photo.errors.too_large'),
              empty: t('photo.errors.empty'),
              upload_failed: t('photo.errors.upload_failed'),
              remove_failed: t('photo.errors.remove_failed'),
            },
          }}
        />
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold tracking-tight">{fullName}</h1>
          {player.dorsal != null && (
            <p className="text-sm text-muted-foreground">
              {t('field.dorsal')} #{player.dorsal}
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('section.basic_data')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlayerForm playerId={player.id} initial={player} canEdit={canManage} />
        </CardContent>
      </Card>

      {canSeeMedical && (
        <Card>
          <CardHeader>
            <CardTitle>{t('section.medical')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MedicalNotesForm
              playerId={player.id}
              initial={medicalNotes}
              canEdit={canManage}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('section.history')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {(history ?? []).map((h) => {
                // teams llega como objeto plano (FK con !inner) — el cliente
                // de Supabase lo tipa como array, hacemos cast seguro.
                const teamObj = (h.teams ?? null) as
                  | { name: string; categories: { name: string; season: string } }
                  | null;
                const teamName = teamObj?.name ?? '—';
                const catName = teamObj?.categories?.name ?? '';
                const season = teamObj?.categories?.season ?? '';
                return (
                  <li
                    key={h.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{teamName}</span>
                      <span className="text-xs text-muted-foreground">
                        {catName}
                        {season ? ` · ${season}` : ''}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {h.joined_at}
                      {h.left_at ? ` → ${h.left_at}` : ` · ${tShell('app_name')}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator />
    </div>
  );
}
