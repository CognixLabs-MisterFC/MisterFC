import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { CAPABILITY_DOMAINS, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CapabilityToggle } from './capability-toggle';

type Props = {
  params: Promise<{ locale: string; teamId: string; membershipId: string }>;
};

export default async function CapabilitiesPage({ params }: Props) {
  const { locale, teamId, membershipId } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Cargar team + membership + caps.
  const { data: team } = await supabase
    .from('teams')
    .select('id, name, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) notFound();
  const clubId = (team.categories as unknown as { club_id: string }).club_id;
  if (clubId !== ctx.activeClub.club.id) notFound();

  const { data: membership } = await supabase
    .from('memberships')
    .select('id, role, club_id, profile_id, profiles!inner(full_name)')
    .eq('id', membershipId)
    .maybeSingle();
  if (!membership || membership.club_id !== clubId) notFound();

  const t = await getTranslations('capabilities');
  const fullName =
    (membership.profiles as unknown as { full_name: string | null })
      .full_name ?? '—';

  // canEdit refleja la MISMA condición que la RLS capabilities_update (F14.9):
  // admin/coord del club, o principal de un equipo del que este staff también es
  // miembro (vía RPC user_is_principal_of_assistant_team). Evita mostrar toggles
  // que la RLS rechazaría (p.ej. un principal de OTRO equipo).
  const role = ctx.activeClub.role;
  let canEdit = role === 'admin_club' || role === 'coordinador';
  if (!canEdit) {
    const { data: isPrincipalOfTeam } = await supabase.rpc(
      'user_is_principal_of_assistant_team',
      { p_membership_id: membershipId }
    );
    canEdit = isPrincipalOfTeam === true;
  }
  const isAssistant = membership.role === 'entrenador_ayudante';

  // Si no es ayudante, mensaje sin toggles (spec §6).
  if (!isAssistant) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/equipos/${teamId}`}>
              <ArrowLeft className="size-4" aria-hidden />
              <span>{t('back')}</span>
            </Link>
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>
              {fullName} · {team.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('not_assistant')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: capsRows } = await supabase
    .from('capabilities')
    .select('capability_name, granted')
    .eq('membership_id', membershipId);
  const caps = new Map<string, boolean>(
    (capsRows ?? []).map((c) => [c.capability_name as string, c.granted])
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/equipos/${teamId}`}>
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t('back')}</span>
          </Link>
        </Button>
      </div>

      <div className="flex flex-col">
        <h1 className="text-2xl font-bold tracking-tight">{fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {team.name} · {t('subtitle')}
        </p>
      </div>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">{t('read_only')}</p>
      )}

      {/* Capabilities agrupadas por dominio (11.9). El modelo no cambia: cada
          toggle concede/revoca igual; solo se reorganiza la presentación. */}
      <div className="flex flex-col gap-6">
        {CAPABILITY_DOMAINS.map((domain) => (
          <section key={domain.key} className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t(`domains.${domain.key}`)}
            </h2>
            {domain.capabilities.map((name) => (
              <CapabilityToggle
                key={name}
                teamId={teamId}
                membershipId={membershipId}
                capabilityName={name}
                initial={caps.get(name) ?? false}
                canEdit={canEdit}
              />
            ))}
          </section>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t('autosave_hint')}</p>
    </div>
  );
}
