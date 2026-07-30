import type { MergeDeep } from 'type-fest';
import type { Database as GeneratedDatabase, Json } from './database';
import type { DatabaseOverrides } from './database.overrides';

/**
 * Tipo `Database` CANÓNICO del proyecto.
 *
 * `database.ts` se autogenera con `pnpm db:types` y NO se edita a mano (artefacto
 * puro, re-generable sin miedo). Sobre él se aplica `DatabaseOverrides` con
 * `MergeDeep`: precisión de nullability que el generador SIEMPRE pierde (params de
 * RPC, columnas de RETURNS TABLE, `inet`). Requiere `MergeDeep` porque SOBRESCRIBE
 * tipos de leaves ya existentes. PERMANENTE.
 *
 * `recurseIntoArrays: true` es necesario para fusionar los `Returns: {...}[]` de
 * las RPC a nivel de elemento (aplicar `| null` a columnas concretas sin perder
 * las demás). Con la opción por defecto, el override reemplazaría el array entero.
 *
 * Todos los clientes (`client*.ts`) importan `Database` de AQUÍ, así que el
 * override se aplica sin tocar ningún cliente ni apps/web.
 */
export type Database = MergeDeep<
  GeneratedDatabase,
  DatabaseOverrides,
  { recurseIntoArrays: true }
>;

export type { Json };
