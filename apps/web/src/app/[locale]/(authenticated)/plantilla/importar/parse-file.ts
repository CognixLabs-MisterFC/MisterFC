'use client';

import Papa from 'papaparse';
import { readSheet, type SheetData } from 'read-excel-file/browser';
import {
  parseTabular,
  MAX_IMPORT_ROWS,
  type ParsedTabular,
  type ParseTabularError,
} from '@misterfc/core';

const CSV_EXTENSIONS = ['.csv'];
const XLSX_EXTENSIONS = ['.xlsx', '.xls'];
const MAX_BYTES = 5 * 1024 * 1024;

export type ParseFileError =
  | { code: 'too_large' }
  | { code: 'unsupported_type' }
  | { code: 'parse_failed'; detail?: string }
  | { code: 'too_many_rows'; count: number; max: number }
  | ParseTabularError;

export type ParseFileResult =
  | { ok: true; data: ParsedTabular }
  | { ok: false; error: ParseFileError };

/**
 * Punto único de entrada en cliente: detecta el tipo por extensión, decide
 * parser, normaliza headers vía `parseTabular` del core.
 *
 * No exponemos el archivo crudo al server — el parsing entero corre en el
 * cliente para no arrastrar SheetJS al bundle del Node runtime.
 */
export async function parseFile(file: File): Promise<ParseFileResult> {
  if (file.size > MAX_BYTES) return { ok: false, error: { code: 'too_large' } };

  const name = file.name.toLowerCase();
  const isCsv = CSV_EXTENSIONS.some((e) => name.endsWith(e));
  const isXlsx = XLSX_EXTENSIONS.some((e) => name.endsWith(e));
  if (!isCsv && !isXlsx) {
    return { ok: false, error: { code: 'unsupported_type' } };
  }

  try {
    const rawRows = isCsv ? await parseCsv(file) : await parseXlsx(file);
    const result = parseTabular(rawRows);
    if (!result.ok) return { ok: false, error: result.error };
    // F14K-3 — tope de 100 jugadores por importación (rechazo temprano, antes de
    // crear nada). Garantiza que un import nunca genera >100 emails. El server
    // reimpone el límite (playerImportPayloadSchema) por si se salta el cliente.
    if (result.data.rows.length > MAX_IMPORT_ROWS) {
      return {
        ok: false,
        error: {
          code: 'too_many_rows',
          count: result.data.rows.length,
          max: MAX_IMPORT_ROWS,
        },
      };
    }
    return { ok: true, data: result.data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: 'parse_failed', detail: message } };
  }
}

async function parseCsv(file: File): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    });
  });
}

async function parseXlsx(file: File): Promise<Array<Record<string, unknown>>> {
  // read-excel-file devuelve la hoja indicada. Probamos primero "jugadores"
  // (nombre de la plantilla que generamos); si no existe caemos a la
  // primera (índice 1, que es como esta lib indexa).
  let sheet: SheetData;
  try {
    sheet = await readSheet(file, 'jugadores');
  } catch {
    sheet = await readSheet(file, 1);
  }

  if (sheet.length === 0) return [];
  const headers = (sheet[0] ?? []).map((h) =>
    String(h ?? '').trim()
  );
  const body = sheet.slice(1);
  return body.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h.length === 0) return;
      const cell = row[i];
      obj[h] =
        cell instanceof Date ? cell.toISOString().slice(0, 10) : cell;
    });
    return obj;
  });
}
