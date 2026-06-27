/**
 * F12.5 — Documento PDF de la HOJA DE SESIÓN (D6). Replica el formato del anexo
 * (Sesión 11/06): cabecera (equipo·fecha·título·objetivos·tiempo·meso/micro) +
 * bloques en orden, cada uno con sus tareas (descripción / objetivo / incidir en /
 * jugadores / espacio / tiempo-series / variante).
 *
 * SIN diagramas (D6): la columna "Representación gráfica" del anexo se deja como
 * hueco rotulado (rasterizar el DiagramView es follow-up). El resto de campos del
 * anexo SÍ están en el modelo `exercises` (description/objective/coaching_points/
 * variants/players/space_*). Solo presentación; reúsa el branding de 9.B (shared).
 */

import { View, Text, StyleSheet, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { PdfShell, type Translator } from './shared';
import { SignalPdf } from './signal-pdf';
import { DiagramPdf, hasDrawableDiagram } from './diagram-pdf';
import type { SessionForPdf, SessionPdfTask, SessionPdfPlay } from
  '@/app/[locale]/(authenticated)/sesiones/queries';

const NA = '—';
// Paleta del anexo (cabecera azul claro; bandas naranja/verde).
const HEAD_BG = '#DCE6F1';
const BLOCK_BG = '#70AD47';
const TASK_BG = '#ED7D31';
const BORDER = '#CBD5E1';

const s = StyleSheet.create({
  // Cabecera de la sesión (rejilla 3×3 azul claro, como el anexo).
  infoTable: { borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  infoRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  infoRowLast: { flexDirection: 'row' },
  infoCell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    backgroundColor: HEAD_BG,
  },
  infoCellLast: { flex: 1, paddingVertical: 4, paddingHorizontal: 6, backgroundColor: HEAD_BG },
  infoLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#1E3A5F' },
  infoValue: { fontSize: 9, marginTop: 1 },

  // Banda de bloque (verde) y de tarea (naranja).
  blockBand: {
    backgroundColor: BLOCK_BG,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  blockBandText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Helvetica-Bold' },
  taskBand: {
    backgroundColor: TASK_BG,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  taskBandText: { color: '#FFFFFF', fontSize: 9, fontFamily: 'Helvetica-Bold' },

  // Cuerpo de la tarea: 3 columnas (descripción / objetivo / gráfica).
  taskBody: { flexDirection: 'row', borderWidth: 1, borderColor: BORDER, borderTopWidth: 0 },
  col: { flex: 1, padding: 5, borderRightWidth: 1, borderRightColor: BORDER },
  colLast: { flex: 1, padding: 5 },
  colHead: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#64748B', marginBottom: 2 },
  text: { fontSize: 8, lineHeight: 1.3 },
  muted: { fontSize: 8, color: '#94A3B8' },

  // Tira clave-valor (jugadores / espacio / tiempo).
  kvRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: BORDER,
    borderTopWidth: 0,
    backgroundColor: '#F8FAFC',
  },
  kvCell: { flex: 1, paddingVertical: 3, paddingHorizontal: 5, borderRightWidth: 1, borderRightColor: BORDER },
  kvCellLast: { flex: 1, paddingVertical: 3, paddingHorizontal: 5 },
  kvLabel: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#64748B' },
  kvValue: { fontSize: 8, marginTop: 1 },

  graphic: { alignItems: 'center', justifyContent: 'center', minHeight: 44 },

  // Pictograma de la seña + etiqueta (jugada del bloque, TANDA 2).
  signalRow: { flexDirection: 'row', alignItems: 'center' },

  // Sub-rótulo discreto de las jugadas del bloque (tras los ejercicios).
  playsHeading: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#64748B',
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 2,
  },
});

/** Celda de texto con rótulo; muestra "—" si no hay valor. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <Text style={s.colHead}>{label}</Text>
      {value && value.trim() ? (
        <Text style={s.text}>{value}</Text>
      ) : (
        <Text style={s.muted}>{NA}</Text>
      )}
    </>
  );
}

function taskTime(task: SessionPdfTask): string {
  const min = task.duration_min ?? task.base_duration;
  const parts: string[] = [];
  if (min != null) parts.push(`${min}'`);
  if (task.series && task.series.trim()) parts.push(task.series.trim());
  return parts.join('  ·  ');
}

function playTime(play: SessionPdfPlay): string {
  return play.duration_min != null ? `${play.duration_min}'` : '';
}

export interface SessionPdfProps {
  t: Translator;
  /** Etiquetas de objetivos tácticos (ejercicios.tactical). */
  tTactical: Translator;
  /** Etiquetas de objetivos técnicos (ejercicios.technical). */
  tTechnical: Translator;
  /** Etiquetas de las señas (jugadas.signals) para los pictogramas de jugada. */
  tSignal: Translator;
  clubName: string;
  session: SessionForPdf;
}

export function SessionPdfDocument(props: SessionPdfProps): ReactElement<DocumentProps> {
  const { t, tTactical, tTechnical, tSignal, session } = props;

  const dateLabel = session.session_date ?? NA;
  const tacticalLabels = session.tactical_objectives.map((o) => tTactical(o)).join(', ');
  const technicalLabels = session.technical_objectives.map((o) => tTechnical(o)).join(', ');
  const subtitleParts = [session.team_name, dateLabel].filter(Boolean) as string[];

  const spaceLabel = (task: SessionPdfTask): string | null => {
    const parts: string[] = [];
    if (task.space_type) parts.push(t(`session.space_type.${task.space_type}`));
    if (task.space_dimensions && task.space_dimensions.trim()) parts.push(task.space_dimensions.trim());
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const exObjectives = (task: SessionPdfTask): string | null => {
    const labels = [
      ...task.tactical_objectives.map((o) => tTactical(o)),
      ...task.technical_objectives.map((o) => tTechnical(o)),
    ];
    return labels.length > 0 ? labels.join(', ') : null;
  };

  return (
    <PdfShell
      clubName={props.clubName}
      title={t('session.title')}
      subtitle={subtitleParts.join('  ·  ')}
    >
      {/* Cabecera (rejilla 3×3, como el anexo) */}
      <View style={s.infoTable}>
        <View style={s.infoRow}>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>{t('session.team')}</Text>
            <Text style={s.infoValue}>{session.team_name ?? NA}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>{t('session.date')}</Text>
            <Text style={s.infoValue}>{dateLabel}</Text>
          </View>
          <View style={s.infoCellLast}>
            <Text style={s.infoLabel}>{t('session.name')}</Text>
            <Text style={s.infoValue}>{session.title ?? NA}</Text>
          </View>
        </View>
        <View style={s.infoRow}>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>{t('session.physical')}</Text>
            <Text style={s.infoValue}>{session.objective_physical ?? NA}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>{t('session.total')}</Text>
            <Text style={s.infoValue}>
              {session.total_minutes != null ? `${session.total_minutes}'` : NA}
            </Text>
          </View>
          <View style={s.infoCellLast}>
            <Text style={s.infoLabel}>{t('session.mesocycle')}</Text>
            <Text style={s.infoValue}>{session.mesocycle ?? NA}</Text>
          </View>
        </View>
        <View style={s.infoRowLast}>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>{t('session.tactical')}</Text>
            <Text style={s.infoValue}>{tacticalLabels || NA}</Text>
          </View>
          <View style={s.infoCell}>
            <Text style={s.infoLabel}>{t('session.technical')}</Text>
            <Text style={s.infoValue}>{technicalLabels || NA}</Text>
          </View>
          <View style={s.infoCellLast}>
            <Text style={s.infoLabel}>{t('session.microcycle')}</Text>
            <Text style={s.infoValue}>{session.microcycle ?? NA}</Text>
          </View>
        </View>
      </View>

      {/* Bloques en orden, cada uno con sus tareas */}
      {session.blocks.map((block, bi) => (
        <View key={bi} wrap={false}>
          <View style={s.blockBand}>
            <Text style={s.blockBandText}>
              {block.title?.trim() || t(`session.block.${block.block_type}`)}
            </Text>
            {block.total_minutes != null ? (
              <Text style={s.blockBandText}>{`( ${block.total_minutes}' )`}</Text>
            ) : null}
          </View>

          {block.tasks.length === 0 ? (
            <View style={[s.taskBody]}>
              <View style={s.colLast}>
                <Text style={s.muted}>{t('session.empty_block')}</Text>
              </View>
            </View>
          ) : (
            block.tasks.map((task, ti) => (
              <View key={ti} wrap={false}>
                <View style={s.taskBand}>
                  <Text style={s.taskBandText}>{task.exercise_name || NA}</Text>
                  <Text style={s.taskBandText}>{taskTime(task)}</Text>
                </View>

                <View style={s.taskBody}>
                  <View style={s.col}>
                    <Field label={t('session.description')} value={task.description} />
                  </View>
                  <View style={s.col}>
                    <Field label={t('session.objective')} value={task.objective} />
                    <View style={{ marginTop: 4 }}>
                      <Field label={t('session.coaching_points')} value={task.coaching_points} />
                    </View>
                    {exObjectives(task) ? (
                      <View style={{ marginTop: 4 }}>
                        <Field label={t('session.exercise_objectives')} value={exObjectives(task)} />
                      </View>
                    ) : null}
                  </View>
                  <View style={s.colLast}>
                    <Text style={s.colHead}>{t('session.graphic')}</Text>
                    {hasDrawableDiagram(task.diagram) ? (
                      <View style={s.graphic}>
                        <DiagramPdf diagram={task.diagram!} width={120} />
                      </View>
                    ) : (
                      <View style={s.graphic}>
                        <Text style={s.muted}>{t('session.graphic_omitted')}</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={s.kvRow}>
                  <View style={s.kvCell}>
                    <Text style={s.kvLabel}>{t('session.players')}</Text>
                    <Text style={s.kvValue}>{task.players ?? NA}</Text>
                  </View>
                  <View style={s.kvCell}>
                    <Text style={s.kvLabel}>{t('session.space_label')}</Text>
                    <Text style={s.kvValue}>{spaceLabel(task) ?? NA}</Text>
                  </View>
                  <View style={s.kvCellLast}>
                    <Text style={s.kvLabel}>{t('session.time')}</Text>
                    <Text style={s.kvValue}>{taskTime(task) || NA}</Text>
                  </View>
                </View>

                {(task.variants && task.variants.trim()) || (task.notes && task.notes.trim()) ? (
                  <View style={[s.taskBody, { borderTopWidth: 0 }]}>
                    <View style={s.col}>
                      <Field label={t('session.variants')} value={task.variants} />
                    </View>
                    <View style={s.colLast}>
                      <Field label={t('session.day_notes')} value={task.notes} />
                    </View>
                  </View>
                ) : null}
              </View>
            ))
          )}

          {/* Jugadas del bloque (JS-2, D5): tras los ejercicios. El PDF no anima →
              nombre + nº de frames + duración/notas del día + hueco gráfico. */}
          {block.plays.length > 0 ? (
            <View>
              <Text style={s.playsHeading}>{t('session.plays_heading')}</Text>
              {block.plays.map((play, pi) => (
                <View key={`play-${pi}`} wrap={false}>
                  <View style={s.taskBand}>
                    <Text style={s.taskBandText}>{play.play_name || NA}</Text>
                    <Text style={s.taskBandText}>{playTime(play)}</Text>
                  </View>
                  <View style={s.taskBody}>
                    <View style={s.col}>
                      <Field label={t('session.frames_label')} value={String(play.frame_count)} />
                    </View>
                    {/* Seña del equipo (TANDA 2): pictograma + etiqueta. Si la jugada
                        no tiene seña asignada para el equipo de la sesión, se omite. */}
                    <View style={s.col}>
                      <Text style={s.colHead}>{t('session.signal_label')}</Text>
                      {play.signal_id ? (
                        <View style={s.signalRow}>
                          <SignalPdf signalId={play.signal_id} size={20} />
                          <Text style={[s.text, { marginLeft: 4 }]}>
                            {tSignal(play.signal_id)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={s.muted}>{NA}</Text>
                      )}
                    </View>
                    <View style={s.col}>
                      <Field label={t('session.day_notes')} value={play.notes} />
                    </View>
                    <View style={s.colLast}>
                      <Text style={s.colHead}>{t('session.graphic')}</Text>
                      {hasDrawableDiagram(play.diagram) ? (
                        <View style={s.graphic}>
                          <DiagramPdf diagram={play.diagram!} width={120} />
                        </View>
                      ) : (
                        <View style={s.graphic}>
                          <Text style={s.muted}>{t('session.graphic_omitted')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </PdfShell>
  );
}
