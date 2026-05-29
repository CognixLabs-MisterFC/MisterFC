# MisterFC — Reglas para Claude Code (raíz)

> Las **reglas operativas completas** viven en [`_bootstrap/CLAUDE.md`](_bootstrap/CLAUDE.md) (identidad del repo, workflow, estructura del monorepo, convenciones, seguridad). Léelas antes de tocar nada.
>
> Este archivo de raíz recoge reglas transversales que deben estar siempre a la vista. El monorepo usa **pnpm + turbo** (no npm).

---

## Verificaciones pre-PR (obligatorias)

Antes de abrir cualquier PR, tras implementar y testear, debe pasar en local:

```bash
pnpm typecheck                 # tsc --noEmit en todo el monorepo
pnpm lint                      # eslint sin warnings
pnpm test                      # vitest (los que apliquen)
pnpm --filter web build        # next build — NO opcional (ver regla abajo)
```

No basta con "ya lo correrá la CI": `pnpm --filter web build` debe ejecutarse y salir con exit 0 **localmente** antes de abrir el PR.

### Regla: `pnpm --filter web build` obligatorio en PRs que toquen archivos `"use server"`

Para cualquier PR que **añada, modifique o renombre** archivos con la directiva `"use server"` en la primera línea (en este repo: todos los `apps/web/src/app/**/actions.ts`, y cualquier otro archivo que lleve la directiva), **DEBE** ejecutarse `pnpm --filter web build` localmente antes de abrir el PR. Este check es **obligatorio**, no opcional.

**Razón**: Vitest carga los módulos como JS normal y **no** enforza la regla de Next.js _"a 'use server' file can only export async functions"_. Solo `pnpm --filter web build` (que pasa por el bundler de Next.js) o el runtime real detectan violaciones. El `typecheck` tampoco lo captura: el tipo del export puede ser válido pero la regla del bundler rechazarlo en runtime (p. ej. exportar una constante numérica top-level junto a server actions).

**Síntoma típico cuando falla**: en los logs de Vercel tras deploy aparece
`Error: A "use server" file can only export async functions, found <tipo>.`

**Cómo verificar**: tras los pre-PR habituales (`pnpm typecheck`, `pnpm test`), correr `pnpm --filter web build` y confirmar **exit 0**.

> **Lección PR #30** (mergeado 2026-05-29): el bug se introdujo en PR #25 / F5.6 — dos archivos `"use server"` exportaban una constante numérica top-level. Vitest cargó los módulos sin detectarlo; solo el build (o el runtime real) reprodujo el error, que llegó a producción y rompió el envío de mensajes hasta el hotfix. Ver el body del PR #30 para el caso real.
