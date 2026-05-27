# MisterFC — Reglas operativas para Claude Code

> Este documento es la guía permanente que Claude Code debe respetar en cualquier acción sobre este repo. Léelo entero antes de tocar nada. Si una instrucción del usuario contradice estas reglas, **detente y consulta** antes de actuar.

---

## 1. Identidad del repo

- **Producto**: MisterFC (Cognix Labs)
- **Org GitHub**: `CognixLabs-MisterFC`
- **Repo**: `MisterFC`
- **Working tree local**: `~/Claude Code/APP MisterFC/misterfc/`
- **Cuenta GitHub para operaciones git/gh**: `CognixLabs-Nido` (administra la org). El `.envrc` hace `gh auth switch` automático al entrar en la carpeta. Si `gh auth status` no muestra `CognixLabs-Nido` como cuenta activa, switch antes de cualquier acción git remota.
- **Identidad git** (configurada via `.envrc`):
  - `user.name`: Iker Milla
  - `user.email`: jovimib@gmail.com

---

## 2. Workflow obligatorio

1. **Una rama por feature**. Nunca commit directo a `main`.
2. **Naming de ramas**:
   - `feat/N.M-titulo` para subfases del Plan (ej. `feat/1.3-player-accounts`)
   - `fix/descripcion` para hotfixes
   - `chore/descripcion` para tareas de mantenimiento
   - `docs/descripcion` para cambios de solo documentación
3. **Conventional Commits** obligatorios. Formato: `tipo(N.M): titulo` o `tipo: titulo` si no aplica a una subfase concreta.
   - Tipos válidos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`.
   - Ejemplo: `feat(2.4): vincular cuentas familia al jugador menor`
4. **PR + squash merge** siempre. Sin merge commits. Sin rebase merge.
5. **Spec antes de código** para features no triviales: crear `docs/specs/N.M-titulo.md` antes de implementar.
6. **ADR para decisiones técnicas con impacto**: nuevo archivo en `docs/decisions/ADR-NNNN-titulo.md`.
7. **Working tree limpio** antes de cualquier acción nueva. Si está sucio, pregunta al usuario qué hacer con los cambios pendientes.
8. **CI verde en `main` siempre**. Si CI rompe en `main`, parar todo y arreglar.

---

## 3. Things to never do

- Force push a `main` (`--force` o `--force-with-lease`).
- Commit de secrets: `.env`, `.env.local`, `.env.production`, tokens, claves API, passwords, DSNs reales. El `.gitignore` los protege pero verifica antes de cada commit.
- Sobrescribir migraciones de Supabase ya aplicadas. Las migraciones son inmutables una vez en `main`. Crear una nueva para correcciones.
- Tocar `_bootstrap/` después de cerrar Fase 0. Esa carpeta queda como artefacto histórico.
- Eliminar archivos de `docs/decisions/` (ADRs). Si una decisión cambia, crear un nuevo ADR que supersede al anterior, no borrar.
- Mezclar UI components con lógica de negocio. La regla:
  - **Lógica pura** (validación, schemas Zod, cliente Supabase, helpers, hooks no-React) → `packages/core/src/`
  - **UI de Next.js** (componentes, layouts, páginas) → `apps/web/src/`
  - **Componentes con dependencia de React pero portables a RN** → discutir antes con el usuario
- Hacer `pnpm add` con flags como `--save-exact` sin razón. Mantén las dependencias con caret `^` salvo casos justificados.
- Saltarte tests. Si un test falla, arreglar el código, no el test.

---

## 4. Estructura del monorepo

```
misterfc/
├── apps/
│   └── web/                       Next.js 14 PWA (Ola 1)
│       ├── src/
│       │   ├── app/               App Router
│       │   ├── components/        Componentes específicos de web
│       │   ├── lib/               Utilidades específicas de web
│       │   └── middleware.ts      i18n + auth
│       ├── messages/              i18n (link symlink a /messages)
│       ├── public/                Assets + manifest PWA
│       ├── sentry.*.config.ts     Sentry per environment
│       ├── next.config.mjs
│       ├── tailwind.config.ts
│       └── package.json
├── packages/
│   └── core/                      Lógica compartible Ola 1 + Ola 2
│       ├── src/
│       │   ├── types/             Database types, models
│       │   ├── schemas/           Zod schemas
│       │   ├── supabase/          Cliente Supabase (browser + server)
│       │   ├── hooks/             Hooks no-React (o React puros sin Next)
│       │   ├── utils/
│       │   └── index.ts
│       └── package.json           name: @misterfc/core
├── messages/                      i18n (es/en/va) — usado por apps/web
├── docs/
│   ├── specs/                     Specs por subfase del Plan
│   ├── decisions/                 ADRs
│   ├── architecture/              Diagramas, modelos de datos
│   └── journey/                   Plan maestro + progreso + retros
├── _bootstrap/                    Solo Fase 0. Tras cerrarla, no se toca.
├── .github/
│   ├── workflows/                 CI
│   └── pull_request_template.md
├── .envrc                         direnv
├── .env.example                   plantilla de env vars
├── pnpm-workspace.yaml
├── turbo.json
└── package.json                   raíz del monorepo
```

---

## 5. Convenciones de código

### TypeScript

- `strict: true` siempre.
- `noUncheckedIndexedAccess: true`.
- Sin `any`. Si necesitas un tipo dinámico, usa `unknown` y narrow.
- Tipos compartidos en `packages/core/src/types/`. Importables desde `apps/web` como `@misterfc/core`.

### Estilo

- Prettier configurado. Husky con hook pre-commit que pasa `pnpm format` + `pnpm lint`.
- Indentación: 2 espacios.
- Comillas dobles en JSX, comillas simples en TS.

### Componentes (apps/web)

- Server Components por defecto.
- `"use client"` solo cuando se necesita estado, eventos o APIs de navegador.
- Convención de nombres: PascalCase para componentes, kebab-case para archivos.

### i18n

- Todo texto visible al usuario en `messages/{locale}.json`.
- Sin strings hardcoded en componentes (excepto contenido técnico o de debug).
- Keys jerárquicas: `dashboard.players.add_player_button`.

### Tests

- Vitest para unit (`packages/core` + `apps/web/src/lib`).
- Playwright para E2E (en Fase 14).
- pgTAP o equivalente para RLS de Supabase (en Fase 1 onwards).

---

## 6. Comandos comunes

Desde la raíz del monorepo:

```bash
pnpm install                       # instala todo
pnpm dev                           # arranca apps/web en local
pnpm typecheck                     # tsc --noEmit en todo el monorepo
pnpm lint                          # eslint
pnpm lint:fix                      # eslint --fix
pnpm format                        # prettier --write
pnpm test                          # vitest
pnpm --filter web build            # build de Next.js
pnpm --filter web start            # arranca el build (preview prod)
```

Para añadir dependencias:

```bash
pnpm --filter @misterfc/core add zod              # a packages/core
pnpm --filter web add some-package                # a apps/web
pnpm add -w -D some-dev-tool                      # a la raíz (dev)
```

---

## 7. Antes de cada subfase del Plan

1. Lee la subfase en `docs/journey/plan-maestro.md`. El plan es la fuente de verdad.
2. Si la subfase no tiene spec en `docs/specs/` y es no trivial, crea la spec primero.
3. Crea rama `feat/N.M-titulo`.
4. Implementa.
5. Tests (los que apliquen).
6. `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build` — todo verde.
7. Commit convencional.
8. Push y abre PR (no draft salvo que sea grande o experimental).
9. Espera revisión del usuario.

---

## 8. Al cerrar una subfase

- Marca la subfase como `[hecho YYYY-MM-DD]` en `docs/journey/plan-maestro.md`.
- Actualiza el estado en `docs/journey/progress.md`.
- Si esa subfase cerró una fase entera, marca la fase como ☑ completada.

---

## 9. Seguridad

- RLS estricta desde Fase 1. Toda tabla con datos sensibles debe tener RLS activa y tests que verifiquen aislamiento.
- Datos de menores: tratamiento especial documentado en Fase 13 (RGPD).
- No loguear PII en Sentry. El `beforeSend` filtra emails, nombres, contenido de mensajes.
- Tokens, claves y passwords solo en `.env.local` (gitignored). Nunca en código, nunca en commits, nunca en logs.
- 2FA obligatorio en todas las cuentas (GitHub, Supabase, Sentry, Vercel).

---

## 10. Cuando tengas dudas

- Si una decisión es ambigua, **pregunta antes de actuar**. Mejor un mensaje al usuario que un PR para deshacer.
- Si encuentras código existente que no sigue estas reglas, **no lo cambies en el mismo PR** que tu feature. Abre un PR aparte de `refactor:` o `chore:`.
- Si una dependencia externa rompe el build, **no actualices** sin avisar. El usuario decide cuándo asumir los cambios.

---

## 11. Cosas que el usuario hace, no tú

- Mergear PRs.
- Configurar variables de entorno en Vercel / Supabase / Sentry (UI).
- Crear o eliminar branches en GitHub (la app no).
- Promover cambios de Supabase Staging a Production (cuando exista esa separación).
- Decisiones de producto. Tú implementas; el usuario decide.

---

## 12. Comunicación con el usuario

- En cada PR, body claro con: qué se hizo, archivos clave, cómo probar, cualquier riesgo o decisión tomada en el camino.
- Si encuentras un bug en código pre-existente mientras implementas otra cosa, **anótalo en `docs/journey/known-issues.md`** (créalo si no existe) y sigue con tu tarea. No mezcles.
- Si una subfase del Plan resulta más compleja de lo estimado, avisa al usuario con tu nueva estimación antes de pasar el doble de horas.
