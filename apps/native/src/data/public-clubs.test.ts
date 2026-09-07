import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPublicClubBySlug, listPublicClubs } from './public-clubs';

// `report-error` importa @sentry/react-native (modulo nativo): se sustituye por
// un espia para poder cargar el modulo bajo test en entorno Node. `vi.hoisted` y
// `vi.mock` los sube vitest por encima de los imports de arriba, asi que el mock
// ya aplica cuando se carga `public-clubs` — mismo patron que cache-layer.test.
const { reported } = vi.hoisted(() => ({ reported: [] as string[] }));
vi.mock('@/lib/report-error', () => ({
  reportDataError: (op: string) => {
    reported.push(op);
  },
}));

/**
 * F14J-5A — LO QUE SE PRUEBA AQUÍ ES LA DISTINCIÓN.
 *
 * La pantalla previa al login tiene que separar tres cosas que se parecen mucho
 * cuando se miran deprisa: hay clubes, no hay ninguno, y no se ha podido saber.
 * Confundir las dos últimas es exactamente el fallo que se quería evitar — una
 * frase tranquila («todavía no hay clubes») describiendo un fallo de red, con el
 * usuario incapaz de entrar y sin una pista de por qué.
 */
type RpcResult = { data: unknown; error: unknown };

function fakeSupabase(result: RpcResult, calls?: string[]) {
  return {
    rpc: (name: string) => {
      calls?.push(name);
      return Promise.resolve(result);
    },
  } as never;
}

beforeEach(() => {
  reported.length = 0;
});

describe('listPublicClubs', () => {
  it('con filas → ok y los clubes', async () => {
    const rows = [{ id: '1', name: 'UDFonteta', slug: 'udfonteta', logo_path: 'a.png' }];
    const res = await listPublicClubs(fakeSupabase({ data: rows, error: null }));
    expect(res).toEqual({ ok: true, clubs: rows });
    expect(reported).toEqual([]);
  });

  it('lista VACÍA es un éxito, no un fallo', async () => {
    const res = await listPublicClubs(fakeSupabase({ data: [], error: null }));
    expect(res).toEqual({ ok: true, clubs: [] });
    // Un directorio vacío no es una anomalía: no se reporta nada.
    expect(reported).toEqual([]);
  });

  it('error → ok:false, y se reporta', async () => {
    const res = await listPublicClubs(
      fakeSupabase({ data: null, error: { message: 'network', code: '500' } })
    );
    expect(res).toEqual({ ok: false });
    expect(reported).toEqual(['public-clubs-list']);
  });

  it('data nula SIN error tampoco es lista vacía', async () => {
    // El caso raro: si no hay datos y tampoco error, no sabemos nada. Tratarlo
    // como [] pintaría «no hay clubes» sin haberlo comprobado.
    const res = await listPublicClubs(fakeSupabase({ data: null, error: null }));
    expect(res).toEqual({ ok: false });
    expect(reported).toEqual(['public-clubs-list']);
  });

  it('llama a la RPC, no a la tabla', async () => {
    // Un SELECT directo sobre `clubs` sin sesión devuelve 200 [] por RLS: si
    // alguien cambiara esto por `.from('clubs')`, el selector saldría vacío en
    // producción y en silencio.
    const calls: string[] = [];
    await listPublicClubs(fakeSupabase({ data: [], error: null }, calls));
    expect(calls).toEqual(['list_public_clubs']);
  });
});

describe('getPublicClubBySlug', () => {
  it('encontrado → ok con el club', async () => {
    const row = { id: '1', name: 'UDFonteta', slug: 'udfonteta', logo_path: null };
    const res = await getPublicClubBySlug(fakeSupabase({ data: [row], error: null }), 'udfonteta');
    expect(res).toEqual({ ok: true, club: row });
  });

  it('0 filas → ok con club nulo: el club ya no existe', async () => {
    // Es una RESPUESTA, no un fallo: con ella la pantalla olvida el club
    // recordado y manda al selector.
    const res = await getPublicClubBySlug(fakeSupabase({ data: [], error: null }), 'fantasma');
    expect(res).toEqual({ ok: true, club: null });
    expect(reported).toEqual([]);
  });

  it('error → ok:false, y NO se confunde con "no existe"', async () => {
    // La diferencia vale un acceso: con ok:false se entra igual sin escudo, y
    // con club:null se manda al selector. Si se mezclaran, un fallo de red
    // echaría al usuario del login que sí podía usar.
    const res = await getPublicClubBySlug(
      fakeSupabase({ data: null, error: { message: 'timeout' } }),
      'udfonteta'
    );
    expect(res).toEqual({ ok: false });
    expect(reported).toEqual(['public-clubs-by-slug']);
  });

  it('llama a la RPC por slug', async () => {
    const calls: string[] = [];
    await getPublicClubBySlug(fakeSupabase({ data: [], error: null }, calls), 'x');
    expect(calls).toEqual(['get_public_club_by_slug']);
  });
});
