'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import type { Role } from '@misterfc/core';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BajaDialog } from './baja-dialog';
import type { ClubMemberRow } from '../queries';

type Segment = 'direccion' | 'cuerpo_tecnico';

/** Roles con ficha en cuerpo técnico (reutilizamos esa ficha para "Ver ficha"). */
const COACH_FICHA_ROLES = new Set<Role>([
  'entrenador_principal',
  'entrenador_ayudante',
]);

function isHigh(role: Role): boolean {
  return role === 'admin_club' || role === 'director';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0).toUpperCase() ?? '';
  const last = parts[parts.length - 1]?.charAt(0).toUpperCase() ?? '';
  return `${first}${last !== first ? last : ''}`.slice(0, 2);
}

export function MembersScreen({
  direccion,
  cuerpoTecnico,
  viewerRole,
  viewerProfileId,
}: {
  direccion: ClubMemberRow[];
  cuerpoTecnico: ClubMemberRow[];
  viewerRole: Role;
  viewerProfileId: string;
}) {
  const t = useTranslations('miembros');
  const tRole = useTranslations('roles');
  const [segment, setSegment] = useState<Segment>('direccion');

  const rows = segment === 'direccion' ? direccion : cuerpoTecnico;

  /**
   * ¿Se ofrece "Dar de baja" a este miembro? Espeja las guardas de la RPC para NO
   * pintar botones inútiles; la RPC sigue siendo la autoridad. admin_club nunca (se
   * traspasa antes); nadie a sí mismo; un no-admin no puede con un rol alto (director).
   */
  function canBaja(m: ClubMemberRow): boolean {
    if (m.profile_id === viewerProfileId) return false;
    if (m.club_role === 'admin_club') return false;
    if (isHigh(m.club_role) && viewerRole !== 'admin_club') return false;
    return true;
  }

  const segments: { key: Segment; count: number }[] = [
    { key: 'direccion', count: direccion.length },
    { key: 'cuerpo_tecnico', count: cuerpoTecnico.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div
        className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card/30 p-1"
        role="tablist"
        aria-label={t('segments.label')}
      >
        {segments.map((s) => (
          <Button
            key={s.key}
            role="tab"
            aria-selected={segment === s.key}
            variant={segment === s.key ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setSegment(s.key)}
          >
            {t(`segments.${s.key}`)}{' '}
            <span className="ml-1 text-xs opacity-70">{s.count}</span>
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="size-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" aria-label={t('table.avatar')} />
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('table.role')}
                  </TableHead>
                  <TableHead className="text-right">{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.membership_id}>
                    <TableCell>
                      <span
                        className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                        aria-hidden
                      >
                        {initials(m.full_name)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{m.full_name}</span>
                        <span className="text-xs text-muted-foreground md:hidden">
                          {tRole(m.club_role)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {tRole(m.club_role)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {COACH_FICHA_ROLES.has(m.club_role) && (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/cuerpo-tecnico/${m.membership_id}`}>
                              {t('row.open_ficha')}
                            </Link>
                          </Button>
                        )}
                        {m.club_role === 'admin_club' ? (
                          <span className="text-xs text-muted-foreground">
                            {t('row.admin_note')}
                          </span>
                        ) : canBaja(m) ? (
                          <BajaDialog
                            targetProfileId={m.profile_id}
                            memberName={m.full_name}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground" aria-hidden>
                            —
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
