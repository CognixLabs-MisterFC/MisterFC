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
| `pnpm db:types` | `supabase gen types typescript --project-id $SUPABASE_PROJECT_REF --schema public` → fichero temporal → `packages/core/src/supabase/database.ts` | Regenera types TS desde el schema remoto. **Excepción**: usa Management API (no `--db-url`) porque el CLI 2.98 con `--db-url` exige Docker (bug). El access token sí tiene permiso de lectura para esta operación aunque no para `supabase link`. Ver [Quién genera los tipos](#quién-genera-los-tipos-de-verdad). |
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

---

## Quién genera los tipos de verdad

Con `--project-id`, **el TypeScript no lo genera el CLI: lo genera Supabase en el servidor**. El CLI es un cliente HTTP de `GET /v1/projects/{ref}/types/typescript`. Comprobado contra producción: la respuesta cruda de esa ruta y la salida del CLI son **byte a byte idénticas**, tanto con el 2.98.2 pineado como con el 2.117.0.

Tres consecuencias prácticas:

- **La versión del CLI no influye en `db:types`.** Lo único en lo que se diferencian 2.98.2 y 2.117.0 es qué esquemas piden por defecto: el viejo pide `public` y el nuevo `public,graphql_public`. Por eso el script pasa `--schema public` explícito — así el fichero sale igual con cualquiera.
- **`database.ts` puede cambiar sin que cambie el esquema.** El generador del servidor se actualiza solo. Entre julio y septiembre de 2026 cambió dos veces: añadió paréntesis en los genéricos `Tables<>`/`Enums<>` y cambió el `PostgrestVersion` que escribe en la cabecera. Un diff en esas líneas no significa que alguien haya tocado la BD.
- **Un diff de `database.ts` no es revisable línea a línea.** Lo que hay que mirar es si aparecen o desaparecen tablas, columnas y funciones; el ruido de formato es del servidor.

### El pin del CLI y `db:types`

El proyecto pinea `2.98.2` en `scripts/supabase-cli.sh` y en `.github/workflows/ci.yml`. Ese pin **sigue importando** para `db push`, `db reset` y el `supabase start` del job de pgTAP, que sí corren código del CLI. Para `db:types` es indiferente, por lo de arriba.

La nota de `ci.yml` que dice «v2.99+ rompe el flujo db» **no tiene medición detrás**: el pin lleva puesto sin tocar desde el primer commit que creó el script (mayo de 2026, Fase 1), nunca se subió ni se revirtió. Si algún día se quiere subir, es un cambio propio y se valida con el `supabase start` del CI y un `db push --dry-run`, no de paso en otro PR.
