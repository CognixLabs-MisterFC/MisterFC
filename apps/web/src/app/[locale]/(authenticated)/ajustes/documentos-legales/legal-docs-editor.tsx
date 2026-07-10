'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Upload, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LegalMarkdown } from '@/components/legal/legal-markdown';
import { convertDocxToMarkdown, publishLegalDocument } from './actions';

export type LegalDocRow = {
  doc_type: string;
  version: number;
  title: string;
  body: string;
};

const ORDER = [
  'privacy_policy',
  'terms_conditions',
  'image_internal',
  'image_social',
  'medical_informed_consent',
] as const;
type DocType = (typeof ORDER)[number];

/**
 * F14-13b — Editor de los 5 textos legales del club (solo admin_club). Por
 * doc_type: textarea del markdown vigente (editable) + preview en vivo
 * (LegalMarkdown). "Subir .docx" convierte y vuelca en el textarea (server action);
 * "Publicar" crea una versión nueva (RPC idempotente: si es idéntico, "sin cambios").
 */
export function LegalDocsEditor({ docs }: { docs: LegalDocRow[] }) {
  const t = useTranslations('ajustes');

  const initial = ORDER.reduce<Record<DocType, LegalDocRow>>(
    (acc, dt) => {
      const found = docs.find((d) => d.doc_type === dt);
      acc[dt] = found ?? { doc_type: dt, version: 0, title: '', body: '' };
      return acc;
    },
    {} as Record<DocType, LegalDocRow>,
  );

  const [selected, setSelected] = useState<DocType>('privacy_policy');
  const [bodies, setBodies] = useState<Record<DocType, string>>(
    () => Object.fromEntries(ORDER.map((dt) => [dt, initial[dt].body])) as Record<DocType, string>,
  );
  const [versions, setVersions] = useState<Record<DocType, number>>(
    () => Object.fromEntries(ORDER.map((dt) => [dt, initial[dt].version])) as Record<DocType, number>,
  );
  const [converting, setConverting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const docLabel = (dt: DocType) => t(`legal.doc.${dt}`);
  const body = bodies[selected];

  async function onPickDocx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setConverting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await convertDocxToMarkdown(fd);
      if ('error' in res) {
        const key = `legal.convert_error.${res.error}`;
        toast.error(t.has(key) ? t(key) : t('legal.convert_error.generic'));
        return;
      }
      setBodies((b) => ({ ...b, [selected]: res.markdown }));
      toast.success(t('legal.converted'));
    } finally {
      setConverting(false);
    }
  }

  async function onPublish() {
    setPublishing(true);
    try {
      const res = await publishLegalDocument(selected, body);
      if ('error' in res) {
        const key = `legal.publish_error.${res.error}`;
        toast.error(t.has(key) ? t(key) : t('legal.publish_error.generic'));
        return;
      }
      if (res.published) {
        setVersions((v) => ({ ...v, [selected]: res.version }));
        toast.success(t('legal.published', { version: res.version }));
      } else {
        toast.info(t('legal.unchanged'));
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selector de los 5 doc_type */}
      <div className="flex flex-wrap gap-2">
        {ORDER.map((dt) => (
          <button
            key={dt}
            type="button"
            onClick={() => setSelected(dt)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              selected === dt
                ? 'border-misterfc-green bg-misterfc-green/10 font-medium text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {docLabel(dt)} <span className="text-xs text-muted-foreground">v{versions[dt]}</span>
          </button>
        ))}
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={onPickDocx}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={converting || publishing}
          onClick={() => fileRef.current?.click()}
        >
          {converting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          <span>{t('legal.upload_docx')}</span>
        </Button>
        <Button type="button" size="sm" disabled={publishing || converting} onClick={onPublish}>
          {publishing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          <span>{t('legal.publish')}</span>
        </Button>
        <span className="text-xs text-muted-foreground">{t('legal.upload_hint')}</span>
      </div>

      {/* Editor + preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="legal-body">
            {t('legal.markdown_label')}
          </label>
          <textarea
            id="legal-body"
            value={body}
            onChange={(e) => setBodies((b) => ({ ...b, [selected]: e.target.value }))}
            spellCheck={false}
            className="h-[28rem] w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-misterfc-green/40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('legal.preview_label')}</span>
          <div className="h-[28rem] overflow-y-auto rounded-md border border-zinc-700 bg-[#0F1B2E] p-4">
            {body.trim() ? (
              <LegalMarkdown body={body} />
            ) : (
              <p className="text-sm text-zinc-500">{t('legal.preview_empty')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
