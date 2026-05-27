# Supabase CLI sin `supabase link`

> **Estado**: Patrón vigente desde Fase 1.
> **Motivo**: El access token disponible localmente no tiene privilegios sobre el Management API de Supabase (rol insuficiente para `supabase link` / `supabase projects list`). En vez de bloquear el desarrollo esperando un token con permisos, trabajamos contra la BD remota usando solo la **conexión directa de Postgres** (que solo requiere la password de la BD del proyecto, no el Management API).

---

## Qué hace este patrón

Todos los subcomandos `supabase` que tocan la BD aceptan `--db-url postgresql://...`. Pasándolo en cada invocación, el CLI:

1. No necesita `supabase link` (que va contra el Management API y requiere token con permisos).
2. No usa el archivo `supabase/.temp/project-ref` (puede no existir).
3. Habla directamente con Postgres del proyecto remoto.

Los subcomandos que **no tocan BD** (`init`, `migration new`, `gen types --local`, etc.) funcionan sin nada extra.

---

## Variables requeridas

En `apps/web/.env.local` (gitignored, cargado por direnv):

```
SUPABASE_PROJECT_REF=<ref-del-proyecto>          # ej. tvbdykkuoyalyzllnqkn
SUPABASE_DB_PASSWORD=<password-bd>               # la que pusiste al crear el proyecto
SUPABASE_ACCESS_TOKEN=sbp_...                    # necesario para `pnpm db:types`
SUPABASE_DB_REGION=eu-west-1                     # opcional; default eu-west-1
```

La URL se construye internamente apuntando al **pooler IPv4** del proyecto:

```
postgresql://postgres.<ref>:<password-url-encoded>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Por qué pooler y no `db.<ref>.supabase.co:5432`:

- El host directo solo resuelve a IPv6 (`2a05:...`) en muchas regiones.
- Hay entornos (Vercel Edge runtime, Codespaces, CI con red limitada, el harness local) que no rutean IPv6 a Postgres → `network is unreachable`.
- El pooler en modo transaction (puerto 6543) es IPv4, soporta DDL para `db push` (cada statement = transacción) y para el resto de comandos también vale.

La password se URL-encodea con `encodeURIComponent` (Node) porque suele tener caracteres reservados (`@`, `:`, `/`, `?`).

---

## Scripts disponibles

Definidos en `package.json` raíz, todos delegan en `scripts/supabase-cli.sh`:

| Script | Equivalente CLI | Uso |
|---|---|---|
| `pnpm db:push` | `supabase db push --db-url ...` | Aplica migraciones pendientes a la BD remota |
| `pnpm db:types` | `supabase gen types typescript --project-id $SUPABASE_PROJECT_REF > packages/core/src/supabase/database.ts` | Regenera types TS desde el schema remoto. **Excepción**: usa Management API (no `--db-url`) porque el CLI 2.98 con `--db-url` exige Docker (bug). El access token sí tiene permiso de lectura para esta operación aunque no para `supabase link`. |
| `pnpm db:reset` | `supabase db reset --db-url ...` | ⚠️ Borra y recrea el schema `public` remoto. Pide confirmación interactiva por nombre del ref. Solo usar en proyectos vacíos / sandbox. |

Cualquier flag extra pasado al script se reenvía al CLI:

```bash
pnpm db:push -- --dry-run
pnpm db:types -- --schema public
```

---

## Cuándo escapar del patrón

Vuelve al flow estándar (`supabase link` + comandos sin `--db-url`) cuando se cumpla alguna de estas:

1. Conseguimos un access token con rol Owner/Administrator sobre el proyecto.
2. Migramos a Supabase CLI v2.101+ y el comportamiento de los flags cambia.
3. Necesitamos comandos del Management API (branches, secrets, edge functions config, etc.) que el wrapper no cubre.

En ese momento: borra `scripts/supabase-cli.sh`, vuelve a poner en `package.json` los scripts canónicos (`supabase db push`, `supabase gen types ... --linked`), añade un paso `supabase link` al onboarding del repo, y archiva este doc.

---

## Lo que **no** cambia con este patrón

- Las migraciones siguen siendo SQL plano en `supabase/migrations/YYYYMMDDHHMMSS_nombre.sql`.
- El orden de aplicación lo determina el timestamp del nombre del archivo.
- La regla "migraciones aplicadas a `main` son inmutables" sigue siendo válida.
- `supabase init` y `supabase migration new` se invocan tal cual con `npx supabase@2.98.2`.

---

## Troubleshooting

**`Error: pq: password authentication failed`**
La password en `SUPABASE_DB_PASSWORD` no coincide. Recupérala de Supabase Dashboard → Project Settings → Database o resetéala desde ahí.

**`Error: dial tcp ... i/o timeout`**
Tu IP no puede llegar al puerto 5432 del proyecto. Comprueba en Project Settings → Database → Network Restrictions que el rango está permitido (Free tier por defecto deja todo abierto).

**`Error: function ... already exists`** al hacer `db:push`
Hay un mismatch entre el estado del repo y el remoto. Probablemente alguien aplicó una migración a mano por SQL Editor. Solución: añadir la migración faltante al repo o reconciliar con `supabase migration repair` (con `--db-url`).

**`pnpm db:types` devuelve un archivo vacío o con error**
El CLI vuelca el error a stdout y se acaba escribiendo como archivo de types. Comprueba el exit code y, si falla, no commitees el archivo generado.
