'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setClubColor } from './actions';

/** O2-1a — hex #RRGGBB, igual que el CHECK de la columna y la action. */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
/** Punto de partida del selector cuando el club aún no tiene color. Neutro. */
const NEUTRAL_DEFAULT = '#64748B';

/**
 * O2-1a — Fija o quita el color de marca del club. Color LIBRE validado (hex),
 * no hay paleta cerrada: el alta la hace el superadmin y el color lo ajusta el
 * admin. Persiste vía la action setClubColor → RPC set_club_color (gate admin).
 * Solo se renderiza para admin_club. NO pinta la web con el color todavía (O2-1a).
 */
export function ClubColorPicker({
  clubId,
  initialColor,
}: {
  clubId: string;
  initialColor: string | null;
}) {
  const t = useTranslations('ajustes');
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState<string | null>(initialColor);
  const [draft, setDraft] = useState<string>(initialColor ?? NEUTRAL_DEFAULT);
  const [error, setError] = useState<string | null>(null);

  const draftValid = HEX_COLOR_RE.test(draft);
  const dirty = draft.toUpperCase() !== (color ?? '').toUpperCase();

  function onSave() {
    setError(null);
    if (!draftValid) {
      setError(t('color.error_invalid'));
      return;
    }
    startTransition(async () => {
      const result = await setClubColor(clubId, draft);
      if (!result.success) {
        setError(
          result.error === 'forbidden'
            ? t('color.error_forbidden')
            : result.error === 'invalid'
              ? t('color.error_invalid')
              : t('color.error_generic'),
        );
        return;
      }
      setColor(draft);
    });
  }

  function onRemove() {
    setError(null);
    startTransition(async () => {
      const result = await setClubColor(clubId, null);
      if (!result.success) {
        setError(
          result.error === 'forbidden'
            ? t('color.error_forbidden')
            : t('color.error_generic'),
        );
        return;
      }
      setColor(null);
      setDraft(NEUTRAL_DEFAULT);
    });
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {/* Muestra del color guardado (o neutro si no hay). */}
        <span
          aria-hidden
          className="size-12 shrink-0 rounded border"
          style={{ backgroundColor: color ?? NEUTRAL_DEFAULT }}
        />

        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={t('color.picker_label')}
            value={draft}
            onChange={(e) => {
              setError(null);
              setDraft(e.target.value.toUpperCase());
            }}
            disabled={pending}
            className="h-9 w-12 cursor-pointer rounded border bg-background p-1 disabled:cursor-not-allowed"
          />
          <input
            type="text"
            inputMode="text"
            aria-label={t('color.hex_label')}
            value={draft}
            onChange={(e) => {
              setError(null);
              setDraft(e.target.value.toUpperCase());
            }}
            disabled={pending}
            placeholder="#RRGGBB"
            maxLength={7}
            className="w-28 rounded border bg-background px-2 py-1 font-mono text-sm uppercase disabled:opacity-50"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={pending || !dirty || !draftValid}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            <span>{t('color.save')}</span>
          </Button>
          {color && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={pending}
            >
              <Trash2 className="size-4" aria-hidden />
              <span>{t('color.remove')}</span>
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {color ? t('color.hint_set', { color }) : t('color.hint_none')}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
