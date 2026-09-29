/**
 * V-2 — la lectura de socios del club.
 *
 * EL DOBLE ANOTA LO QUE SE LE PIDE, y eso es la mitad del valor de este fichero. Un
 * cliente falso que sirva filas sin mirar el `select` mide el doble, no el código: es
 * el fallo que cazamos dos veces en la serie W (CN7 y CN16), donde un `.is()` que
 * ignoraba la columna dejaba pasar tests que decían proteger un ámbito y no medían
 * nada. Aquí `eq` y `order` se ANOTAN, y hay un test que falla si alguien quita el
 * `.eq('active', true)` del código — que es justo el filtro que la RLS NO aplica a
 * quien gestiona.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  canManageClubPartners,
  getClubPartnersFromClient,
  groupPartnersByKind,
  PARTNER_KINDS,
  type ClubPartner,
} from '../club-partners';

const CLUB = 'club-a';

type Fila = {
  id: string;
  club_id: string;
  kind: string;
  name: string;
  tagline: string | null;
  logo_path: string;
  url: string;
  active: boolean;
  created_at: string;
};

function fila(over: Partial<Fila> = {}): Fila {
  return {
    id: 'p1',
    club_id: CLUB,
    kind: 'patrocinador',
    name: 'Ferretería Paco',
    tagline: 'Todo para tu casa',
    logo_path: `${CLUB}/paco.webp`,
    url: 'https://paco.test',
    active: true,
    created_at: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function clienteFalso(opts: {
  filas?: Fila[];
  errorSelect?: unknown;
  errorFirma?: unknown;
} = {}) {
  const eqs: Record<string, unknown> = {};
  const restringidas = new Set<string>();
  const orders: string[] = [];
  const firmasPedidas: string[][] = [];

  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (col: string, val: unknown) => {
      eqs[col] = val;
      restringidas.add(col);
      return b;
    },
    order: (col: string) => {
      orders.push(col);
      return b;
    },
    // Awaitable: el codigo hace `await supabase.from(...).select(...)...`
    then: (resolver: (v: unknown) => unknown) => {
      if (opts.errorSelect) {
        return Promise.resolve({ data: null, error: opts.errorSelect }).then(resolver);
      }
      // Solo se aplican los filtros que el codigo PIDIO de verdad.
      const dentro = (opts.filas ?? []).filter(
        (f) =>
          (!restringidas.has('club_id') || f.club_id === eqs.club_id) &&
          (!restringidas.has('active') || f.active === eqs.active),
      );
      return Promise.resolve({ data: dentro, error: null }).then(resolver);
    },
  });

  const cliente = {
    from: () => b,
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          firmasPedidas.push([...paths]);
          if (opts.errorFirma) return { data: null, error: opts.errorFirma };
          return {
            data: paths.map((p) => ({ path: p, signedUrl: `https://firmada.test/${p}` })),
            error: null,
          };
        },
      }),
    },
  };

  return {
    cliente: cliente as never,
    eqs,
    restringidas,
    orders,
    get firmasPedidas() {
      return firmasPedidas;
    },
  };
}

describe('canManageClubPartners', () => {
  it('admin_club y director si', () => {
    expect(canManageClubPartners('admin_club')).toBe(true);
    expect(canManageClubPartners('director')).toBe(true);
  });

  it('nadie mas, y la ausencia de rol tampoco', () => {
    for (const rol of ['coordinador', 'entrenador_principal', 'entrenador_ayudante', 'jugador'] as const) {
      expect(canManageClubPartners(rol)).toBe(false);
    }
    expect(canManageClubPartners(null)).toBe(false);
    expect(canManageClubPartners(undefined)).toBe(false);
  });
});

describe('getClubPartnersFromClient · la consulta', () => {
  it('pide el club Y `active`: es el filtro que la RLS NO aplica a quien gestiona', async () => {
    const f = clienteFalso({ filas: [fila()] });
    await getClubPartnersFromClient(f.cliente, CLUB);
    expect(f.restringidas.has('club_id')).toBe(true);
    expect(f.eqs.club_id).toBe(CLUB);
    // Si alguien quita el `.eq('active', true)` del codigo, esto se pone rojo.
    expect(f.restringidas.has('active')).toBe(true);
    expect(f.eqs.active).toBe(true);
  });

  it('ordena por sort_order y DESEMPATA por created_at', async () => {
    const f = clienteFalso({ filas: [fila()] });
    await getClubPartnersFromClient(f.cliente, CLUB);
    expect(f.orders).toEqual(['sort_order', 'created_at']);
  });

  it('el socio RETIRADO no sale', async () => {
    const f = clienteFalso({
      filas: [fila({ id: 'vivo' }), fila({ id: 'retirado', active: false })],
    });
    const out = await getClubPartnersFromClient(f.cliente, CLUB);
    expect(out.map((p) => p.id)).toEqual(['vivo']);
  });

  it('el socio de OTRO club no sale', async () => {
    const f = clienteFalso({
      filas: [fila({ id: 'mio' }), fila({ id: 'ajeno', club_id: 'club-b' })],
    });
    const out = await getClubPartnersFromClient(f.cliente, CLUB);
    expect(out.map((p) => p.id)).toEqual(['mio']);
  });
});

describe('getClubPartnersFromClient · el logo', () => {
  it('firma en LOTE y cada fila recibe la suya', async () => {
    const f = clienteFalso({
      filas: [
        fila({ id: 'a', logo_path: `${CLUB}/a.webp` }),
        fila({ id: 'b', kind: 'colaborador', logo_path: `${CLUB}/b.webp` }),
      ],
    });
    const out = await getClubPartnersFromClient(f.cliente, CLUB);
    expect(f.firmasPedidas).toEqual([[`${CLUB}/a.webp`, `${CLUB}/b.webp`]]);
    expect(out.map((p) => p.logoUrl)).toEqual([
      `https://firmada.test/${CLUB}/a.webp`,
      `https://firmada.test/${CLUB}/b.webp`,
    ]);
  });

  it('si la firma falla, la fila SIGUE (sin logo) y se avisa', async () => {
    const onError = vi.fn();
    const f = clienteFalso({ filas: [fila()], errorFirma: new Error('storage caido') });
    const out = await getClubPartnersFromClient(f.cliente, CLUB, onError);
    expect(out).toHaveLength(1);
    expect(out[0]?.logoUrl).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'sign');
  });

  it('sin filas NO se pide ninguna firma', async () => {
    const f = clienteFalso({ filas: [] });
    const out = await getClubPartnersFromClient(f.cliente, CLUB);
    expect(out).toEqual([]);
    expect(f.firmasPedidas).toEqual([]);
  });

  it('el TTL se pasa tal cual a la firma', async () => {
    const f = clienteFalso({ filas: [fila()] });
    const espia = vi.fn(async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: 'x' })),
      error: null,
    }));
    const cliente = {
      ...(f.cliente as object),
      storage: { from: () => ({ createSignedUrls: espia }) },
    } as never;
    await getClubPartnersFromClient(cliente, CLUB, undefined, 60);
    expect(espia).toHaveBeenCalledWith(expect.anything(), 60);
  });
});

describe('getClubPartnersFromClient · lo que puede ir mal', () => {
  it('un fallo de lectura devuelve lista vacia PERO avisa: un [] mudo parece «no hay socios»', async () => {
    const onError = vi.fn();
    const f = clienteFalso({ errorSelect: { message: '42501' } });
    const out = await getClubPartnersFromClient(f.cliente, CLUB, onError);
    expect(out).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'select');
  });

  it('un `kind` desconocido se CAE y avisa: no se pinta a una empresa bajo un rotulo falso', async () => {
    const onError = vi.fn();
    const f = clienteFalso({
      filas: [fila({ id: 'ok' }), fila({ id: 'raro', kind: 'mecenas' })],
    });
    const out = await getClubPartnersFromClient(f.cliente, CLUB, onError);
    expect(out.map((p) => p.id)).toEqual(['ok']);
    expect(onError).toHaveBeenCalledWith(expect.anything(), 'kind');
  });

  it('si TODAS las filas tienen un kind raro, lista vacia y sin firmar nada', async () => {
    const onError = vi.fn();
    const f = clienteFalso({ filas: [fila({ kind: 'mecenas' })] });
    const out = await getClubPartnersFromClient(f.cliente, CLUB, onError);
    expect(out).toEqual([]);
    expect(f.firmasPedidas).toEqual([]);
  });

  it('sin `onError` no revienta', async () => {
    const f = clienteFalso({ errorSelect: { message: 'x' } });
    await expect(getClubPartnersFromClient(f.cliente, CLUB)).resolves.toEqual([]);
  });
});

describe('groupPartnersByKind', () => {
  const socio = (id: string, kind: ClubPartner['kind']): ClubPartner => ({
    id,
    kind,
    name: id,
    tagline: null,
    logoUrl: null,
    url: 'https://x.test',
  });

  it('reparte en las dos secciones conservando el orden de llegada', () => {
    const g = groupPartnersByKind([
      socio('p1', 'patrocinador'),
      socio('c1', 'colaborador'),
      socio('p2', 'patrocinador'),
    ]);
    expect(g.patrocinador.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(g.colaborador.map((p) => p.id)).toEqual(['c1']);
  });

  it('devuelve SIEMPRE las dos claves, aunque esten vacias', () => {
    const g = groupPartnersByKind([]);
    expect(Object.keys(g).sort()).toEqual(['colaborador', 'patrocinador']);
    expect(g.patrocinador).toEqual([]);
    expect(g.colaborador).toEqual([]);
  });

  it('el orden de las secciones lo manda PARTNER_KINDS, y quien paga va primero', () => {
    expect(PARTNER_KINDS).toEqual(['patrocinador', 'colaborador']);
  });
});
