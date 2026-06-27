import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalIcon } from '@/components/plays/signal-icon';
import { loadTeamPlay } from '../../../jugadas/queries';
import { PlayViewer } from '../../../jugadas/_components/play-viewer';

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * F13.6 — Vista READ-ONLY de una jugada publicada (jugador/familia). La RLS de
 * 13.1b (plays_select: visibility='team' + user_is_team_member_account) es el
 * gate; `loadTeamPlay` añade la defensa explícita visibility='team'. Si no es
 * visible → notFound. El jsonb `play` es autónomo (no hace falta RPC, a diferencia
 * de los ejercicios en sesiones): se reproduce con <PlayViewer> (anim + fullscreen).
 */
export default async function MiEquipoJugadaPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const play = await loadTeamPlay(ctx.activeClub.club.id, id);
  if (!play) notFound();

  const t = await getTranslations('mi_equipo');
  const tJ = await getTranslations('jugadas');
  const tSig = await getTranslations('jugadas.signals');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href="/mi-equipo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('session.back')}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{play.name ?? tJ('untitled')}</CardTitle>
          {/* Seña del equipo (TANDA 2): pictograma + etiqueta del gesto. */}
          {play.signal_id ? (
            <div className="mt-2 flex items-center gap-2">
              <SignalIcon
                signalId={play.signal_id}
                className="size-8 shrink-0 text-foreground"
                title={tSig(play.signal_id)}
              />
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {tJ('fields.signal')}
                </span>
                <span className="text-sm font-medium">{tSig(play.signal_id)}</span>
              </div>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <PlayViewer play={play.play} />
        </CardContent>
      </Card>
    </div>
  );
}
