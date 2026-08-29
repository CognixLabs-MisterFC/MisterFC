'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import { MemberActions } from './member-actions';
import { FamiliesSearch } from './families-search';
// Director-entrenador (S1a): se REUTILIZAN tal cual el diálogo de asignación y el botón
// de quitar de Cuerpo técnico (misma acción team_staff, misma RLS). NO se modifican.
import { AddAssignmentDialog } from '../../cuerpo-tecnico/_components/add-assignment-dialog';
import { RemoveAssignmentButton } from '../../cuerpo-tecnico/_components/remove-assignment-button';
import type { AssignableTeam, ClubMemberRow, FamilyRow } from '../queries';

export type Segment = 'direccion' | 'cuerpo_tecnico' | 'familias';

const COACH_FICHA_ROLES = new Set<Role>([
  'entrenador_principal',
  'entrenador_ayudante',
]);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0).toUpperCase() ?? '';
  const last = parts[parts.length - 1]?.charAt(0).toUpperCase() ?? '';
  return `${first}${last !== first ? last : ''}`.slice(0, 2);
}

const pad = (n: number) => String(n).padStart(2, '0');
function formatLeftAt(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function MembersScreen({
  segment,
  includeLeft,
  direccion,
  cuerpoTecnico,
  familiesCount,
  families,
  assignableTeams,
  viewerRole,
  viewerProfileId,
}: {
  segment: Segment;
  includeLeft: boolean;
  direccion: ClubMemberRow[];
  cuerpoTecnico: ClubMemberRow[];
  familiesCount: number;
  families: {
    rows: FamilyRow[];
    total: number;
    page: number;
    pageSize: number;
  } | null;
  assignableTeams: AssignableTeam[];
  viewerRole: Role;
  viewerProfileId: string;
}) {
  const t = useTranslations('miembros');
  const tRole = useTranslations('roles');
  const tStaffRole = useTranslations('staff.role');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function pushParams(mutate: (p: URLSearchParams) => void) {
    const np = new URLSearchParams(params);
    mutate(np);
    startTransition(() => router.replace(`${pathname}?${np.toString()}`));
  }

  function goSegment(next: Segment) {
    pushParams((p) => {
      p.set('segment', next);
      p.delete('q');
      p.delete('page');
    });
  }

  function toggleBajas(on: boolean) {
    pushParams((p) => {
      if (on) p.set('bajas', '1');
      else p.delete('bajas');
      p.delete('page');
    });
  }

  function goPage(next: number) {
    pushParams((p) => p.set('page', String(next)));
  }

  const segments: { key: Segment; count: number }[] = [
    { key: 'direccion', count: direccion.length },
    { key: 'cuerpo_tecnico', count: cuerpoTecnico.length },
    { key: 'familias', count: familiesCount },
  ];

  /** Fila de estado (bajo el nombre) para un miembro de baja. */
  function StatusLine({ leftAt }: { leftAt: string | null }) {
    if (leftAt == null) return null;
    return (
      <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
        {t('status.left_since', { date: formatLeftAt(leftAt) })}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Segmentos + toggle "Incluir bajas". */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              onClick={() => goSegment(s.key)}
            >
              {t(`segments.${s.key}`)}{' '}
              <span className="ml-1 text-xs opacity-70">{s.count}</span>
            </Button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeLeft}
            onChange={(e) => toggleBajas(e.target.checked)}
            className="size-4 rounded border-border"
          />
          {t('include_left')}
        </label>
      </div>

      {segment === 'familias' && <FamiliesSearch />}

      {/* Contenido del segmento activo. */}
      {segment === 'familias'
        ? renderFamilias()
        : renderMembers(segment === 'direccion' ? direccion : cuerpoTecnico)}
    </div>
  );

  // ── Dirección / Cuerpo técnico ──────────────────────────────────────────────────
  function renderMembers(rows: ClubMemberRow[]) {
    if (rows.length === 0) {
      return <EmptyCard label={t('empty')} />;
    }
    // El conmutador director-entrenador (S1a) vive SOLO en DIRECCIÓN: asignar equipos y
    // listar/quitar asignaciones. El cuerpo técnico se gestiona en su propia pantalla.
    const isDireccion = segment === 'direccion';
    return (
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
                <TableRow
                  key={m.membership_id}
                  className={m.left_at != null ? 'opacity-60' : undefined}
                >
                  <TableCell>
                    <Avatar name={m.full_name} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{m.full_name}</span>
                      <span className="text-xs text-muted-foreground md:hidden">
                        {tRole(m.club_role)}
                      </span>
                      <StatusLine leftAt={m.left_at} />
                      {/* La explicación de por qué el admin no tiene baja vive AQUÍ,
                          bajo el nombre, y NO en la celda de Acciones: con
                          `whitespace-normal` parte línea en vez de empujar la tabla
                          (el nowrap de TableCell la dejaba en una sola línea larga que
                          desbordaba). Sin cambio funcional: sigue sin botón de baja. */}
                      {m.club_role === 'admin_club' && (
                        <span className="mt-1 max-w-xs whitespace-normal text-xs text-muted-foreground">
                          {t('row.admin_note')}
                        </span>
                      )}
                      {isDireccion && m.assignments.length > 0 && (
                        <div className="mt-1 flex flex-col gap-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t('row.coached_teams')}
                          </span>
                          {m.assignments.map((a) => (
                            <span
                              key={a.team_staff_id}
                              className="flex items-center gap-1 text-xs text-muted-foreground"
                            >
                              <span>
                                {a.team_name} · {tStaffRole(a.staff_role)}
                              </span>
                              <RemoveAssignmentButton
                                teamStaffId={a.team_staff_id}
                                membershipId={m.membership_id}
                                teamName={a.team_name}
                                compact
                              />
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {tRole(m.club_role)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {/* `flex-wrap`: en pantallas estrechas (móvil) los botones
                        envuelven a otra línea en vez de forzar scroll lateral —
                        #530 añadió un 2º botón ("Agregar rol") en Dirección. Cuando
                        caben (caso normal, y todo Cuerpo técnico) el render es idéntico. */}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {COACH_FICHA_ROLES.has(m.club_role) && (
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/cuerpo-tecnico/${m.membership_id}`}>
                            {t('row.open_ficha')}
                          </Link>
                        </Button>
                      )}
                      {/* Asignar a equipo (director-entrenador S1a). Solo DIRECCIÓN y
                          miembro ACTIVO. Deliberadamente SIN el gateo isSelf/rol-alto de
                          la baja: un director puede asignarse a sí mismo (la RLS ya se lo
                          permite). No toca `memberships.role`. */}
                      {isDireccion && m.left_at == null && (
                        <AddAssignmentDialog
                          membershipId={m.membership_id}
                          teams={assignableTeams}
                        />
                      )}
                      <MemberActions
                        profileId={m.profile_id}
                        clubRole={m.club_role}
                        leftAt={m.left_at}
                        name={m.full_name}
                        viewerRole={viewerRole}
                        viewerProfileId={viewerProfileId}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  // ── Familias (tutores) ──────────────────────────────────────────────────────────
  function renderFamilias() {
    if (!families || families.rows.length === 0) {
      return <EmptyCard label={t('familias.empty')} />;
    }
    const { rows, total, page, pageSize } = families;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
      <>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" aria-label={t('table.avatar')} />
                  <TableHead>{t('table.name')}</TableHead>
                  <TableHead className="text-right">{t('table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f) => (
                  <TableRow
                    key={f.membership_id}
                    className={f.left_at != null ? 'opacity-60' : undefined}
                  >
                    <TableCell>
                      <Avatar name={f.full_name} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{f.full_name}</span>
                        {f.children.length === 0 ? (
                          <span className="text-xs italic text-muted-foreground">
                            {t('familias.no_children')}
                          </span>
                        ) : (
                          // Mismo defecto latente que la nota del admin: sin
                          // `whitespace-normal`, una familia con varios hijos o
                          // nombres de equipo largos desbordaría la tabla (nowrap de
                          // TableCell). `break-words` por si un nombre no tiene espacios.
                          <span className="max-w-sm whitespace-normal break-words text-xs text-muted-foreground">
                            {f.children
                              .map((c) =>
                                c.team_name
                                  ? `${c.name} · ${c.team_name}`
                                  : c.name
                              )
                              .join(' · ')}
                          </span>
                        )}
                        <StatusLine leftAt={f.left_at} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <MemberActions
                        profileId={f.profile_id}
                        clubRole={'jugador'}
                        leftAt={f.left_at}
                        name={f.full_name}
                        viewerRole={viewerRole}
                        viewerProfileId={viewerProfileId}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {t('familias.page_of', { page, total: totalPages })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
              >
                {t('familias.prev')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => goPage(page + 1)}
              >
                {t('familias.next')}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Users className="size-10 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
