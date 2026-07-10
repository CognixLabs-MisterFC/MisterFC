import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ShieldAlert } from 'lucide-react';
import { createSupabaseServerClient, formatPlayerName } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Card, CardContent } from '@/components/ui/card';
import { DecisionButtons } from './decision-buttons';

type Props = { params: Promise<{ locale: string }> };

/**
 * F14-7 — Bandeja de SOLICITUDES DE SUPRESIÓN (derecho al olvido). Solo admin_club
 * y director del club. Muestra las pendientes con el jugador y el solicitante, y
 * permite aprobar (irreversible: borra foto + médica, oculta el resto) o rechazar.
 * La decisión la ejecuta la RPC decide_player_erasure.
 */
export default async function SupresionesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);
  // Solo admin_club / director (coincide con user_is_admin_or_director).
  if (ctx.activeClub.role !== 'admin_club' && ctx.activeClub.role !== 'director') {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('erasure');
  const clubId = ctx.activeClub.club.id;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('erasure_requests')
    .select(
      'id, requested_at, reason, players!inner(first_name, last_name), requester:profiles!erasure_requests_requested_by_fkey(full_name)',
    )
    .eq('club_id', clubId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });

  type Row = {
    id: string;
    requested_at: string;
    reason: string | null;
    players: { first_name: string; last_name: string | null };
    requester: { full_name: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="size-6" aria-hidden />
        <h1 className="text-3xl font-bold tracking-tight">{t('inbox_title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t('inbox_hint')}</p>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('inbox_empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {formatPlayerName(r.players.first_name, r.players.last_name)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('requested_by', {
                      who: r.requester?.full_name ?? '—',
                      date: new Date(r.requested_at).toLocaleDateString(locale),
                    })}
                  </span>
                  {r.reason && <span className="text-xs text-muted-foreground">“{r.reason}”</span>}
                </div>
                <DecisionButtons requestId={r.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
