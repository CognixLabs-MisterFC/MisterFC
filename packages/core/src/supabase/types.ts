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
 *     pierde (params de RPC, columnas de RETURNS TABLE, `inet`). PERMANENTE.
 *  2. `DatabasePending` — tabla/RPC que una migración ya añadió pero el
 *     `database.ts` canónico aún no conoce (no se ha regenerado). TEMPORAL: se
 *     borra al canonizar (ver `database.pending.ts`).
 *
 * `recurseIntoArrays: true` es necesario para fusionar los `Returns: {...}[]` de
 * las RPC a nivel de elemento (aplicar `| null` a columnas concretas sin perder
 * las demás). Con la opción por defecto, el override reemplazaría el array entero.
 *
 * Todos los clientes (`client*.ts`) importan `Database` de AQUÍ, así que ambas
 * capas se aplican sin tocar ningún cliente ni apps/web.
 */
export type Database = MergeDeep<
  MergeDeep<GeneratedDatabase, DatabaseOverrides, { recurseIntoArrays: true }>,
  DatabasePending,
  { recurseIntoArrays: true }
>;

export type { Json };
