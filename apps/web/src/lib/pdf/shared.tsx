/**
 * F9.B-6/7 — Infra compartida de los PDFs (jugador y equipo). @react-pdf/renderer
 * en servidor (D7); SOLO se importa desde Route Handlers (runtime nodejs).
 *
 * Branding (D9): el modelo `clubs` no tiene escudo (solo `name`), así que la
 * cabecera de marca es una banda con el verde MisterFC + el nombre del club +
 * el título del documento. Sin gráficos (D8): solo tablas.
 */

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';
import type { ReactElement } from 'react';

export const BRAND_GREEN = '#10B981';
export const BRAND_NAVY = '#0F1B2E';
const BORDER = '#E2E8F0';
const MUTED = '#64748B';

export const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 32,
    fontSize: 9,
    color: '#0F172A',
    fontFamily: 'Helvetica',
  },
  band: {
    backgroundColor: BRAND_NAVY,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_GREEN,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  // F14B-9b — cabecera con logo: fila logo + bloque de textos.
  bandRow: { flexDirection: 'row', alignItems: 'center' },
  // Caja fija; objectFit 'contain' respeta el ratio (no deforma logos no cuadrados).
  bandLogo: { width: 40, height: 40, marginRight: 12, objectFit: 'contain' },
  bandClub: { color: BRAND_GREEN, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  bandTitle: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Helvetica-Bold' },
  bandSub: { color: '#CBD5E1', fontSize: 9, marginTop: 2 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BRAND_NAVY,
    marginTop: 12,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  // Tablas
  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 3 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  rowLast: { flexDirection: 'row' },
  headRow: { flexDirection: 'row', backgroundColor: '#F1F5F9' },
  totalsRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1.5,
    borderTopColor: BRAND_NAVY,
  },
  cell: { paddingVertical: 4, paddingHorizontal: 6 },
  cellHead: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontFamily: 'Helvetica-Bold',
    color: MUTED,
    fontSize: 8,
  },
  cellNum: { textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  muted: { color: MUTED },
  // Tarjetas clave-valor (stats de temporada)
  kvGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kvCard: {
    width: '23%',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 3,
    padding: 6,
  },
  kvValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  kvLabel: { fontSize: 7, color: MUTED, marginTop: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: {
    borderWidth: 1,
    borderColor: BRAND_GREEN,
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 7,
    color: '#047857',
    fontSize: 8,
  },
  emptyText: { color: MUTED, fontSize: 9 },
});

/**
 * Cabecera de marca (banda verde/navy con club + título + subtítulo).
 * F14B-9b: si el club tiene logo (data URI base64) se pinta a la izquierda; si
 * es null cae al layout original (nombre a secas), sin hueco ni imagen rota.
 */
export function BrandHeader({
  clubName,
  title,
  subtitle,
  logoDataUrl,
}: {
  clubName: string;
  title: string;
  subtitle?: string;
  logoDataUrl?: string | null;
}): ReactElement {
  const texts = (
    <View style={{ flex: 1 }}>
      <Text style={pdfStyles.bandClub}>{clubName.toUpperCase()}</Text>
      <Text style={pdfStyles.bandTitle}>{title}</Text>
      {subtitle ? <Text style={pdfStyles.bandSub}>{subtitle}</Text> : null}
    </View>
  );
  return (
    <View style={pdfStyles.band}>
      {logoDataUrl ? (
        <View style={pdfStyles.bandRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image no soporta alt */}
          <Image style={pdfStyles.bandLogo} src={logoDataUrl} />
          {texts}
        </View>
      ) : (
        texts
      )}
    </View>
  );
}

/** Documento de una página A4 con la cabecera de marca + contenido. */
export function PdfShell({
  clubName,
  title,
  subtitle,
  logoDataUrl,
  children,
}: {
  clubName: string;
  title: string;
  subtitle?: string;
  logoDataUrl?: string | null;
  children: React.ReactNode;
}): ReactElement<DocumentProps> {
  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <BrandHeader
          clubName={clubName}
          title={title}
          subtitle={subtitle}
          logoDataUrl={logoDataUrl}
        />
        {children}
      </Page>
    </Document>
  );
}

/** Renderiza un documento @react-pdf y lo devuelve como descarga (D10). */
export async function pdfResponse(
  doc: ReactElement<DocumentProps>,
  filename: string
): Promise<Response> {
  const buffer = await renderToBuffer(doc);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** Sanea un texto para usarlo en el nombre de archivo. */
export function slugForFile(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'export'
  );
}

/** Tipo mínimo del traductor de next-intl que usan los documentos. */
export type Translator = (
  key: string,
  values?: Record<string, string | number>
) => string;
