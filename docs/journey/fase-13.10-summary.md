# Fase 13.10 — Informes de desarrollo y campaña de evaluaciones (summary)

> **Cerrada 2026-06-25.** PRs **#200–#221** (16 subfases). Spec retroactiva: [docs/specs/13.10-informes-desarrollo.md](../specs/13.10-informes-desarrollo.md).

> ⚠️ **Numeración (Opción C).** "F13.10" es una etiqueta heredada del desarrollo; **NO** es parte de la **F13 — Pizarra de jugadas** (13.1–13.8, sigue ☐ pendiente, sin construir). F13.10 es una **extensión de F8/F9**: el informe de desarrollo periódico del jugador + la campaña que lo coordina. Se conserva el nombre por trazabilidad con los 22 PRs/ramas/memory. No se renumera nada.

## Objetivo

Informe de desarrollo periódico (por **jugador × temporada × periodo**, periodos `inicial`/`diciembre`/`marzo`/`junio`): valoración cualitativa individual + valoración de equipo + objetivos + estadísticas + gráficos de evolución, consultable como **ficha** web y como **PDF**, y coordinado a nivel club mediante una **campaña de evaluaciones** (fijar fecha límite → lanzar → publicar en masa a familias).

## Alcance entregado (subfases + PR)

| Subfase | Fecha | PR | Entrega |
|---|---|---|---|
| 13.10a | 2026-06-23 | #200 | Modelo `development_reports` + `*_objectives` + RLS base |
| 13.10b | 2026-06-23 | #203 | Rework del modelo a equipo + individual sobre catálogo JSON |
| 13.10b | 2026-06-23 | #204 | Editor real del informe (equipo + individual) |
| 13.10c | 2026-06-23 | #205 | Pantalla de informes a nivel equipo (tabla equipo + jugadores) |
| 13.10d | 2026-06-24 | #206 | Rediseño visual de la ficha + gráfico de evolución |
| 13.10d | 2026-06-24 | #207 | Compartir informe con la familia: RLS + publicar + notificar |
| 13.10d | 2026-06-24 | #209 | Separar el informe de `/mi-ficha` (ruta + nav propios) |
| 13.10e | 2026-06-24 | #210 | PDF inicial del informe (jugador × temporada × periodo) |
| 13.10g-GB | 2026-06-24 | #213 | Campaña: card en Plantilla + centro de mando + lanzar + alerta |
| 13.10g-GC | 2026-06-25 | #214 | Publicación masiva de la campaña (RPC `publish_campaign`) |
| 13.10g-GD | 2026-06-25 | #215 | Alerta a ≤7 días de la fecha límite (urgencia in-app) → cierra F13.10g |
| 13.10h-1 | 2026-06-25 | #216 | Objetivos: estados derivados + comentario de revisión (modelo) |
| 13.10h-2 | 2026-06-25 | #217 | Reorden de la ficha a 7 secciones + estados en el editor |
| 13.10h-3 | 2026-06-25 | #218 | Gráfico de evolución de EQUIPO (sección 5) |
| 13.10h-4 | 2026-06-25 | #219 | Estadísticas como ratio en la ficha (convocados/total, entrenos/total) |
| 13.10h-PDF-1+2 | 2026-06-25 | #220 | PDF alineado a 7 secciones + gráficos SVG nativos |
| 13.10h-PDF-3 | 2026-06-25 | #221 | Segregación Oficial/Amistoso en el PDF → cierra F13.10h |

## Migraciones (todas aplicadas al remoto vía `pnpm db:push`)

`20260727000000_development_reports` · `…_notification_type_development_report_published` · `20260728000000_development_reports_rework` · `20260730000000_development_reports_share` · `20260801000000_assessment_campaigns` · `…_notification_type_evaluation_campaign_launched` · `20260803000000_publish_campaign` · `20260804000000_objectives_review_comment`. Todas **append-only** (pgTAP escrito; verificación efectiva al aplicar contra el remoto — F15.8 sigue vigente).

## Decisiones técnicas

- **Gráficos del PDF como SVG nativo** (radar + líneas de evolución con `@react-pdf` Svg, huecos vía `smoothPathD`) — **revierte la antigua D10 "PDF solo tablas"**.
- **Ficha y PDF a 7 secciones** en orden fijo.
- **Objetivos con estado derivado** (`objectiveDisplayState`: `open/achieved/dropped` + `created_period` → `nuevo/en_proceso/conseguido/descartado`) sobre `status` crudo; **2 comentarios** por objetivo (proyección `description` + revisión `review_comment`); `created_period` inmutable.
- **Estadísticas como ratio** (denominadores desde `events` del equipo en la temporada).
- **PDF**: partidos segregados **Oficial** (`match`+`tournament`) vs **Amistoso** (`friendly`); convocatorias y entrenos como totales.
- **Evolución de equipo para la familia** limitada por RLS (`user_can_see_team_report_via_published`).

## Diferidos

- **F13B — Gestión de partidos** (NUEVO): liga/copa (`competition_type`) en stats+PDF + sección **no-convocatorias (H-5)** con decisión pendiente (Opción 1 sin migración / Opción 2 con migración) + mini-análisis. En backlog de [plan-maestro.md](plan-maestro.md).
- **Reutilizar jugadores entre equipos** (NUEVO): mover/compartir un jugador sin recrearlo — pendiente de mini-análisis. En backlog.
- **Revalidar ratios de familia si F14.10** cierra `events_select` por equipo — en [known-issues.md](known-issues.md).

## Lecciones

- La verificación de RLS/funciones SECURITY DEFINER siguió dependiendo de aplicar la migración contra el remoto (pgTAP sin CI, **F15.8**). Cada subfase que tocó BD añade superficie no testeada en pipeline.
- La etiqueta "F13.10" colisionando con F13-pizarra generó deuda documental: toda la serie #200–#221 quedó **fuera de los docs** hasta este cierre. Lección: registrar la fase en `progress.md`/`plan-maestro.md` **al abrirla**, no al cerrarla.
