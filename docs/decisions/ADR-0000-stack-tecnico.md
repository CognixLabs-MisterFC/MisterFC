# ADR-0000 — Stack técnico de Ola 1

- **Status**: Accepted
- **Date**: 2026-05-27
- **Deciders**: Iker Milla
- **Related**: ADR-0001 (Supabase), ADR-0003 (monorepo + Ola 2 RN)

## Context

MisterFC arranca como proyecto greenfield con un solo desarrollador a tiempo parcial (2–3 h/día) y deadline de Ola 1 en septiembre 2026. Objetivos críticos:

- Ritmo sostenido — el stack debe minimizar fricción operativa.
- PWA instalable en iPad, Android y desktop como entrega de Ola 1.
- Lógica de negocio reutilizable en Ola 2 (app nativa Android/iOS) sin reescribir.
- Backend gratuito en la beta (sin facturación hasta que el primer club confirme).
- Observabilidad real desde el día uno (errores y trazas).
- TypeScript estricto, RLS estricta, CI verde en `main`.

El estándar técnico de los proyectos hermanos NIDO y VERTEX (Cognix Labs) se toma como referencia, ajustando solo donde el dominio justifica diferencias.

## Decision

Stack adoptado para Ola 1:

- **Monorepo**: Turborepo + pnpm workspaces.
- **`packages/core`**: TypeScript estricto, Zod, cliente Supabase, hooks reusables. **Agnóstico de framework** (sin imports de React/Next/Tailwind).
- **`apps/web`**: Next.js 16 App Router (Server Components por defecto), Tailwind v4, shadcn/ui (estilo New York, baseColor neutral), TS strict (`noUncheckedIndexedAccess` incluido).
- **i18n**: `next-intl` con locales `es` (default), `en`, `va` y rutas localizadas.
- **Backend**: Supabase Free (Postgres + Auth magic-link nativo + Storage + Edge Functions). Ver ADR-0001.
- **Observabilidad**: `@sentry/nextjs` con `beforeSend` que filtra PII, sample rate 100 % en dev, 10 % en producción.
- **Deploy**: Vercel (subdominio `misterfc.vercel.app` hasta que se asigne dominio propio).
- **CI/CD**: GitHub Actions (typecheck + lint + build de `apps/web` en cada PR).
- **Convenciones**: PR + squash merge, Conventional Commits, una rama por feature, spec antes de código en features no triviales.

## Consequences

**Positivas**

- Un solo lenguaje (TypeScript) en todo el stack — onboarding mínimo si entra otro dev.
- `packages/core` reusable tal cual desde `apps/native` (RN) en Ola 2 (ver ADR-0003).
- Supabase elimina la necesidad de construir auth, Storage, Edge Functions ni un Postgres gestionado en Ola 1.
- Sentry da visibilidad real desde la primera semana, sin esperar a tener usuarios.
- Vercel + GitHub Actions = deploys automáticos sin pipeline custom.
- Tailwind v4 + shadcn/ui = velocidad de iteración alta sin diseño bloqueante.

**Negativas**

- Acoplamiento a Vercel y Supabase como vendors. Mitigación: la lógica vive en `packages/core` con cliente Supabase encapsulado en una sola carpeta — un eventual swap no toca el resto del código.
- Next.js 16 es muy reciente (deprecaciones en marcha, ej. `middleware` → `proxy`). Mitigación: `docs/journey/known-issues.md` documenta divergencias y se cierra cuando el ecosistema (next-intl, Sentry, etc.) actualice.
- `packages/core` exige disciplina para mantenerse agnóstico de framework. Mitigación: ESLint rule futura + revisión en cada PR.

**Neutras**

- shadcn/ui se copia al repo en lugar de instalarse — versionado explícito, sin upgrades automáticos.

## Alternatives considered

- **Remix / Tanstack Start**: SSR sólido, pero menos ecosistema PWA y menor afinidad con la cuenta Vercel del autor. Descartado por inercia operativa.
- **SvelteKit**: ergonomía atractiva, pero salir del stack React rompe la reusabilidad con Ola 2 RN (`packages/core` solo tiene sentido si UI vive en React también en RN). Descartado.
- **Firebase**: alternativa madura a Supabase pero con vendor lock-in más profundo (Firestore ≠ Postgres) y peor ergonomía para RLS granular sobre datos relacionales (club → categoría → equipo → jugador). Descartado a favor de Supabase. Ver ADR-0001.
- **Auth0 / Clerk**: auth gestionada, pero pago desde tier free pequeño y dependencia adicional para algo que Supabase ya ofrece con magic-link nativo. Descartado.
- **Tailwind v3 + Radix manual**: estable pero más boilerplate. v4 + shadcn/ui acelera UI sin sacrificar control.
