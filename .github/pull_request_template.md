## Descripción

<!-- Qué se hizo y por qué. 2-4 frases. Evita repetir el título. -->

## Subfase del Plan

<!-- Ejemplo: 2.4 — Vínculo cuenta padre/jugador. Enlaza la entrada relevante de docs/journey/plan-maestro.md si aplica. -->

## Cambios clave

<!-- Lista corta de archivos o áreas modificadas (no necesita ser exhaustiva). -->

-
-

## Cómo probar

<!-- Pasos manuales o comandos para verificar localmente, además de la CI. -->

1.
2.

## Checklist

- [ ] `pnpm typecheck` pasa
- [ ] `pnpm lint` pasa sin warnings
- [ ] `pnpm test` pasa (si hay tests aplicables)
- [ ] `pnpm --filter web build` pasa
- [ ] Spec actualizada en `docs/specs/` (si la subfase es no trivial)
- [ ] ADR creado o actualizado (si hay decisión técnica con impacto)
- [ ] Subfase marcada como `[hecho YYYY-MM-DD]` en `docs/journey/plan-maestro.md`
- [ ] Sin secretos en el diff

## Notas / riesgos

<!-- Cosas a tener en cuenta: decisiones tomadas en el camino, deuda introducida, follow-ups. -->
