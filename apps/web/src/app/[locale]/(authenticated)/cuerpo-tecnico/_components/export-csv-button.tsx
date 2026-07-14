'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * E-7b — Exportar CSV del cuerpo técnico (vista dirección). Cliente puro: recibe
 * cabeceras + filas YA construidas y traducidas server-side (respetan el scope y el
 * filtro por equipo activos, porque provienen del conjunto visible del loader). Solo
 * arma el Blob y dispara la descarga (molde import-wizard). Sin datos de negocio aquí.
 */
type Props = {
  filename: string;
  headers: string[];
  rows: string[][];
  label: string;
};

/** Escapa un campo CSV: entrecomilla si contiene coma, comilla o salto de línea. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function ExportCsvButton({ filename, headers, rows, label }: Props) {
  function onExport() {
    const lines = [headers, ...rows].map((cols) =>
      cols.map(csvField).join(','),
    );
    // BOM para que Excel abra bien los acentos.
    const blob = new Blob(['﻿' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onExport}
      disabled={rows.length === 0}
    >
      <Download className="size-4" aria-hidden />
      <span>{label}</span>
    </Button>
  );
}
