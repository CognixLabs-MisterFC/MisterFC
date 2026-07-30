import type { MergeDeep } from 'type-fest';
import type { Database as GeneratedDatabase, Json } from './database';
import type { DatabaseOverrides } from './database.overrides';

/**
 * Tipo `Database` CANÓNICO del proyecto.
 *
 * `database.ts` se autogenera con `pnpm db:types` y NO se edita a mano (artefacto
 * puro, re-generable sin miedo). La precisión de nullability que el generador
 * pierde (params de RPC, columnas de RETURNS TABLE, `inet`) se reintroduce en
 * `database.overrides.ts` y se fusiona aquí con `MergeDeep`.
 *
 * `recurseIntoArrays: true` es necesario para fusionar los `Returns: {...}[]` de
 * las RPC a nivel de elemento (aplicar `| null` a columnas concretas sin perder
 * las demás). Con la opción por defecto, el override reemplazaría el array entero.
 *
 * Todos los clientes (`client*.ts`) importan `Database` de AQUÍ, así que la capa
 * de overrides se aplica sin tocar ningún cliente ni apps/web.
 */
export type Database = MergeDeep<
  GeneratedDatabase,
  DatabaseOverrides,
  { recurseIntoArrays: true }
>;

export type { Json };
