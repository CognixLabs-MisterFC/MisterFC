/**
 * E-7b — Cuerpo técnico, VISTA LIGERA (read-only) para entrenador (principal/
 * ayudante) y jugador. Muestra, por cada equipo del usuario, el cuerpo técnico con
 * SOLO nombre + rol. SIN contacto (posibles menores), SIN CSV, SIN gestión. La
 * vista de dirección (filtro + CSV + gestión) vive en /cuerpo-tecnico y no es esta.
 */

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { UsersRound } from 'lucide-react';
import { COACH_ROLES, type Role } from '@misterfc/core';
import { loadShellContext } from '@/lib/auth-shell';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { loadLightTeamStaff } from './queries';

type Props = { params: Promise<{ locale: string }> };

const ALLOWED_ROLES: Role[] = [...COACH_ROLES, 'jugador'];

export default async function MiEquipoCuerpoTecnicoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await loadShellContext();
  if (!ctx) redirect(`/${locale}/signin`);

  const role = ctx.activeClub.role as Role;
  if (!ALLOWED_ROLES.includes(role)) redirect(`/${locale}`);

  const t = await getTranslations('mi_equipo_cuerpo_tecnico');
  const tStaff = await getTranslations('staff.role');

  const teams = await loadLightTeamStaff(
    ctx.activeClub.club.id,
    ctx.user.id,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <UsersRound className="size-6" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {teams.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        teams.map((team) => (
          <Card key={team.team_id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  className="inline-block size-3 rounded-full"
                  style={{ backgroundColor: team.team_color }}
                  aria-hidden
                />
                {team.team_name}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {team.members.length === 0 ? (
                <p className="text-muted-foreground">{t('no_staff')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {team.members.map((m) => (
                    <li
                      key={m.team_staff_id}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="font-medium">{m.full_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {tStaff(m.staff_role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
