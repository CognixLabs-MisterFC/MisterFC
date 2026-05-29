# Fase 2 — Resumen ejecutivo de cierre

> Subfase del Plan Maestro: **Fase 2 — Plantilla y cuerpo técnico**.
> Estado: ☑ cerrada 2026-05-29.

## Fechas y volumen

- **Inicio**: 2026-05-28
- **Fin**: 2026-05-29
- **Estimado**: 14–23 h · **Real**: ≈18–20 h efectivos
- **PRs**: 7 (#10, #11, #12, #13, #14, #15, #16)
- **Commits aproximados**: 30
- **Lotes**:
  - **A** — F2.0 (app shell + perfil) + F2.1 (CRUD categorías/equipos) → PR #10 + hotfixes #11/#12.
  - **B** — F2.2 (ficha jugador) + F2.3 (alta) + F2.4 (familia) + F2.5 (histórico) → PR #13.
  - **C** — F2.6 (staff) + F2.7 (capabilities UI) + F2.8 (mi-plantilla) → PR #14.
  - **D** — F2.9 (import masivo CSV/Excel) → PR #16.
  - **Fix transversal** entre lote C y D: PR #15 (accept flow de invitaciones).

## Subfases entregadas con PR

| Subfase | PR | Resumen |
|---|---|---|
| 2.0 | #10 (lote A) | App shell + route group `(authenticated)` + nav role-aware + `/perfil` con avatar privado |
| 2.1 | #10 (lote A) | CRUD categorías + equipos (agrupada por temporada) |
| 2.2 | #13 (lote B) | Ficha del jugador + bucket privado `player-photos` + helpers RLS (`user_can_see_player_medical`, etc.) |
| 2.3 | #13 (lote B) | Alta de jugador con dialog y opcional asignación a equipo |
| 2.4 | #13 (lote B) | Vincular cuentas familia a jugador menor (`invitations.player_id` + `player_relation`) |
| 2.5 | #13 (lote B) | Histórico del jugador en el club (`team_members.left_at`) |
| 2.6 | #14 (lote C) | Cuerpo técnico: tabla `team_staff` + UI `/equipos/[teamId]` + InviteStaffDialog |
| 2.7 | #14 (lote C) | UI de capabilities del ayudante (shadcn Switch + optimistic UPSERT) |
| 2.8 | #14 (lote C) | Vista `/mi-plantilla` read-only del entrenador |
| 2.9 | #16 (lote D) | Import masivo CSV/Excel (wizard 4 pasos, primer Vitest del repo) |
| — | #11, #12 | Hotfixes producción F2.0: RSC icon boundary + literal `process.env.NEXT_PUBLIC_*` |
| — | #15 | Fix transversal del accept flow de invitaciones (PKCE + OTP + implicit hash + RLS aditiva) |

## Bugs cazados durante F2 (causa raíz + fix)

### 1. Server → Client RSC icon error en Sidebar (PR #11)
- **Síntoma**: la home `/es` daba 500 en producción tras desplegar PR #10. Stack apuntaba a "Functions cannot be passed directly to Client Components".
- **Causa raíz**: el sidebar pasaba `LucideIcon` como prop function desde un Server Component a un Client Component. RSC rechaza serializar funciones a través del límite.
- **Fix**: renderizar el icono `<Icon className="..." />` ya en el server y pasarlo como `ReactNode` al cliente.

### 2. `NEXT_PUBLIC_*` no se inlinea en el bundle cliente (PR #12)
- **Síntoma**: la subida de avatar fallaba en producción con cliente Supabase sin URL/anon key.
- **Causa raíz**: el helper de env hacía `const env = process.env` y luego `env.NEXT_PUBLIC_X`. Next.js solo sustituye estáticamente la forma literal `process.env.NEXT_PUBLIC_X`; cualquier indirección rompe el inlining y el browser ve `undefined`.
- **Fix**: lectura literal `process.env.NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` en `packages/core/src/supabase/env.ts`, con comentario fijo de por qué.

### 3. Sentry server-side no inicializaba en producción (PR #11/#12)
- **Síntoma**: Vercel logs mostraban `[sentry][edge-init]` pero nunca `[sentry][server-init]`. Errores en server actions no llegaban a Sentry.
- **Causa raíz**: `instrumentation.ts` no cargaba `sentry.server.config.ts` por hint de runtime.
- **Fix**: corregir el switch por `process.env.NEXT_RUNTIME` y añadir log diagnóstico tras `Sentry.init` (`[sentry][server-init] initialized { dsn_present: true, ... }`). Confirmado retrospectivamente en PR #15 al observar las trazas `[invite][accept]` en Sentry.

### 4. `redirectTo` de Supabase Invite caía al Site URL (PR #15)
- **Síntoma**: `/es/invite/{token}` → 307 → `/es/signin`. El email link tenía `redirect_to=https://misterfc-web.vercel.app` (raíz, sin path) cuando la action pasaba `/auth/callback?next=...`.
- **Causa raíz**: Supabase descarta silenciosamente los `redirectTo` que no matchean el allowlist `Auth → URL Configuration → Redirect URLs` y cae al Site URL. El `?code=` (PKCE) llegaba a la raíz sin nadie que lo intercambiase.
- **Fix multicapa**:
  - 3 server actions cambian `redirectTo` a `/{locale}/invite/{token}` (una sola URL por entorno a meter en allowlist).
  - Middleware reenruta `?code=` y `?token_hash=&type=` a `/auth/callback` (red de seguridad).
  - `/auth/callback` acepta `token_hash`+`type` vía `verifyOtp` como fallback OTP legacy.

### 5. Flow implícito Supabase con tokens en hash fragment (PR #15)
- **Síntoma**: tras PR #15 layer 1, el browser todavía caía en `/signin?next=/es/invite/{token}#access_token=...&refresh_token=...`. Los tokens viajaban en el hash, el servidor no los ve.
- **Causa raíz**: Supabase Auth puede emitir el flujo implícito (sin PKCE) que transporta tokens en el fragment. Middleware no puede inspeccionar el hash — los browsers no lo envían al servidor.
- **Fix**: `AuthHashHandler` client component montado en `LocaleLayout` dentro de `<Suspense>`. Detecta `window.location.hash`, parsea `access_token` + `refresh_token`, llama `supabase.auth.setSession(...)` con el browser client, redirige a `?next=` o al pathname actual, limpia el hash con `history.replaceState`.

### 6. RLS bloqueaba `team_staff` (y latente en `player_accounts`) durante accept (PR #15)
- **Síntoma**: tras superar todos los pasos del accept, el INSERT en `team_staff` explotaba con SQLSTATE 42501.
- **Causa raíz**: las policies `team_staff_insert_admin` y `player_accounts_write_admin` solo permitían admin/coord. El invitee (que acaba de aceptar) corre con SU JWT y no es admin/coord, así que no puede insertar SU propia fila.
- **Cazado vía**: repro local con puppeteer-core + dev logs grepables — la instrumentación `[invite][accept]` mostró el step exacto que fallaba.
- **Fix**: migración `20260529000000_team_staff_insert_invitee.sql` con DOS policies aditivas (`team_staff_insert_invitee` y `player_accounts_insert_invitee`) calcadas de `memberships_insert_bootstrap_or_admin`. Validan `auth.uid() = membership.profile_id` o `auth.uid() = profile_id`, email match, invitación pendiente y vigente. El bug de `player_accounts` era **latente** — F2.4 nunca se había probado con un email virgen aceptando, habría fallado idéntico la primera vez.

## Decisiones técnicas estabilizadas durante F2

- **shadcn/ui** confirmado como sistema de componentes (Tailwind v4 + new-york + neutral). El ADR-0005 que se planteó al inicio queda obsoleto — la decisión está ratificada por uso real (`Card`, `Select`, `Switch`, `AlertDialog`, `Button`).
- **Vitest** estrenado en `packages/core` (vitest.config.ts mínimo, sin React plugin — todo lógica pura). 25 tests verdes en F2.9, primer runner de tests del repo. Step `pnpm test` añadido al workflow CI antes del build.
- **Sentry** operativo end-to-end: server init, server actions instrumentadas, edge init, browser. Logs `[sentry][*-init]` activos al boot. Captura validada con eventos reales (debug del accept flow en PR #15).
- **Pattern de migraciones aditivas para invitee-self-insert**: cualquier tabla que un invitee tenga que rellenar al aceptar una invitación necesita una policy aditiva específica que reproduzca el patrón de `memberships_insert_bootstrap_or_admin`. Aplicado a `team_staff` y `player_accounts`; documentar y replicar en futuras tablas vinculadas a invitations.
- **Browser Supabase client** centralizado en `packages/core/src/supabase/client-browser.ts` con lectura LITERAL de `process.env.NEXT_PUBLIC_*`. Cualquier uso nuevo desde un client component debe importar de aquí.
- **PWA**: bundle de cliente vigilado. read-excel-file (~30KB) escogido sobre xlsx (~280KB) para F2.9. Recordar lazy-load con `await import()` si entra alguna dep client-side grande.

## Lecciones para fases futuras

> Estas son las reglas de oro que F2 ha demostrado caras de descubrir. Aplicarlas de salida en F3 y siguientes.

1. **Cualquier client component nuevo que use Supabase requiere el browser client de `packages/core` (NO factory con indirección env)**. Inlining de `NEXT_PUBLIC_*` solo funciona con acceso LITERAL a `process.env`. (Origen: bug #2.)
2. **Cualquier action que escribe en BD durante aceptación de invitación necesita policy invitee-self-insert** con la triple: token vigente + email match + `auth.uid()` match (membership o profile). El admin-only no basta — el invitee es quien ejecuta. (Origen: bug #6.)
3. **El `redirectTo` de Supabase `inviteUserByEmail` debe apuntar a `/{locale}/invite/{token}` directo**, no a la raíz. Y la URL DEBE estar en la allowlist de Supabase Dashboard → Auth → URL Configuration; si no, cae al Site URL silenciosamente. (Origen: bug #4.)
4. **Vercel logs limita ~50 entries por vista**. Cuando la observabilidad importe (un bug que el user no logra reproducir, un step inalcanzable), reproducir localmente con `pnpm dev` y herramienta de cliente sintético (puppeteer-core + chromium, ~30s de setup) da los logs completos. (Origen: cierre del bug #6.)
5. **Server Components no pueden recibir funciones por props desde RSC payload**. Iconos lucide-react se renderizan en server, se pasan como `ReactNode`. Tipo `LucideIcon` solo vive en la frontera server, nunca cruza al client. (Origen: bug #1.)
6. **Sentry server init falla silencioso si el runtime hint está mal**. Mantener el log `[sentry][server-init]` activo y greparlo en cada despliegue como smoke test mínimo. (Origen: bug #3.)

## Próximo paso

Fase 3 (**Calendario y eventos** según plan-maestro) arranca en sesión aparte. Spec antes de código.
