# MisterFC — Bootstrap PROMPT (Fase 0 completa)

> **Para Claude Code**: este documento es el prompt único para cerrar las 12 subfases de la Fase 0 del Plan Maestro de MisterFC. Léelo entero antes de empezar, lee también `_bootstrap/CLAUDE.md` (reglas operativas permanentes), y solo entonces ejecuta.

---

## 1. Contexto del proyecto

**Producto**: **MisterFC** — Plataforma de gestión, metodología y desarrollo deportivo para entrenadores de fútbol base y amateur. Cognix Labs.

**Estado actual**: proyecto greenfield. Repo `CognixLabs-MisterFC/MisterFC` creado en GitHub pero vacío. La carpeta local `~/Claude Code/APP MisterFC/misterfc/` contiene únicamente esta subcarpeta `_bootstrap/` con dos archivos: este `PROMPT.md` y `CLAUDE.md`.

**Stack** (decidido en ADR-0000):

- **Monorepo**: Turborepo + pnpm workspaces
- **`packages/core`**: lógica de negocio compartible (TypeScript estricto, Zod, cliente Supabase, hooks reusables, tipos generados). Pensado para ser reusado por `apps/native` en Ola 2 (React Native).
- **`apps/web`**: Next.js 14+ App Router + TS strict + Tailwind v4 + shadcn/ui + PWA (manifest + service worker básico). Single source of truth en Ola 1.
- **Backend**: Supabase Free (Postgres + Auth con magic link nativo + Storage + Edge Functions cuando aplique). RLS estricta desde el día uno.
- **Auth**: magic link de Supabase Auth. Sin Resend, sin emails transaccionales propios.
- **Observabilidad**: Sentry para Next.js (DSN en `.env.local`).
- **Deploy**: Vercel (subdominio `misterfc.vercel.app` inicialmente, sin dominio propio).
- **CI/CD**: GitHub Actions (typecheck + lint + build en cada PR).
- **i18n**: `es` (default), `en`, `va` (valenciano).

**Owner / Author**: Iker Milla &lt;jovimib@gmail.com&gt;
**Cuenta GitHub que administra `CognixLabs-MisterFC`**: `CognixLabs-Nido` (la misma que administra NIDO).

**Convenciones operativas**: `_bootstrap/CLAUDE.md` en este mismo directorio. Léelo antes de empezar y respétalo en todo momento.

---

## 2. Pre-flight (antes de tocar nada)

Ejecuta estos checks y avisa al usuario si algo no cuadra:

```bash
# Directorio de trabajo
pwd
# Debe ser: /home/jovimib/Claude Code/APP MisterFC/misterfc
# Si no, cd allí.

# Cuenta GitHub activa
gh auth status
# Si la cuenta activa no es CognixLabs-Nido, ejecuta:
gh auth switch --user CognixLabs-Nido

# Contenido de la carpeta
ls -la
# Debe haber solo _bootstrap/ con PROMPT.md y CLAUDE.md. Si hay más cosas, parar.

# Si ya existe .git, parar y avisar
[ -d .git ] && echo "WARN: .git ya existe, parar" || echo "OK: sin git inicializado"

# Versión de pnpm
pnpm --version
# Si no está instalado: npm install -g pnpm
```

Confirma con el usuario antes de continuar que tiene a mano (en su gestor de contraseñas) los siguientes valores, **que no necesitas para Fase 0** (vas a generar el `.env.example` template, el usuario rellenará `.env.local` después):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`

---

## 3. Plan de ejecución

1. Crea rama `feat/fase-0-bootstrap` desde main.
2. Ejecuta las 12 subfases en orden con commits convencionales por subfase.
3. Al terminar, abre un único PR como **draft** y avisa al usuario para revisión.
4. Al mergear el PR (lo hace el usuario, no tú), Fase 0 queda cerrada.

---

## 4. Subfases

### 0.1 — Inicializar el repositorio local + identidad

```bash
git init --initial-branch=main
git config user.name "Iker Milla"
git config user.email "jovimib@gmail.com"
git remote add origin https://github.com/CognixLabs-MisterFC/MisterFC.git
git fetch origin || true   # repo vacío, no debe fallar
git checkout -b feat/fase-0-bootstrap
```

Crea `.gitignore` raíz con: `node_modules/`, `.next/`, `dist/`, `*.log`, `.env`, `.env.local`, `.env*.local`, `.envrc.local`, `.DS_Store`, `.vercel/`, `.turbo/`, `coverage/`, `*.pem`.

**Commit**: `chore(0.1): init repo + .gitignore`

### 0.2 — Estructura `docs/` + plantillas

Crea:

```
docs/
├── specs/
│   ├── _template.md
│   └── README.md
├── decisions/
│   ├── _template.md
│   └── README.md
├── architecture/
│   └── README.md
├── journey/
│   ├── plan-maestro.md           ← se rellena en 0.11
│   ├── progress.md
│   └── retros/
│       └── _template.md
└── README.md
```

- `docs/specs/_template.md`: plantilla de spec con secciones Contexto, Objetivos, Modelo de datos afectado, UI, Estados, Tests, Notas de implementación.
- `docs/decisions/_template.md`: plantilla ADR (Status, Context, Decision, Consequences, Alternatives considered).
- `docs/journey/retros/_template.md`: plantilla retro mensual (Qué fue bien, qué no, decisiones, próximas acciones).
- `docs/journey/progress.md`: tabla de las 17 fases con estado inicial **☐ pendiente** para todas.
- `docs/README.md`: índice navegable.

**Commit**: `docs(0.2): estructura docs/ + plantillas spec/ADR/retro`

### 0.3 — Scaffold Turborepo monorepo (packages/core + apps/web)

```bash
# pnpm-workspace.yaml en raíz
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

# turbo.json
# package.json raíz con dependencies de turbo, scripts comunes (dev, build, lint, typecheck)
```

Crea estructura:

```
apps/
└── web/             ← Next.js 14 App Router (lo haces en 0.4)
packages/
└── core/
    ├── src/
    │   ├── types/            ← tipos compartidos (Database, models)
    │   ├── schemas/          ← Zod schemas
    │   ├── supabase/         ← cliente Supabase (browser + server)
    │   ├── hooks/            ← hooks reusables (preparados para RN)
    │   └── index.ts
    ├── package.json          ← nombre @misterfc/core
    └── tsconfig.json
```

**Importante**: `packages/core` debe ser **agnóstico de framework** — sin imports de React, Next.js ni nada de UI. Solo lógica pura. Esto es lo que permite reusarlo desde `apps/native` (RN) en Ola 2 sin reescribir.

**Commit**: `chore(0.3): scaffold Turborepo monorepo + packages/core`

### 0.4 — apps/web: Next.js 14 + TS strict + Tailwind v4 + shadcn/ui

Dentro de `apps/web/`:

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --turbopack=false
```

- TS strict: `tsconfig.json` con `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noUnusedLocals": true`.
- Tailwind v4 con `@import "tailwindcss"` en `app/globals.css`.
- shadcn/ui:
  ```bash
  pnpm dlx shadcn@latest init
  ```
  Defaults: New York style, neutral, CSS variables.
- Vincula `@misterfc/core` como dependencia local: `"@misterfc/core": "workspace:*"`.
- Configura `next.config.mjs` con `transpilePackages: ["@misterfc/core"]`.

Página inicial mínima en `app/page.tsx`: solo un hero con `MisterFC` y la marca verde, sin lógica. Comprueba que el build pasa.

**Commit**: `feat(0.4): apps/web Next.js + Tailwind + shadcn/ui + vínculo packages/core`

### 0.5 — i18n con next-intl (es / en / va)

- `pnpm add next-intl` en `apps/web`.
- Estructura `messages/` en raíz del repo (compartible):
  ```
  messages/
  ├── es.json    (default)
  ├── en.json
  └── va.json
  ```
- Cada JSON con keys de prueba mínimas (`common.welcome`, `common.app_name`).
- Middleware `apps/web/src/middleware.ts` configurado para rutas localizadas (`/es`, `/en`, `/va`). Default locale: `es`.
- Helper `useTranslations` funcionando en la home.

**Commit**: `feat(0.5): i18n next-intl con es/en/va`

### 0.6 — Cliente Supabase en packages/core

Sin instalar Supabase CLI todavía (eso queda para Fase 1). Solo el SDK del cliente:

```bash
pnpm --filter @misterfc/core add @supabase/supabase-js @supabase/ssr
```

En `packages/core/src/supabase/`:

- `client-browser.ts`: cliente para uso en cliente (Next.js client components).
- `client-server.ts`: cliente para Server Components + middleware con `@supabase/ssr`.
- `types.ts`: placeholder de `Database` type. Se genera de verdad en Fase 1 con `supabase gen types`.

Exporta desde `packages/core/src/index.ts`.

**Commit**: `feat(0.6): cliente Supabase en packages/core (sin schema todavía)`

### 0.7 — Sentry SDK para Next.js

```bash
pnpm --filter web add @sentry/nextjs
pnpm --filter web exec npx @sentry/wizard@latest -i nextjs --skip-connect
```

(No conectes a la cuenta Sentry desde el wizard; el usuario rellenará el DSN en `.env.local` manualmente.)

Configura:

- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` en `apps/web/`.
- Lee `NEXT_PUBLIC_SENTRY_DSN` desde env.
- Filtra PII en `beforeSend` (sin emails, sin contenido de mensajes).
- Sample rate del 100 % en desarrollo, 10 % en producción.

**Commit**: `feat(0.7): Sentry SDK integrado (DSN se rellena en .env.local)`

### 0.8 — PWA manifest + service worker básico

En `apps/web/public/`:

- `manifest.json` con nombre "MisterFC", short name "MisterFC", `theme_color: "#0F1B2E"`, `background_color: "#0F1B2E"`, display: standalone, start_url: "/", iconos 192 y 512 (placeholders por ahora).
- Service worker mínimo (`sw.js`) para cache de assets estáticos. Sin lógica de offline avanzada todavía.

En `apps/web/src/app/layout.tsx`: linkea manifest y registra el SW.

**Commit**: `feat(0.8): PWA manifest + service worker básico`

### 0.9 — GitHub Actions CI

Crea `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm --filter web build
```

Crea también `.github/pull_request_template.md` mínimo (Descripción, Subfase del Plan, Checklist: typecheck/lint/tests/docs).

**Commit**: `chore(0.9): GitHub Actions CI + PR template`

### 0.10 — direnv .envrc + .env.example

Crea `.envrc` en la raíz:

```bash
# Cambia a la cuenta GitHub correcta automáticamente
if command -v gh >/dev/null; then
  gh auth switch --user CognixLabs-Nido 2>/dev/null || true
fi

# Identidad git per-repo
export GIT_AUTHOR_NAME="Iker Milla"
export GIT_AUTHOR_EMAIL="jovimib@gmail.com"
export GIT_COMMITTER_NAME="Iker Milla"
export GIT_COMMITTER_EMAIL="jovimib@gmail.com"

# Carga .env.local si existe
[ -f .env.local ] && dotenv .env.local
```

Crea `apps/web/.env.example`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Sentry
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=mister-fc
SENTRY_PROJECT=misterfc-web
SENTRY_AUTH_TOKEN=
```

Pide al usuario que ejecute `direnv allow` después de pull para activar el `.envrc`.

**Commit**: `chore(0.10): direnv .envrc + .env.example`

### 0.11 — Plan Maestro como Markdown

Copia el contenido del documento Word `Plan-Maestro-MisterFC.docx` (lo tiene el usuario en su carpeta de outputs) a `docs/journey/plan-maestro.md` en formato Markdown. Si el usuario no te lo pasa, pídeselo. El plan vivo se mantiene en este archivo: cada subfase cerrada se marca como `[hecho YYYY-MM-DD]`.

Actualiza también `docs/journey/progress.md` con la tabla de las 17 fases. La Fase 0 quedará marcada como **⟳ en curso** mientras se ejecuta este PR, y al mergearlo el usuario la marcará como **☑ completada**.

**Commit**: `docs(0.11): commit Plan Maestro MisterFC como Markdown`

### 0.12 — ADRs 0000 a 0003

Crea en `docs/decisions/`:

- **ADR-0000-stack-tecnico.md**: stack elegido (Turborepo, Next.js, Supabase, Sentry, Vercel, i18n). Alternativas consideradas (Remix, SvelteKit, Firebase, Auth0). Razones.
- **ADR-0001-supabase-como-backend.md**: Supabase Free como backend. Limitaciones conocidas (1 proyecto activo, 500 MB DB). Plan de migración a Pro si se necesita.
- **ADR-0002-modelo-roles-capabilities.md**: 5 roles (admin_club, coordinador, entrenador_principal, entrenador_ayudante, jugador). Capabilities configurables del ayudante. Cuentas múltiples por jugador vía `player_accounts`.
- **ADR-0003-monorepo-y-ola-2-rn.md**: Turborepo monorepo. `packages/core` agnóstico de framework. Ola 2 = `apps/native` con React Native + Reanimated 3 + gesture-handler reusando `packages/core` sin tocarlo. Por qué RN nativo en lugar de Capacitor (calidad nativa en F7 toma de datos + F12 pizarra táctica).

**Commit**: `docs(0.12): ADRs 0000–0003`

---

## 5. Validación final antes de PR

Desde la raíz del monorepo:

```bash
pnpm install                          # debe pasar sin errores
pnpm typecheck                        # 0 errores
pnpm lint                             # 0 warnings, 0 errores
pnpm --filter web build               # build OK
git log --oneline                     # commits convencionales correctos
git status                            # working tree limpio
```

Si algo de esto falla, **no abras el PR**. Corrige y reintenta.

---

## 6. Push y creación del PR

```bash
git push origin feat/fase-0-bootstrap

gh pr create \
  --base main \
  --head feat/fase-0-bootstrap \
  --title "feat(bootstrap): Fase 0 completa — monorepo + andamiaje + docs" \
  --body-file /tmp/pr-body.md \
  --draft
```

El cuerpo del PR debe contener:

- Resumen de las 12 subfases ejecutadas
- Lista de archivos clave creados (estructura del monorepo)
- Pasos pendientes para el usuario tras mergear:
  1. Crear `.env.local` con las claves reales de Supabase y Sentry
  2. `direnv allow`
  3. Conectar el repo a Vercel desde la UI y pegar las env vars
  4. Configurar branch protection en `main` (require PR, require CI green)
- Estimación: ~4-5 h trabajadas

---

## 7. Tras el PR

Avisa al usuario con un mensaje breve:

> PR #1 listo en draft: `feat/fase-0-bootstrap`. He cerrado las 12 subfases de Fase 0. CI debería ponerse verde en unos minutos. Cuando lo revises y mergees, marca la Fase 0 como ☑ completada en `docs/journey/progress.md` y arrancamos Fase 1.

No mergees tú el PR. La revisión la hace el usuario.
