import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Ban } from 'lucide-react';
import {
  type Role,
  STAFF_ROLES,
  createSupabaseServerClient,
} from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { ExerciseForm } from '../_components/exercise-form';

type Props = {
  params: Promise<{ locale: string }>;
};

// Mismo conjunto que ve la biblioteca; la autoría real la decide
// user_can_create_exercises (RPC) + la RLS de INSERT.
const ALLOWED_VIEW_ROLES = STAFF_ROLES;

export default async function NuevoEjercicioPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_VIEW_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('ejercicios');
  const tForm = await getTranslations('ejercicios.form');

  // Guard de autoría al CARGAR: quien entra por URL directa sin permiso ve el
  // aviso antes de rellenar nada (defensa en profundidad; la RLS es el gate real).
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data: canCreate } = await supabase.rpc('user_can_create_exercises', {
    p_club_id: ctx.activeClub.club.id,
  });

  if (!canCreate) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Link
          href="/ejercicios"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('detail.back')}
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Ban className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{tForm('forbidden')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdmin = role === 'admin_club';

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link
        href="/ejercicios"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('detail.back')}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{tForm('new_title')}</h1>
      <ExerciseForm isAdmin={isAdmin} />
    </div>
  );
}
