'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  validateRow,
  detectDuplicates,
  summarize,
  type ValidatedRow,
  type ExistingPlayer,
} from '@misterfc/core';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PreviewTable } from './preview-table';
import { parseFile, type ParseFileError } from './parse-file';
import { importPlayers, type ImportResult } from './actions';

type Team = { id: string; name: string; category_name: string };

type Props = {
  locale: string;
  teams: Team[];
  existing: ExistingPlayer[];
};

type Step = 'upload' | 'preview' | 'confirming' | 'result';

export function ImportWizard({ teams, existing }: Props) {
  const t = useTranslations('import');
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [unmappedHeaders, setUnmappedHeaders] = useState<string[]>([]);
  const [parseError, setParseError] = useState<ParseFileError | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const stats = summarize(rows);

  async function handleFile(file: File) {
    setParseError(null);
    const parsed = await parseFile(file);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    const validated = parsed.data.rows.map(
      (raw: Record<string, unknown>, i: number) => validateRow(raw, i)
    );
    const withDedup = detectDuplicates(validated, existing);
    setRows(withDedup);
    setUnmappedHeaders(parsed.data.unmapped_headers);
    setStep('preview');
  }

  function handleConfirm() {
    const validRows = rows.filter((r) => r.status === 'valid' && r.data);
    setStep('confirming');
    startTransition(async () => {
      const res = await importPlayers({
        rows: validRows.map((r) => r.data!),
        team_id: teamId,
      });
      setResult(res);
      setStep('result');
    });
  }

  function handleReset() {
    setRows([]);
    setUnmappedHeaders([]);
    setParseError(null);
    setTeamId(null);
    setResult(null);
    setStep('upload');
  }

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator current={step} />

      {step === 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('step.upload.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {t('step.upload.help')}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/import-templates/players-template.xlsx"
                download
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
              >
                {t('download.xlsx')}
              </a>
              <a
                href="/import-templates/players-template.csv"
                download
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900"
              >
                {t('download.csv')}
              </a>
            </div>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium">{t('upload.label')}</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="block w-full rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-sm"
              />
            </label>
            {parseError && <ParseErrorMessage error={parseError} />}
          </CardContent>
        </Card>
      )}

      {step === 'preview' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('step.preview.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <CountBadge color="green" count={stats.valid} label={t('stats.valid')} />
              <CountBadge
                color="amber"
                count={stats.duplicates}
                label={t('stats.duplicates')}
              />
              <CountBadge color="red" count={stats.invalid} label={t('stats.invalid')} />
            </div>

            {unmappedHeaders.length > 0 && (
              <p className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
                {t('preview.unmapped_headers', {
                  headers: unmappedHeaders.join(', '),
                })}
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex flex-col gap-1 text-sm sm:max-w-sm">
                <span className="text-zinc-300">{t('team.label')}</span>
                <Select
                  value={teamId ?? 'none'}
                  onValueChange={(v) => setTeamId(v === 'none' ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('team.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('team.none')}</SelectItem>
                    {teams.map((tm) => (
                      <SelectItem key={tm.id} value={tm.id}>
                        {tm.category_name} · {tm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={handleReset}>
                  {t('action.back')}
                </Button>
                <Button onClick={handleConfirm} disabled={stats.valid === 0}>
                  {t('action.confirm', { count: stats.valid })}
                </Button>
              </div>
            </div>

            <PreviewTable rows={rows} />
          </CardContent>
        </Card>
      )}

      {step === 'confirming' && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('step.confirming.spinner')}
          </CardContent>
        </Card>
      )}

      {step === 'result' && result && (
        <Card>
          <CardHeader>
            <CardTitle>{t('step.result.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <CountBadge color="green" count={result.created} label={t('result.created')} />
              <CountBadge
                color="amber"
                count={result.skipped_duplicates}
                label={t('result.skipped')}
              />
              <CountBadge color="red" count={result.failed} label={t('result.failed')} />
            </div>
            {result.error && (
              <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200">
                {t(`result.error.${result.error}`)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => downloadReport(result)}>{t('result.download')}</Button>
              <Button variant="ghost" onClick={handleReset}>
                {t('result.again')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-zinc-500">{isPending ? t('step.confirming.spinner') : null}</p>
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const t = useTranslations('import');
  const steps: Step[] = ['upload', 'preview', 'confirming', 'result'];
  return (
    <ol className="flex flex-wrap gap-2 text-xs uppercase tracking-widest">
      {steps.map((s, i) => (
        <li
          key={s}
          className={`rounded-full border px-3 py-1 ${
            s === current
              ? 'border-emerald-500 bg-emerald-950/40 text-emerald-200'
              : 'border-zinc-700 text-zinc-500'
          }`}
        >
          {i + 1}. {t(`step.${s}.short`)}
        </li>
      ))}
    </ol>
  );
}

function CountBadge({
  color,
  count,
  label,
}: {
  color: 'green' | 'amber' | 'red';
  count: number;
  label: string;
}) {
  const cls =
    color === 'green'
      ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
      : color === 'amber'
        ? 'border-amber-700 bg-amber-950/40 text-amber-200'
        : 'border-red-700 bg-red-950/40 text-red-200';
  return (
    <span className={`flex items-baseline gap-2 rounded-md border px-3 py-2 ${cls}`}>
      <strong className="text-lg">{count}</strong>
      <span className="text-xs uppercase tracking-widest">{label}</span>
    </span>
  );
}

function ParseErrorMessage({ error }: { error: ParseFileError }) {
  const t = useTranslations('import');
  const key = `error.${error.code}`;
  return (
    <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200">
      {t(key)}
    </p>
  );
}

function downloadReport(result: ImportResult) {
  const lines = [
    'row_index,status,reason,player_id',
    ...result.details.map(
      (d) =>
        `${d.row_index + 1},${d.status},${d.reason ?? ''},${d.player_id ?? ''}`
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `import-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
