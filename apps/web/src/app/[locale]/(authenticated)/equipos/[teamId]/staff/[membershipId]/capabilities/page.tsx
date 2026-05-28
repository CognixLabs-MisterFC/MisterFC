import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { CAPABILITY_NAMES, createSupabaseServerClient } from '@misterfc/core';
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

const ROLES_THAT_CAN_EDIT_CAPS: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
];

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

  const canEdit = ROLES_THAT_CAN_EDIT_CAPS.includes(ctx.activeClub.role);
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

      <div className="flex flex-col gap-3">
        {CAPABILITY_NAMES.map((name) => (
          <CapabilityToggle
            key={name}
            teamId={teamId}
            membershipId={membershipId}
            capabilityName={name}
            initial={caps.get(name) ?? false}
            canEdit={canEdit}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t('autosave_hint')}</p>
    </div>
  );
}
