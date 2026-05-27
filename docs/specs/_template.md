# Spec N.M — Título de la subfase

> Subfase del Plan Maestro: **N.M — Nombre exacto**.
> Estado: ☐ pendiente · ⟳ en curso · ☑ completada
> Autor: Iker Milla
> Fecha de creación: YYYY-MM-DD

---

## 1. Contexto

Por qué hacemos esto ahora. Qué problema resuelve. Qué dependencias previas se han cubierto en subfases anteriores.

## 2. Objetivos

- Objetivo principal medible y verificable.
- Sub-objetivos secundarios (opcional).

## 3. Fuera de alcance

Lo que **no** se va a hacer en esta subfase para no inflar el scope. Cualquier cosa marcada aquí se aborda en una subfase posterior o en una Ola futura.

## 4. Modelo de datos afectado

Tablas Supabase nuevas o modificadas. Relaciones. RLS. Tipos generados que cambian. Migraciones.

```sql
-- ejemplo
```

## 5. UI

Vistas/pantallas afectadas, componentes nuevos, navegación. Diagramas o wireframes si aplican.

## 6. Estados, validaciones y errores

Estados vacíos, estados de carga, errores esperados, edge cases. Validaciones Zod en `packages/core/src/schemas/`.

## 7. Tests

- Unit (Vitest).
- Integración (si aplica).
- RLS (pgTAP) para tablas con datos sensibles.
- E2E (Playwright) en subfases relevantes a partir de Fase 14.

## 8. Notas de implementación

Decisiones tomadas durante la implementación que merezcan dejar por escrito. Si la decisión tiene impacto arquitectural, abrir un ADR en `docs/decisions/`.

## 9. Cierre

- Marca esta subfase como `[hecho YYYY-MM-DD]` en `docs/journey/plan-maestro.md`.
- Actualiza `docs/journey/progress.md`.
- Si cerró una fase completa, marca la fase como ☑.
