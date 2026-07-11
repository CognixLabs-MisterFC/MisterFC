import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, UserCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireSuperadmin } from '@/lib/platform/guard';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InviteAdminForm } from './invite-admin-form';

type Props = {
  params: Promise<{ locale: string; clubId: string }>;
};

const METRIC_ROLES = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'jugador',
] as const;

/**
 * F14B-7 — DETALLE de un club (solo superadmin). Métricas del club + estado del
 * owner/admin + gestión del admin: si NO hay owner, form para invitar/reinvitar
 * (leyendo la invitación admin pendiente por RLS); si SÍ hay owner, se muestra
 * en solo lectura. Un clubId inexistente → notFound.
 */
export default async function PlatformClubDetailPage({ params }: Props) {
  const { locale, clubId } = await params;
  setRequestLocale(locale);

  const { supabase } = await requireSuperadmin(locale);
  const t = await getTranslations('platform');
  const tRoles = await getTranslations('roles');

  const [{ data: clubs }, { data: metrics }] = await Promise.all([
    supabase.rpc('platform_list_clubs'),
    supabase.rpc('platform_club_metrics'),
  ]);

  const club = (clubs ?? []).find((c) => c.id === clubId);
  if (!club) notFound();

  const m = (metrics ?? []).find((row) => row.club_id === clubId);

  // Invitación admin pendiente (solo relevante si el club aún no tiene owner). El
  // superadmin la lee por RLS (chokepoint F14B-2 → admin_club en cualquier club).
  let pendingAdminEmail: string | null = null;
  if (!club.has_owner) {
    const { data: pending } = await supabase
      .from('invitations')
      .select('email, created_at')
      .eq('club_id', clubId)
      .eq('role', 'admin_club')
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    pendingAdminEmail = pending?.email ?? null;
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/platform"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span>{t('detail.back')}</span>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{club.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">/{club.slug}</p>
        </div>
      </div>

      {/* Estado del owner/admin. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.admin_title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {club.has_owner ? (
            <div className="flex items-center gap-3 rounded-md border border-border bg-card/40 px-4 py-3">
              <UserCheck className="size-5 text-emerald-400" aria-hidden />
              <div>
                <p className="text-sm font-medium">{club.owner_name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{t('detail.owner_readonly')}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {pendingAdminEmail ? (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="text-amber-400">
                    {t('status.no_owner')}
                  </Badge>
                  <span className="text-muted-foreground">
                    {t('detail.pending_admin', { email: pendingAdminEmail })}
                  </span>
                </div>
              ) : (
                <Badge variant="outline" className="w-fit text-red-400">
                  {t('status.no_admin')}
                </Badge>
              )}
              <p className="text-sm text-muted-foreground">{t('detail.invite_help')}</p>
              <InviteAdminForm
                clubId={clubId}
                locale={locale}
                hasPending={pendingAdminEmail != null}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Métricas del club. */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.metrics_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('table.members')}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">{m?.members_total ?? 0}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('table.players')}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">{m?.players ?? 0}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('table.pending')}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {m?.pending_invitations ?? 0}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-col gap-1.5 border-t border-border pt-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              {t('detail.by_role')}
            </p>
            {METRIC_ROLES.map((role) => (
              <div key={role} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{tRoles(role)}</span>
                <span className="tabular-nums">{m?.[role] ?? 0}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
