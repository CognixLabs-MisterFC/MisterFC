- **Status**: Accepted
- **Date**: 2026-06-08
- **Deciders**: Iker Milla
- **Related**: Fase 9 del Plan Maestro, `docs/specs/9.0-perfil-jugador.md` (§7 9.3, §11), ADR-0000 (stack)

# ADR-0016 — Librería de gráficos del cliente: recharts

## Context

F9.3 (evolución intra-temporada de la valoración del jugador) introduce **el primer gráfico** del proyecto: una línea del rating 1-10 partido a partido. Hasta ahora no había ninguna dependencia de visualización. La elección marca la librería para los gráficos que vienen (F9.4 multi-temporada, F10 dashboard del club, futuros reportes), así que se fija como ADR.

Requisitos: API React declarativa, responsive, **SSR-friendly** (Next 16 App Router + React 19), y **salida SVG** (para que el futuro reporte PDF —9.7/9.8— pueda serializar/imprimir el gráfico). Peso razonable; el build de CI tiene un OOM conocido, así que el coste de bundle/SSR importa.

Opciones consideradas: recharts, visx, Chart.js (+react-chartjs-2), victory, nivo.

## Decision

**recharts** (`^2.15.4`, en `apps/web`).

- API declarativa de componentes (`<LineChart>`, `<Line>`, `<XAxis>`, `<ResponsiveContainer>`, `<Tooltip>`) → encaja con React sin imperatividad.
- **SVG**, no canvas → se imprime y serializa bien para el PDF del segundo tramo (patrón "la pantalla ES el reporte", spec §9).
- Compatible con **React 19** desde la 2.15 (se fija 2.15.4, rama 2.x madura y estable, en vez de 3.x para minimizar churn de API en el primer uso).
- Cubre de sobra lo que pide 9.3 (una/dos líneas con eje 1-10 + tooltip + leyenda).

### Mitigación del OOM de build

El gráfico se monta con **`next/dynamic(..., { ssr: false })`**: recharts (+ módulos d3) queda **fuera del bundle de servidor y del render SSR**, reduciendo memoria de build y evitando los warnings de `ResponsiveContainer` sin tamaño en SSR. Solo se carga en cliente cuando la ficha del jugador se ve.

## Consequences

### Positivas

- Gráficos declarativos y reutilizables; el mismo componente sirve a la vista staff (9.3) y a la de jugador/familia (9.5).
- SVG listo para el PDF futuro sin reescritura.
- `ssr:false` acota el impacto en el build (OOM) y en el bundle de servidor.

### Negativas / coste asumido

- +34 paquetes transitivos (recharts arrastra módulos de d3). Bundle de cliente mayor en las rutas que usan el gráfico (mitigado: carga dinámica solo donde se usa).
- Si más adelante se necesita un gráfico muy a medida, recharts es menos flexible que visx; se reevaluaría puntualmente (no cambia esta decisión por defecto).

## Alternatives considered

- **visx**: bajo nivel (construir ejes/tooltips a mano) → demasiado código para una línea.
- **Chart.js / react-chartjs-2**: canvas → peor para imprimir/serializar a PDF y menos idiomático en React.
- **victory**: bundle mayor y SSR más quisquilloso.
- **nivo**: pesado y orientado a dashboards; sobra para esto.

## Referencias

- spec `docs/specs/9.0-perfil-jugador.md` (§7 9.3, §11).
- componente `apps/web/src/app/[locale]/(authenticated)/jugadores/[playerId]/rating-evolution-chart.tsx`.
