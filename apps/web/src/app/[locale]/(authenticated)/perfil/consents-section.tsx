'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SquareArrowOutUpRight } from 'lucide-react';
import { LegalTextModal } from '@/components/legal/legal-text-modal';
import { loadAcceptedLegalDocument } from './consents-actions';

export type TutorConsentRow = {
  player_id: string | null;
  player_name: string | null;
  consent_type: string;
  granted: boolean;
  accepted_at: string;
  legal_document_id: string;
  title: string;
};

type Group = { key: string; label: string; rows: TutorConsentRow[] };

type OpenDoc = { legalDocumentId: string; title: string };

/**
 * F14-13 — Sección de SOLO LECTURA en el perfil del tutor: lista sus
 * consentimientos (estado latest-wins) agrupados en "Tu cuenta" (player_id NULL) +
 * un grupo por hijo. Cada ítem muestra título · fecha · estado (aceptado/denegado)
 * y un enlace que abre el TEXTO EXACTO firmado (por legal_document_id). No se
 * retiran consentimientos desde aquí.
 */
export function ConsentsSection({
  rows,
  locale,
}: {
  rows: TutorConsentRow[];
  locale: string;
}) {
  const t = useTranslations('perfil');
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }),
    [locale],
  );

  const groups = useMemo<Group[]>(() => {
    const account = rows.filter((r) => r.player_id === null);
    const byChild = new Map<string, Group>();
    for (const r of rows) {
      if (r.player_id === null) continue;
      const g = byChild.get(r.player_id);
      if (g) g.rows.push(r);
      else
        byChild.set(r.player_id, {
          key: r.player_id,
          label: r.player_name ?? t('consents.child_unnamed'),
          rows: [r],
        });
    }
    const result: Group[] = [];
    if (account.length > 0)
      result.push({ key: '__account__', label: t('consents.account_group'), rows: account });
    result.push(...byChild.values());
    return result;
  }, [rows, t]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('consents.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border">
            {group.rows.map((row) => (
              <li
                key={`${row.player_id ?? 'acc'}-${row.consent_type}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateFmt.format(new Date(row.accepted_at))} ·{' '}
                    <span className={row.granted ? 'text-misterfc-green' : 'text-destructive'}>
                      {row.granted ? t('consents.granted') : t('consents.denied')}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t('consents.view')}
                  title={t('consents.view')}
                  onClick={() =>
                    setOpenDoc({ legalDocumentId: row.legal_document_id, title: row.title })
                  }
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <SquareArrowOutUpRight className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <LegalTextModal
        key={openDoc?.legalDocumentId}
        open={openDoc != null}
        title={openDoc?.title ?? null}
        fetchBody={
          openDoc ? () => loadAcceptedLegalDocument(openDoc.legalDocumentId) : undefined
        }
        closeLabel={t('consents.close')}
        errorLabel={t('consents.load_error')}
        onClose={() => setOpenDoc(null)}
      />
    </div>
  );
}
