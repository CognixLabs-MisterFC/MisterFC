import { AREA_TABS, allMenuFiles, type ChromeArea } from '@/nav/config';

/**
 * O2-4 PR-2 — Pantallas (nombres de ruta) que EXISTEN en un área: las de la
 * barra inferior + todas las del menú. El mapper de deep link (core) usa este
 * conjunto para caer en Inicio del área cuando el destino de un tipo no existe
 * en el área del usuario (p.ej. `convocatorias` no está en dirección). La fuente
 * de verdad de la navegación nativa vive en `nav/config`; aquí solo se aplana.
 */
export function availableScreensFor(area: ChromeArea): ReadonlySet<string> {
  return new Set<string>([
    ...AREA_TABS[area].map((tab) => tab.name),
    ...allMenuFiles(area).map((item) => item.name),
  ]);
}
