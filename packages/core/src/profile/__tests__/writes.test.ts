import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  updateProfileFromClient,
  updateAvatarPathFromClient,
  clearAvatarPathFromClient,
} from '../writes';
import type { Database } from '../../supabase/types';

/**
 * Mock de `supabase.from('profiles')` con las DOS operaciones que usan los avatares:
 * el `update(...).eq(...)` de siempre y el `select('avatar_url')...maybeSingle()` que
 * lee la ruta anterior para poder borrar el objeto viejo del bucket.
 *
 * `calls.removed` captura lo que se manda a `storage.remove` — es lo que de verdad se
 * quiere aseverar aquí: que "quitar foto" borra el fichero y no solo la referencia.
 */
function makeClient(
  error: unknown = null,
  opts: { current?: string | null; readError?: unknown } = {},
) {
  const calls: {
    table?: string;
    payload?: unknown;
    eq?: [string, unknown];
    removed: Array<[string, string]>;
  } = { removed: [] };
  const sb = {
    from: (table: string) => {
      calls.table = table;
      return {
        update: (payload: unknown) => {
          calls.payload = payload;
          return {
            eq: (col: string, val: unknown) => {
              calls.eq = [col, val];
              return Promise.resolve({ error });
            },
          };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { avatar_url: opts.current ?? null },
                error: opts.readError ?? null,
              }),
          }),
        }),
      };
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          for (const path of paths) calls.removed.push([bucket, path]);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, calls };
}

const USER = 'user-123';
const VALID = { full_name: 'Ada Lovelace', date_of_birth: '1990-01-01', locale: 'es' };

describe('updateProfileFromClient', () => {
  it('válido → UPDATE profiles(full_name,date_of_birth,locale) por id + devuelve locale', async () => {
    const { sb, calls } = makeClient(null);
    const r = await updateProfileFromClient(sb, USER, VALID);
    expect(r).toEqual({ success: true, locale: 'es' });
    expect(calls.table).toBe('profiles');
    expect(calls.payload).toEqual({
      full_name: 'Ada Lovelace',
      date_of_birth: '1990-01-01',
      locale: 'es',
    });
    expect(calls.eq).toEqual(['id', USER]); // escritura acotada a la propia fila
  });

  it('nombre demasiado corto → error de validación, SIN tocar la tabla', async () => {
    const { sb, calls } = makeClient(null);
    const r = await updateProfileFromClient(sb, USER, { ...VALID, full_name: 'A' });
    expect(r).toEqual({ success: false, error: 'full_name_too_short' });
    expect(calls.table).toBeUndefined(); // no llegó al UPDATE
  });

  it('locale inválido → locale_invalid', async () => {
    const { sb } = makeClient(null);
    const r = await updateProfileFromClient(sb, USER, { ...VALID, locale: 'fr' });
    expect(r).toEqual({ success: false, error: 'locale_invalid' });
  });

  it('parcial nombre+fecha (sin locale) → NO escribe locale', async () => {
    const { sb, calls } = makeClient(null);
    const r = await updateProfileFromClient(sb, USER, {
      full_name: 'Ada Lovelace',
      date_of_birth: '1990-01-01',
    });
    expect(r).toEqual({ success: true, locale: '' });
    expect(calls.payload).toEqual({ full_name: 'Ada Lovelace', date_of_birth: '1990-01-01' });
    expect(calls.eq).toEqual(['id', USER]);
  });

  it('parcial solo locale → NO escribe full_name ni date_of_birth', async () => {
    const { sb, calls } = makeClient(null);
    const r = await updateProfileFromClient(sb, USER, { locale: 'en' });
    expect(r).toEqual({ success: true, locale: 'en' });
    expect(calls.payload).toEqual({ locale: 'en' });
    expect(calls.eq).toEqual(['id', USER]);
  });

  it('error de BD en el UPDATE → generic', async () => {
    const { sb } = makeClient({ message: 'db down' });
    const r = await updateProfileFromClient(sb, USER, VALID);
    expect(r).toEqual({ success: false, error: 'generic' });
  });
});

describe('updateAvatarPathFromClient', () => {
  it('path bajo <userId>/ → UPDATE avatar_url', async () => {
    const { sb, calls } = makeClient(null);
    const path = `${USER}/abc.jpg`;
    const r = await updateAvatarPathFromClient(sb, USER, path);
    expect(r).toEqual({ success: true, path });
    expect(calls.payload).toEqual({ avatar_url: path });
    expect(calls.eq).toEqual(['id', USER]);
  });

  it('path fuera de la carpeta del usuario → invalid_path, SIN escribir', async () => {
    const { sb, calls } = makeClient(null);
    const r = await updateAvatarPathFromClient(sb, USER, 'otro-user/abc.jpg');
    expect(r).toEqual({ success: false, error: 'invalid_path' });
    expect(calls.table).toBeUndefined();
  });

  it('path demasiado largo → invalid_path', async () => {
    const { sb } = makeClient(null);
    const long = `${USER}/` + 'a'.repeat(300) + '.jpg';
    const r = await updateAvatarPathFromClient(sb, USER, long);
    expect(r).toEqual({ success: false, error: 'invalid_path' });
  });

  it('error de BD → generic', async () => {
    const { sb } = makeClient({ message: 'db down' });
    const r = await updateAvatarPathFromClient(sb, USER, `${USER}/abc.jpg`);
    expect(r).toEqual({ success: false, error: 'generic' });
  });

  it('cambiar de foto BORRA la anterior del bucket', async () => {
    const previo = `${USER}/vieja.png`;
    const { sb, calls } = makeClient(null, { current: previo });
    await updateAvatarPathFromClient(sb, USER, `${USER}/nueva.png`);
    expect(calls.removed).toEqual([['profile-avatars', previo]]);
  });

  it('guardar la MISMA ruta no borra la foto', async () => {
    const misma = `${USER}/abc.jpg`;
    const { sb, calls } = makeClient(null, { current: misma });
    await updateAvatarPathFromClient(sb, USER, misma);
    expect(calls.removed).toEqual([]);
  });

  it('si el UPDATE falla NO se borra la anterior', async () => {
    const { sb, calls } = makeClient({ message: 'db down' }, { current: `${USER}/vieja.png` });
    await updateAvatarPathFromClient(sb, USER, `${USER}/nueva.png`);
    expect(calls.removed).toEqual([]);
  });
});

describe('clearAvatarPathFromClient', () => {
  it('pone avatar_url a NULL por id', async () => {
    const { sb, calls } = makeClient(null);
    const r = await clearAvatarPathFromClient(sb, USER);
    expect(r).toEqual({ success: true, path: '' });
    expect(calls.payload).toEqual({ avatar_url: null });
    expect(calls.eq).toEqual(['id', USER]);
  });

  it('error de BD → generic', async () => {
    const { sb } = makeClient({ message: 'db down' });
    const r = await clearAvatarPathFromClient(sb, USER);
    expect(r).toEqual({ success: false, error: 'generic' });
  });

  it('BORRA el objeto del bucket, no solo la referencia', async () => {
    const previo = `${USER}/vieja.png`;
    const { sb, calls } = makeClient(null, { current: previo });
    await clearAvatarPathFromClient(sb, USER);
    expect(calls.removed).toEqual([['profile-avatars', previo]]);
  });

  it('sin foto previa no borra nada', async () => {
    const { sb, calls } = makeClient(null, { current: null });
    await clearAvatarPathFromClient(sb, USER);
    expect(calls.removed).toEqual([]);
  });

  it('si el UPDATE falla NO se borra el objeto', async () => {
    const { sb, calls } = makeClient({ message: 'db down' }, { current: `${USER}/vieja.png` });
    await clearAvatarPathFromClient(sb, USER);
    expect(calls.removed).toEqual([]);
  });

  it('si no se puede leer la ruta previa no se borra nada (mejor huérfano que de más)', async () => {
    const { sb, calls } = makeClient(null, {
      current: `${USER}/vieja.png`,
      readError: { message: 'rls' },
    });
    await clearAvatarPathFromClient(sb, USER);
    expect(calls.removed).toEqual([]);
  });
});
