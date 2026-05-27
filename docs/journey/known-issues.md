# Known Issues

Cosas detectadas mientras se trabaja en otra cosa. No mezclar en su PR original; abordar en su propio PR.

## Activas

### Next.js 16 — deprecación de `middleware.ts` a favor de `proxy.ts`
- **Detectado en**: Fase 0 (subfase 0.5).
- **Mensaje**: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
- **Impacto**: solo warning de build, no rompe. La convención cambia de nombre en Next.js 16+; la API es la misma.
- **Plan**: renombrar `apps/web/src/middleware.ts` → `apps/web/src/proxy.ts` en una subfase futura cuando next-intl haya actualizado sus docs/ejemplos a la nueva convención, para no divergir innecesariamente.

## Resueltas

_(vacío todavía)_
