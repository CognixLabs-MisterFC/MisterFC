# Documentación de MisterFC

Esta carpeta contiene toda la documentación viva del proyecto: planificación, decisiones, especificaciones por subfase y arquitectura.

## Índice

- **[journey/](journey/)** — Plan maestro, progreso y retrospectivas.
  - [plan-maestro.md](journey/plan-maestro.md) — Plan vivo de las 17 fases. Fuente de verdad.
  - [progress.md](journey/progress.md) — Estado de cada fase.
  - [retros/](journey/retros/) — Retrospectivas mensuales.
- **[specs/](specs/)** — Specs por subfase del Plan. Crear antes de implementar features no triviales.
- **[decisions/](decisions/)** — ADRs (Architecture Decision Records). Inmutables: si una decisión cambia, crear un nuevo ADR que la supersede.
- **[architecture/](architecture/)** — Diagramas, modelos de datos, notas transversales.

## Cómo contribuir

1. Antes de empezar una subfase, lee `journey/plan-maestro.md`.
2. Si la subfase es no trivial, copia `specs/_template.md` → `specs/N.M-titulo.md` y rellénala.
3. Si tomas una decisión técnica con impacto, copia `decisions/_template.md` → `decisions/ADR-NNNN-titulo.md`.
4. Al cerrar la subfase, marca `[hecho YYYY-MM-DD]` en `journey/plan-maestro.md` y actualiza `journey/progress.md`.
