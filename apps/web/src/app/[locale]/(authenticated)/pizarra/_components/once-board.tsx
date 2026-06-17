'use client';

/**
 * F11B.2 — Pizarra sobre el ONCE REAL. Reusa <PitchBoard> (la MISMA capa de
 * dibujo de F11) montando como fondo el <MatchFieldEditor> readonly con la
 * alineación real; los dibujos confirmados se pintan con <DiagramView
 * showField={false}> encima (sin duplicar las marcas del campo). Los chips del
 * once NO se mueven: se dibuja sobre ellos. Efímero: nada se guarda.
 */

import { useTranslations } from 'next-intl';
import { emptyDiagram } from '@misterfc/core';
import { PitchBoard, type RenderField } from '@/components/match/pitch-editor';
import { MatchFieldEditor } from '@/components/match/match-field-editor';
import { DiagramView } from '@/components/match/diagram-view';
import type { BoardLineup } from '../board-lineup';

export function OnceBoard({ lineup }: { lineup: BoardLineup }) {
  const t = useTranslations('pizarra');

  const matchLabel = lineup.event.opponentName
    ? `${lineup.event.teamName} · ${lineup.event.opponentName}`
    : lineup.event.teamName;

  // Fondo = once real + los dibujos confirmados (solo elementos) encima.
  const renderField: RenderField = ({ diagram }) => (
    <>
      <MatchFieldEditor
        format={lineup.event.format}
        formationCode={lineup.formationCode}
        players={lineup.players}
        mode="readonly"
      />
      <DiagramView diagram={diagram} fill showField={false} />
    </>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('once_subtitle', { match: matchLabel })}</p>
      </div>

      {lineup.players.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('once_empty')}</p>
      )}

      <PitchBoard
        initialDiagram={emptyDiagram({ kind: 'completo', orientation: 'vertical' })}
        renderField={renderField}
        lockFieldKind
        showClear
      />
    </div>
  );
}
