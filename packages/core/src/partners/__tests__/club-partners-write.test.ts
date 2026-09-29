/**
 * V-4 — la gestion de socios.
 *
 * Lo que se prueba aqui es lo que la web NO puede probar: `apps/web` no ejecuta ni un
 * test, asi que las reglas bajaron a core para tener estos. Tres zonas:
 *
 *  · LA VALIDACION, que repite los CHECK de la tabla para poder dar un mensaje en vez
 *    de un 23514. El test los nombra uno a uno: si manana cambia un CHECK y no se
 *    cambia aqui, cae.
 *  · LA RUTA DEL LOGO, cuya primera carpeta TIENE que ser el club_id porque es lo que
 *    mira la policy de Storage. Equivocarla no da un error de validacion, da un 42501.
 *  · EL MOVIMIENTO, que es puro y es donde estan las dos trampas: el vecino se busca
 *    dentro del mismo tipo, y las posiciones se reasignan en vez de intercambiarse
 *    porque todas las filas nacen con sort_order = 0.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  validateClubPartnerInput,
  clubPartnerLogoObjectPath,
  nextClubPartnerSortOrder,
  planClubPartnerMove,
  deleteClubPartnerFromClient,
  setClubPartnerActiveFromClient,
  applyClubPartnerOrderFromClient,
  createClubPartnerFromClient,
  getClubPartnersForManageFromClient,
  CLUB_PARTNER_NAME_MAX,
  CLUB_PARTNER_TAGLINE_MAX,
  CLUB_PARTNER_URL_MAX,
} from '../club-partners-write';
import type { PartnerKind } from '../club-partners';

const CLUB = 'cb000000-0000-4000-8000-000000000001';

const BASE = { kind: 'patrocinador', name: 'Ferreteria Paco', tagline: 'Todo para tu casa', url: 'https://paco.test' };

describe('validateClubPartnerInput · los limites son los del esquema', () => {
  it('acepta lo normal y NORMALIZA los espacios', () => {
    const r = validateClubPartnerInput({ ...BASE, name: '  Paco  ', url: '  https://paco.test  ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Paco');
    expect(r.value.url).toBe('https://paco.test');
  });

  it('una linea en blanco se guarda como NULL, no como cadena vacia', () => {
    // El CHECK rechaza '': mandar lo que escribio nadie seria un 23514.
    for (const vacio of ['', '   ', null, undefined]) {
      const r = validateClubPartnerInput({ ...BASE, tagline: vacio });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.tagline).toBeNull();
    }
  });

  it('un kind que no es de la tabla se rechaza', () => {
    expect(validateClubPartnerInput({ ...BASE, kind: 'mecenas' })).toEqual({ ok: false, error: 'kind' });
  });

  it('nombre: 1..120, y los espacios no cuentan', () => {
    expect(validateClubPartnerInput({ ...BASE, name: '   ' })).toEqual({ ok: false, error: 'name' });
    expect(validateClubPartnerInput({ ...BASE, name: 'x'.repeat(CLUB_PARTNER_NAME_MAX) }).ok).toBe(true);
    expect(validateClubPartnerInput({ ...BASE, name: 'x'.repeat(CLUB_PARTNER_NAME_MAX + 1) })).toEqual({
      ok: false, error: 'name',
    });
  });

  it('linea: hasta 160', () => {
    expect(validateClubPartnerInput({ ...BASE, tagline: 'x'.repeat(CLUB_PARTNER_TAGLINE_MAX) }).ok).toBe(true);
    expect(validateClubPartnerInput({ ...BASE, tagline: 'x'.repeat(CLUB_PARTNER_TAGLINE_MAX + 1) })).toEqual({
      ok: false, error: 'tagline',
    });
  });

  it('EL ENLACE: solo http y https, nada de javascript: ni data:', () => {
    // Esto es lo serio: la app lo abre con Linking.openURL y la web lo pinta de href.
    for (const malo of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,AAAA',
      'file:///etc/passwd',
      'ftp://paco.test',
      'paco.test',
      '//paco.test',
      ' javascript:alert(1)',
    ]) {
      expect(validateClubPartnerInput({ ...BASE, url: malo }), malo).toEqual({ ok: false, error: 'url' });
    }
    for (const bueno of ['http://a.bc', 'https://paco.test', 'HTTPS://PACO.TEST']) {
      expect(validateClubPartnerInput({ ...BASE, url: bueno }).ok, bueno).toBe(true);
    }
  });

  it('enlace: 8..500', () => {
    expect(validateClubPartnerInput({ ...BASE, url: 'http://' })).toEqual({ ok: false, error: 'url' });
    const largo = 'https://a.bc/' + 'x'.repeat(CLUB_PARTNER_URL_MAX);
    expect(validateClubPartnerInput({ ...BASE, url: largo })).toEqual({ ok: false, error: 'url' });
  });
});

describe('clubPartnerLogoObjectPath · la primera carpeta es el club', () => {
  it('la ruta empieza por el club_id, que es lo que mira la policy de Storage', () => {
    const r = clubPartnerLogoObjectPath(CLUB, 'image/webp', 'aaa');
    expect(r).toEqual({ ok: true, path: `${CLUB}/aaa.webp` });
    if (r.ok) expect(r.path.split('/')[0]).toBe(CLUB);
  });

  it('cada mime aceptado trae su extension', () => {
    expect(clubPartnerLogoObjectPath(CLUB, 'image/jpeg', 'a')).toEqual({ ok: true, path: `${CLUB}/a.jpg` });
    expect(clubPartnerLogoObjectPath(CLUB, 'image/png', 'a')).toEqual({ ok: true, path: `${CLUB}/a.png` });
  });

  it('un tipo que no se acepta no inventa extension', () => {
    // Sin esto acabaria un `.png` mintiendo sobre un svg o un gif.
    for (const m of ['image/svg+xml', 'image/gif', 'application/pdf', '']) {
      expect(clubPartnerLogoObjectPath(CLUB, m), m).toEqual({ ok: false, error: 'mime' });
    }
  });

  it('sin uuid a mano tambien funciona, y no repite', () => {
    const a = clubPartnerLogoObjectPath(CLUB, 'image/png');
    const b = clubPartnerLogoObjectPath(CLUB, 'image/png');
    expect(a.ok && b.ok && a.path !== b.path).toBe(true);
  });
});

describe('nextClubPartnerSortOrder · el nuevo va al final DE SU TIPO', () => {
  const p = (kind: PartnerKind, sortOrder: number) => ({ kind, sortOrder });

  it('el primero de su tipo empieza en 0', () => {
    expect(nextClubPartnerSortOrder([], 'patrocinador')).toBe(0);
    expect(nextClubPartnerSortOrder([p('colaborador', 7)], 'patrocinador')).toBe(0);
  });

  it('detras del ultimo de su tipo, ignorando al otro tipo', () => {
    const lista = [p('patrocinador', 0), p('patrocinador', 1), p('colaborador', 9)];
    expect(nextClubPartnerSortOrder(lista, 'patrocinador')).toBe(2);
    // Y no 10: un colaborador nuevo va al final de los colaboradores.
    expect(nextClubPartnerSortOrder(lista, 'colaborador')).toBe(10);
  });
});

describe('planClubPartnerMove · las dos trampas del orden', () => {
  const p = (id: string, kind: PartnerKind, sortOrder: number) => ({ id, kind, sortOrder });

  it('sube uno: solo escribe las filas que cambian', () => {
    const lista = [p('a', 'patrocinador', 0), p('b', 'patrocinador', 1), p('c', 'patrocinador', 2)];
    expect(planClubPartnerMove(lista, 'b', 'up')).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
  });

  it('baja uno', () => {
    const lista = [p('a', 'patrocinador', 0), p('b', 'patrocinador', 1)];
    expect(planClubPartnerMove(lista, 'a', 'down')).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
  });

  it('TRAMPA 1 — el vecino se busca DENTRO de su tipo', () => {
    // 'x' esta en medio por sort_order pero es del otro tipo: subir 'b' tiene que
    // intercambiarlo con 'a', no con 'x'. Si se mirara la lista global, el usuario
    // pulsaria la flecha y su seccion no se moveria.
    const lista = [
      p('a', 'patrocinador', 0),
      p('x', 'colaborador', 1),
      p('b', 'patrocinador', 2),
    ];
    const plan = planClubPartnerMove(lista, 'b', 'up');
    expect(plan).not.toBeNull();
    expect(plan!.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(plan!.find((e) => e.id === 'x')).toBeUndefined();
  });

  it('TRAMPA 2 — con todo a 0 (el default de la columna) el movimiento SI mueve', () => {
    // Intercambiar dos ceros no cambia nada; hay que reasignar posiciones.
    const lista = [p('a', 'patrocinador', 0), p('b', 'patrocinador', 0), p('c', 'patrocinador', 0)];
    const plan = planClubPartnerMove(lista, 'c', 'up');
    expect(plan).not.toBeNull();
    expect(plan!.length).toBeGreaterThan(0);
    // Queda un orden estricto, sin empates.
    const finales = new Map(plan!.map((e) => [e.id, e.sortOrder]));
    const resultado = lista
      .map((x) => ({ id: x.id, so: finales.get(x.id) ?? x.sortOrder }))
      .sort((m, n) => m.so - n.so)
      .map((x) => x.id);
    expect(new Set(resultado).size).toBe(3);
    expect(resultado.indexOf('c')).toBeLessThan(resultado.indexOf('b'));
  });

  it('el primero no sube y el ultimo no baja: null, y nadie escribe', () => {
    const lista = [p('a', 'patrocinador', 0), p('b', 'patrocinador', 1)];
    expect(planClubPartnerMove(lista, 'a', 'up')).toBeNull();
    expect(planClubPartnerMove(lista, 'b', 'down')).toBeNull();
  });

  it('un id que no esta en la lista devuelve null en vez de reordenar a ciegas', () => {
    expect(planClubPartnerMove([p('a', 'patrocinador', 0)], 'zzz', 'up')).toBeNull();
  });

  it('el unico de su tipo no se mueve a ningun lado', () => {
    const lista = [p('a', 'patrocinador', 0), p('x', 'colaborador', 1)];
    expect(planClubPartnerMove(lista, 'a', 'up')).toBeNull();
    expect(planClubPartnerMove(lista, 'a', 'down')).toBeNull();
  });
});

/** Doble que anota la tabla, los filtros y lo que se borra de Storage. */
function clienteFalso(opts: { error?: unknown; filas?: Record<string, unknown>[] } = {}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  const quitados: string[][] = [];
  const orden: string[] = [];
  let ultimoEq: [string, unknown] | null = null;
  const restringidas = new Set<string>();

  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    order: (c: string) => { orden.push(c); return b; },
    insert: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: opts.error ?? null }); },
    update: (row: Record<string, unknown>) => { updates.push(row); return b; },
    delete: () => { b.__borrando = true; return b; },
    eq: (col: string, val: unknown) => {
      ultimoEq = [col, val];
      restringidas.add(col);
      if (b.__borrando) { deletes.push(String(val)); b.__borrando = false; return Promise.resolve({ error: opts.error ?? null }); }
      return b;
    },
    then: (r: (v: unknown) => unknown) =>
      Promise.resolve(
        opts.error ? { data: null, error: opts.error } : { data: opts.filas ?? [], error: null },
      ).then(r),
  });

  return {
    cliente: {
      from: () => b,
      storage: {
        from: () => ({
          remove: async (paths: string[]) => { quitados.push([...paths]); return { data: null, error: null }; },
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((p) => ({ path: p, signedUrl: `https://f.test/${p}` })),
            error: null,
          }),
        }),
      },
    } as never,
    updates, inserts, deletes, quitados, orden, restringidas,
    get ultimoEq() { return ultimoEq; },
  };
}

describe('deleteClubPartnerFromClient · la fila primero, el logo despues', () => {
  it('borra la fila y luego el objeto', async () => {
    const f = clienteFalso();
    const r = await deleteClubPartnerFromClient(f.cliente, 'p1', `${CLUB}/a.webp`);
    expect(r).toEqual({ success: true });
    expect(f.deletes).toEqual(['p1']);
    expect(f.quitados).toEqual([[`${CLUB}/a.webp`]]);
  });

  it('si la fila NO se borra, el objeto se queda: nada de logos sin fila', async () => {
    const f = clienteFalso({ error: { code: '42501' } });
    const r = await deleteClubPartnerFromClient(f.cliente, 'p1', `${CLUB}/a.webp`);
    expect(r).toEqual({ success: false, error: 'forbidden' });
    expect(f.quitados, 'no se toca Storage si la fila sigue viva').toEqual([]);
  });

  it('sin logo no llama a Storage', async () => {
    const f = clienteFalso();
    await deleteClubPartnerFromClient(f.cliente, 'p1', null);
    expect(f.quitados).toEqual([]);
  });

  it('un Storage que revienta NO tumba el borrado: lo pedido ya esta hecho', async () => {
    const cliente = {
      from: () => ({ delete: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      storage: { from: () => ({ remove: () => { throw new Error('boom'); } }) },
    } as never;
    await expect(deleteClubPartnerFromClient(cliente, 'p1', 'x')).resolves.toEqual({ success: true });
  });
});

describe('las escrituras distinguen el 42501', () => {
  it('un no de la RLS se traduce a forbidden, no a generic', async () => {
    const f = clienteFalso({ error: { code: '42501' } });
    expect(await setClubPartnerActiveFromClient(f.cliente, 'p1', false)).toEqual({
      success: false, error: 'forbidden',
    });
  });

  it('cualquier otro error es generic', async () => {
    const f = clienteFalso({ error: { code: '23514' } });
    expect(await setClubPartnerActiveFromClient(f.cliente, 'p1', true)).toEqual({
      success: false, error: 'generic',
    });
  });
});

describe('createClubPartnerFromClient · defiende el logo_path', () => {
  it('escribe la fila con lo que toca', async () => {
    const f = clienteFalso();
    const r = await createClubPartnerFromClient(
      f.cliente, CLUB,
      { kind: 'colaborador', name: 'Paco', tagline: null, url: 'https://paco.test' },
      `${CLUB}/a.webp`, 3,
    );
    expect(r).toEqual({ success: true });
    expect(f.inserts[0]).toMatchObject({
      club_id: CLUB, kind: 'colaborador', name: 'Paco', tagline: null,
      logo_path: `${CLUB}/a.webp`, url: 'https://paco.test', sort_order: 3,
    });
  });

  it('una URL en logo_path se rechaza ANTES de llegar al CHECK', async () => {
    const f = clienteFalso();
    const r = await createClubPartnerFromClient(
      f.cliente, CLUB, { kind: 'patrocinador', name: 'x', tagline: null, url: 'https://a.bc' },
      'https://cdn.test/logo.png', 0,
    );
    expect(r).toEqual({ success: false, error: 'logo_path' });
    expect(f.inserts).toEqual([]);
  });

  it('una ruta vacia tampoco pasa', async () => {
    const f = clienteFalso();
    const r = await createClubPartnerFromClient(
      f.cliente, CLUB, { kind: 'patrocinador', name: 'x', tagline: null, url: 'https://a.bc' }, '', 0,
    );
    expect(r).toEqual({ success: false, error: 'logo_path' });
  });
});

describe('applyClubPartnerOrderFromClient', () => {
  it('escribe una posicion por fila', async () => {
    const f = clienteFalso();
    const r = await applyClubPartnerOrderFromClient(f.cliente, [
      { id: 'b', sortOrder: 0 }, { id: 'a', sortOrder: 1 },
    ]);
    expect(r).toEqual({ success: true });
    expect(f.updates).toEqual([{ sort_order: 0 }, { sort_order: 1 }]);
  });

  it('un plan vacio no escribe nada', async () => {
    const f = clienteFalso();
    expect(await applyClubPartnerOrderFromClient(f.cliente, [])).toEqual({ success: true });
    expect(f.updates).toEqual([]);
  });

  it('se corta en el primer fallo', async () => {
    const f = clienteFalso({ error: { code: '42501' } });
    const r = await applyClubPartnerOrderFromClient(f.cliente, [
      { id: 'b', sortOrder: 0 }, { id: 'a', sortOrder: 1 },
    ]);
    expect(r).toEqual({ success: false, error: 'forbidden' });
    expect(f.updates).toHaveLength(1);
  });
});

describe('getClubPartnersForManageFromClient · esta SI trae los retirados', () => {
  it('NO filtra active: quien gestiona necesita ver al que se fue para devolverlo', async () => {
    const f = clienteFalso({
      filas: [
        { id: 'p1', kind: 'patrocinador', name: 'A', tagline: null, logo_path: `${CLUB}/a.webp`, url: 'https://a.bc', sort_order: 0, active: true },
        { id: 'p2', kind: 'patrocinador', name: 'B', tagline: null, logo_path: `${CLUB}/b.webp`, url: 'https://b.bc', sort_order: 1, active: false },
      ],
    });
    const out = await getClubPartnersForManageFromClient(f.cliente, CLUB);
    expect(out.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(out.map((p) => p.active)).toEqual([true, false]);
    // Y el filtro NO se pide, al contrario que en los inicios.
    expect(f.restringidas.has('active')).toBe(false);
    expect(f.restringidas.has('club_id')).toBe(true);
  });

  it('trae la ruta cruda, que es lo que hace falta para borrar el objeto', async () => {
    const f = clienteFalso({
      filas: [{ id: 'p1', kind: 'patrocinador', name: 'A', tagline: null, logo_path: `${CLUB}/a.webp`, url: 'https://a.bc', sort_order: 0, active: true }],
    });
    const out = await getClubPartnersForManageFromClient(f.cliente, CLUB);
    expect(out[0]!.logoPath).toBe(`${CLUB}/a.webp`);
    expect(out[0]!.logoUrl).toBe(`https://f.test/${CLUB}/a.webp`);
  });

  it('un fallo de lectura avisa y devuelve []', async () => {
    const onError = vi.fn();
    const f = clienteFalso({ error: { message: 'x' } });
    await expect(getClubPartnersForManageFromClient(f.cliente, CLUB, onError)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith({ message: 'x' }, 'select');
  });
});
