import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Users } from 'lucide-react';
import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlayerSelector } from '../player-selector';
import { InviteSpectatorDialog } from './invite-spectator-dialog';
import { RevokeSpectatorButton } from './revoke-spectator-button';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ player?: string }>;
};

/**
 * F14C-5 — Gestión de SEGUIDORES de un jugador (área jugador/tutor, comparten el
 * rol `jugador`, igual que /mi-ficha). El tutor del jugador o el propio jugador
 * (self) listan, invitan y revocan a los seguidores (abuelos/familiares) de ESE
 * jugador. Multi-hijo → selector (mismo patrón que /mi-ficha).
 *
 * Gate server-side: role='jugador' + los jugadores salen de player_accounts del
 * usuario (solo los suyos). El listado (list_player_spectators) y las acciones
 * (invite_spectator/remove_spectator) reimponen el gate tutor/self en la DB.
 */
export default async function SeguidoresPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { player: playerParam } = await searchParams;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo jugador/familia (comparten el rol `jugador`). El staff no gestiona esto.
  if (ctx.activeClub.role !== 'jugador') redirect(`/${locale}`);

  const t = await getTranslations('seguidores');

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Jugadores vinculados a la cuenta (player_accounts) en el club activo —
  // idéntico a /mi-ficha. Un hijo suprimido desaparece.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select(
      'player_id, players!inner(id, club_id, first_name, last_name, erased_at)'
    )
    .eq('profile_id', ctx.user.id);
  type PA = {
    player_id: string;
    players: {
      id: string;
      club_id: string;
      first_name: string;
      last_name: string | null;
      erased_at: string | null;
    };
  };
  const myPlayers = ((pas ?? []) as unknown as PA[])
    .filter(
      (p) =>
        p.players.club_id === ctx.activeClub.club.id &&
        p.players.erased_at == null
    )
    .map((p) => ({
      id: p.players.id,
      name: `${p.players.first_name} ${p.players.last_name ?? ''}`.trim(),
    }));

  if (myPlayers.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Header title={t('title')} subtitle={t('subtitle')} />
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('no_player')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const activePlayer =
    myPlayers.find((p) => p.id === playerParam) ?? myPlayers[0]!;
  const playerId = activePlayer.id;

  const { data: spectators } = await supabase.rpc('list_player_spectators', {
    p_player_id: playerId,
  });
  const rows = spectators ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Header
        title={t('title')}
        subtitle={t('subtitle_for', { name: activePlayer.name })}
      />

      {myPlayers.length > 1 && (
        <PlayerSelector
          locale={locale}
          activePlayerId={playerId}
          players={myPlayers}
          basePath="/mi-ficha/seguidores"
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle>{t('list.title')}</CardTitle>
          <InviteSpectatorDialog
            locale={locale}
            playerId={playerId}
            playerName={activePlayer.name}
          />
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('list.empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {rows.map((s) => (
                <li
                  key={s.spectator_profile_id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {s.full_name?.trim() || s.email || t('list.unknown')}
                    </span>
                    {s.email && (
                      <span className="truncate text-xs text-muted-foreground">
                        {s.email}
                      </span>
                    )}
                  </div>
                  <RevokeSpectatorButton
                    playerId={playerId}
                    spectatorProfileId={s.spectator_profile_id}
                    spectatorName={s.full_name?.trim() || s.email || ''}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">{t('list.hint')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <Users className="size-6" aria-hidden />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
