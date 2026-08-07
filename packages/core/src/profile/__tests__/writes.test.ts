import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  updateProfileFromClient,
  updateAvatarPathFromClient,
  clearAvatarPathFromClient,
} from '../writes';
import type { Database } from '../../supabase/types';

/**
 * Mock de `supabase.from('profiles').update(payload).eq('id', userId)` → { error }.
 * Captura tabla, payload y filtro para aseverar QUÉ se escribe (RLS por la propia
 * fila). Devuelve el `error` configurado.
 */
function makeClient(error: unknown = null) {
  const calls: { table?: string; payload?: unknown; eq?: [string, unknown] } = {};
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
      };
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
});
