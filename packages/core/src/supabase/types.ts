import type { MergeDeep } from 'type-fest';
import type { Database as GeneratedDatabase, Json } from './database';
import type { DatabaseOverrides } from './database.overrides';
import type { DatabasePending } from './database.pending';

/**
 * Tipo `Database` CANÓNICO del proyecto.
 *
 * `database.ts` se autogenera con `pnpm db:types` y NO se edita a mano (artefacto
 * puro, re-generable sin miedo). Sobre él se aplican DOS capas con `MergeDeep`:
 *
 *  1. `DatabaseOverrides` — precisión de nullability que el generador SIEMPRE
 *     pierde (params de RPC, columnas de RETURNS TABLE, `inet`). Requiere
 *     `MergeDeep` porque SOBRESCRIBE tipos de leaves ya existentes. PERMANENTE.
 *  2. `DatabasePending` — tabla/RPC que una migración ya añadió pero el
 *     `database.ts` canónico aún no conoce (no se ha regenerado). TEMPORAL: se
 *     borra al canonizar (ver `database.pending.ts`).
 *
 * `recurseIntoArrays: true` es necesario para fusionar los `Returns: {...}[]` de
 * las RPC a nivel de elemento (aplicar `| null` a columnas concretas sin perder
 * las demás). Con la opción por defecto, el override reemplazaría el array entero.
 *
 * OJO — `DatabasePending` se aplica con INTERSECCIÓN (`&`), NO con un segundo
 * `MergeDeep`. Un segundo `MergeDeep` sobre el `Database` COMPLETO (que es enorme)
 * re-materializa toda la estructura y dispara la memoria de `tsc` hasta OOM en CI.
 * Como Pending SOLO AÑADE claves nuevas (`expo_push_tokens`, `register_expo_push_
 * token`) y nunca sobrescribe leaves existentes, la intersección basta: `keyof`
 * queda como la unión y `(Base & Pending)['public']['Tables']['expo_push_tokens']`
 * resuelve a la rama que sí tiene la clave, sin coste recursivo. (Los overrides
 * SÍ necesitan MergeDeep porque pisan tipos existentes; Pending no.)
 *
 * Todos los clientes (`client*.ts`) importan `Database` de AQUÍ, así que ambas
 * capas se aplican sin tocar ningún cliente ni apps/web.
 */
export type Database = MergeDeep<
  GeneratedDatabase,
  DatabaseOverrides,
  { recurseIntoArrays: true }
> &
  DatabasePending;

export type { Json };
