# MisterFC

> Plataforma de gestión, metodología y desarrollo deportivo para entrenadores de fútbol base y amateur. Cognix Labs.

Monorepo gestionado con **Turborepo + pnpm workspaces**.

## Estructura

```
misterfc/
├── apps/
│   └── web/             Next.js 16 (App Router) + Tailwind v4 + shadcn/ui — PWA
└── packages/
    └── core/            Lógica compartida agnóstica de framework (TS + Zod + Supabase)
```

`packages/core` se reusa desde `apps/web` (Ola 1) y se reusará desde `apps/native` (RN, Ola 2) sin modificación.

## Requisitos

- Node 20+
- pnpm 10+
- direnv (recomendado para `.envrc` + variables locales)

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # rellena las claves reales
direnv allow                                    # carga .envrc
pnpm dev                                        # arranca apps/web
```

## Comandos comunes

```bash
pnpm dev                          # apps/web en local
pnpm typecheck                    # tsc --noEmit en todo el monorepo
pnpm lint                         # eslint
pnpm format                       # prettier --write
pnpm --filter web build           # build de Next.js
```

## Documentación

- [Plan Maestro](docs/journey/plan-maestro.md) — fuente de verdad del roadmap.
- [Progreso](docs/journey/progress.md) — estado de cada fase.
- [ADRs](docs/decisions/) — decisiones técnicas.
- [Specs](docs/specs/) — specs por subfase.
- [Reglas operativas](\_bootstrap/CLAUDE.md) — convenciones permanentes.

## Licencia

UNLICENSED — Cognix Labs.
