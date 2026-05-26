# ADR-0003 — Monorepo + estrategia Ola 2 con React Native

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Iker Milla
- **Related**: ADR-0000 (stack técnico)

## Context

MisterFC tiene dos olas de entrega:

- **Ola 1**: PWA instalable en iPad, Android y desktop como `apps/web` (Next.js 16). Sept 2026.
- **Ola 2**: app nativa Android + iOS publicada en App Store y Google Play una vez validada Ola 1.

La pregunta es cómo organizar el código desde el día uno para que Ola 2 no implique reescribir Ola 1, y para que ambas olas convivan sin divergir.

Dos features de Ola 1 hacen que la calidad nativa importe en Ola 2:

- **F7 — Toma de datos en directo del partido**: pantalla con tap rápido, gestures, latencia mínima, offline parcial. PWA cumple en iPad/desktop pero pierde la mitad del UX en móvil.
- **F12 — Pizarra táctica 2D con animación**: gestures multitouch (drag de jugadores, pinch para zoom, path animado). Reanimated 3 + gesture-handler de RN da calidad nativa real; el equivalente web es alcanzable pero costoso.

Wrappers tipo Capacitor envuelven la PWA en un WebView nativo. Funciona pero no resuelve los puntos anteriores: la pizarra y la toma de datos quedan capadas por el rendimiento del WebView en hardware modesto (iPad antiguo del entrenador).

## Decision

**Monorepo Turborepo con `packages/core` agnóstico de framework, y Ola 2 implementada como `apps/native` con React Native + Reanimated 3 + gesture-handler.**

### Estructura del monorepo

```
misterfc/
├── apps/
│   ├── web/        Next.js 16 (Ola 1)
│   └── native/     React Native (Ola 2)
└── packages/
    └── core/       TS + Zod + Supabase + hooks reusables
                    Agnóstico de framework: cero imports de React/Next/RN/Tailwind
```

### Reglas de `packages/core`

- **Sin imports de UI**: no `react`, no `react-native`, no `next`, no `tailwindcss`, no `@radix-ui`.
- **Sí permitidos**: `@supabase/supabase-js`, `@supabase/ssr` (pasando cookie adapter inyectado), `zod`, librerías puras de utilidades (date-fns, etc.).
- **Hooks compartidos**: si llega a haber hooks que dependan de React (no Next), pueden vivir en `packages/core/src/hooks/` porque RN también es React. Pero **nunca** dependen de Next.js o Tailwind.
- El cookie adapter de Supabase server-side se inyecta desde fuera: `apps/web` usa `next/headers`, `apps/native` (si llega a necesitar SSR) usa el suyo.

### Ola 2 reusará sin tocar

- Schemas Zod, validaciones, helpers de fechas/temporadas.
- Tipos `Database` generados por Supabase CLI.
- Cliente Supabase (browser → RN nativo; server queda fuera).
- Lógica de cálculo de evolución multi-temporada, agregaciones para dashboard, etc.

### Ola 2 reescribirá UI

- Toda la capa visual: pantallas, navegación (Expo Router / React Navigation), gestures, animaciones.
- Adaptaciones de la pizarra táctica con Reanimated 3 + gesture-handler.

## Consequences

**Positivas**

- Sin reescritura de lógica de negocio al pasar a nativo — solo UI.
- Disciplina forzada desde Ola 1: si algo no encaja en `packages/core` agnóstico, se nota antes (en code review del propio autor).
- La pizarra y la toma de datos en directo tendrán calidad nativa real sin parches sobre WebView.
- Ambas apps comparten contratos con backend (Zod schemas) — un cambio de schema obliga a actualizar core, y ambos clientes lo recogen.

**Negativas**

- Disciplina requerida: cualquier import accidental de `react`/`next`/`tailwind` en `packages/core` rompe la promesa. Mitigación: ESLint rule en una subfase futura (`no-restricted-imports`) + revisión manual hasta entonces.
- Ola 2 es trabajo nuevo (50–70 h estimadas) — no es “free”. Pero es trabajo *menor* que rehacer Ola 1 en nativo de cero.
- Turborepo añade complejidad de build (cache, pipelines) que en un single-app no haría falta. Coste asumible.

**Neutras**

- `apps/native` se crea en Ola 2, no ahora. En Ola 1 el monorepo tiene un solo `app` activo (`web`) más `packages/core`.

## Alternatives considered

- **Capacitor (PWA en WebView nativo)**: 1–2 semanas para publicar en stores vs. 50–70 h de RN. Pero la pizarra y la toma de datos quedan capadas por el WebView en hardware modesto (iPad antiguo). Descartado por **calidad de las features F7 y F12**.
- **PWA pura sin Ola 2**: Apple ya permite instalar PWAs en iOS; ¿hace falta nativo? Sí: push notifications fiables, gestures de la pizarra, App Store presence (legitimidad ante clubes), modo offline real en F7. Descartado.
- **Flutter en lugar de RN**: stack distinto (Dart), no reusa `packages/core` (que es TS). Implica mantener dos lenguajes en paralelo (TS para web, Dart para nativo) y duplicar schemas. Descartado.
- **`apps/native` con Expo (managed)**: probable elección concreta dentro de RN cuando arranque Ola 2. Esta ADR no decide “Expo vs bare RN” todavía — se documentará en su propio ADR cuando se aborde Ola 2.
- **Single repo sin Turborepo (solo pnpm workspaces)**: viable, pero Turborepo da cache de tasks (typecheck/lint/build) que acelera CI cuando crezca el monorepo. Coste de adopción bajo. Aceptado.
