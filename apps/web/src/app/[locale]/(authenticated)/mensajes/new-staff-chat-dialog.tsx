'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Loader2, Search } from 'lucide-react';
import type { StaffDirectoryEntry, StaffDirectoryRole } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { listStaffDirectory, startStaffConversation } from './actions';

type Props = { locale: string };

/** Orden de las secciones del directorio (mismo criterio que core). */
const STAFF_ROLE_ORDER: StaffDirectoryRole[] = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'preparador_fisico',
  'delegado',
];

/**
 * O2-12 — "Nuevo mensaje a staff" (segmento CLUB). Lista el directorio de staff del
 * club AGRUPADO POR ROL con buscador por nombre, y arranca (o reabre) el hilo 1:1 con
 * el elegido vía `startStaffConversation` (idempotente). El directorio ya excluye al
 * propio y deriva el conjunto como la RLS. Solo lista (lectura) y navega.
 */
export function NewStaffChatDialog({ locale }: Props) {
  const t = useTranslations('mensajes.new_staff');
  const tRole = useTranslations('mensajes_staff.role_group');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<StaffDirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [term, setTerm] = useState('');
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTerm('');
      setSelectingId(null);
      if (staff === null && !loading) {
        setLoading(true);
        setLoadError(false);
        void listStaffDirectory().then((res) => {
          setLoading(false);
          if (res.staff) setStaff(res.staff);
          else setLoadError(true);
        });
      }
    }
  }

  // Filtro por nombre + agrupación por rol (orden fijo, solo secciones no vacías).
  const sections = useMemo(() => {
    const list = staff ?? [];
    const q = term.trim().toLowerCase();
    const filtered =
      q.length === 0 ? list : list.filter((s) => s.fullName.toLowerCase().includes(q));
    return STAFF_ROLE_ORDER.map((role) => ({
      role,
      entries: filtered.filter((s) => s.role === role),
    })).filter((sec) => sec.entries.length > 0);
  }, [staff, term]);

  function onSelect(otherProfileId: string) {
    if (pending) return;
    setSelectingId(otherProfileId);
    startTransition(async () => {
      const res = await startStaffConversation(locale, otherProfileId);
      if (res.ok) {
        setOpen(false);
        router.push(`/${locale}/mensajes/staff/${res.ok.conversation_id}`);
      } else {
        setSelectingId(null);
        setLoadError(true);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Building2 className="size-4" aria-hidden />
          <span>{t('action')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('search_placeholder')}
              className="pl-9"
              autoFocus
              aria-label={t('search_placeholder')}
            />
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {loading ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t('loading')}
              </p>
            ) : loadError ? (
              <p role="alert" className="py-6 text-sm text-destructive">
                {t('error')}
              </p>
            ) : sections.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {sections.map((sec) => (
                  <div key={sec.role} className="flex flex-col">
                    <span className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {tRole(sec.role)}
                    </span>
                    <ul className="flex flex-col divide-y divide-border">
                      {sec.entries.map((s) => {
                        const isSelecting = selectingId === s.profileId;
                        return (
                          <li key={s.profileId}>
                            <button
                              type="button"
                              onClick={() => onSelect(s.profileId)}
                              disabled={pending}
                              className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:bg-muted/30 disabled:opacity-60"
                            >
                              <span className="font-medium">{s.fullName}</span>
                              {isSelecting && (
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
