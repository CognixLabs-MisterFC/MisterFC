import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { MembersScreen } from './_components/members-screen';
import { loadClubMembers } from './queries';

type Props = {
  params: Promise<{ locale: string }>;
};

// Baja de miembros (4e-1) — pantalla de gestión: SOLO admin_club y director (A2).
// El coordinador NO entra (coherente con que solo admin/director dan de baja). Guard
// server-side además del nav (defensa en profundidad, como el resto de páginas admin).
const ALLOWED_ROLES: readonly Role[] = ['admin_club', 'director'];

export default async function MiembrosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_ROLES.includes(role)) {
    redirect(`/${locale}`);
  }

  const t = await getTranslations('miembros');
  const members = await loadClubMembers(ctx.activeClub.club.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <MembersScreen
        direccion={members.direccion}
        cuerpoTecnico={members.cuerpoTecnico}
        viewerRole={role}
        viewerProfileId={ctx.user.id}
      />
    </div>
  );
}
