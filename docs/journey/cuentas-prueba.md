# Cuentas de prueba

Inventario de cuentas creadas vía script para smoke testing local del
producto. No se incluyen passwords aquí — viven solo en el body del PR
que creó la cuenta y en el `.env.local` del entorno de quien ejecuta el
seed.

> **Reglas:**
>
> - Estas cuentas **viven en el proyecto Supabase remoto** (mismo que la
>   app). No son cuentas locales.
> - El bypass de verificación de email (`email_confirm: true`) requiere
>   la **service role key**. No commitear nunca esa key.
> - El script es **idempotente**: re-ejecutarlo no falla; reutiliza
>   filas existentes.
> - Si una cuenta deja de hacer falta, borrarla manualmente (UI Supabase
>   o `auth.admin.deleteUser`) y limpiar `profiles` / `memberships` /
>   `player_accounts` asociados.

## Script

[apps/web/scripts/seed-test-accounts.mjs](../../apps/web/scripts/seed-test-accounts.mjs)

```bash
cd apps/web && node scripts/seed-test-accounts.mjs
```

Requiere en `apps/web/.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS — no commitear)

## Inventario

Club: **Club Beta Test** (`slug=club-beta-test`)

| Email | Rol | Player vinculado | Relation | Propósito |
|---|---|---|---|---|
| jovimib+jugador1@gmail.com | `jugador` | Jose Milla | `self` | Jugador menor con cuenta propia |
| jovimib+familia1@gmail.com | `jugador` | Jose Milla | `parent` | Familiar de Jose — valida que una familia vinculada al MISMO player puede responder convocatorias por su hijo |
| jovimib+jugador2@gmail.com | `jugador` | Andrés Test | `self` | Segundo jugador en el mismo equipo — valida selección múltiple en convocatorias |

> Nota arquitectural: no existe rol `familia` propio. Una cuenta familia
> es un `profiles` con `memberships.role='jugador'` vinculado al player
> vía `player_accounts(relation='parent'|'guardian')`. Decisión tomada
> en F1, ver [supabase/migrations/20260527111902_profiles_and_memberships.sql](../../supabase/migrations/20260527111902_profiles_and_memberships.sql).

Equipo activo de ambos players: **Alevin B** (categoría Alevin, formato
F8). El script asigna automáticamente cualquier player creado al mismo
team activo donde está Jose Milla.

## Smoke flows habilitados

Con estas 3 cuentas se valida F4 Lote B end-to-end:

- **F4.5** — login con `jugador1` y responder yes/maybe/no a una
  convocatoria publicada.
- **F4.5** — login con `familia1` y comprobar que ve y puede responder
  por Jose Milla (misma player_account, distinto profile).
- **F4.5** — login con `jugador2` y comprobar que ve la convocatoria
  como un jugador distinto (Andrés Test) en el mismo team.
- **F4.6** — login con entrenador del Alevin B y comprobar que ve los 2
  jugadores en el dropdown de citación + las respuestas.
- **F4.7** — disparar `/api/cron/reminders` con `CRON_SECRET` y
  comprobar que aparecen filas `match_callup_reminder` en
  `notifications` para los 3 profiles vinculados a players con
  convocatoria pendiente.

## Histórico de seeds

| Fecha | Script | Acción |
|---|---|---|
| 2026-05-29 | `seed-test-accounts.mjs` | Alta de las 3 cuentas iniciales |
