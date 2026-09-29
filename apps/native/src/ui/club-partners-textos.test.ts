import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARTNER_KINDS } from '@misterfc/core';

/**
 * V-3 — que los socios del club salgan en LOS CUATRO inicios, con texto, y sin
 * guardarse una firma caducada.
 *
 * Tres cosas distintas se vigilan aqui, y ninguna la ve el typecheck:
 *
 *  1. LOS TEXTOS. Los rotulos se piden con una clave CALCULADA
 *     (`t(`partners.${kind}`)`). Una clave que falta no rompe nada: `translate`
 *     devuelve la clave, asi que al usuario le saldria "partners.patrocinador" en
 *     pantalla. Y `check:cadenas-muertas` no puede verlo, porque busca claves SIN
 *     USO, no claves QUE FALTAN.
 *
 *  2. LAS CUATRO SUPERFICIES. La decision fue "se ven en todos los inicios": familia
 *     (que cubre al jugador), staff, direccion y seguidor. Olvidar uno no rompe nada
 *     tampoco — simplemente ese club no le ensena sus patrocinadores a una cuarta
 *     parte de la gente, y a quien paga eso si le importa.
 *
 *  3. LA FIRMA FUERA DE LA CACHE. Es la trampa de este modulo: `useCached` guarda en
 *     disco, y una URL firmada dura una hora. Si alguien "simplifica" el componente
 *     llamando a `getClubPartnersFromClient` (que lee Y firma) dentro del fetcher,
 *     todo seguiria compilando y pasando — y a las pocas horas los logos saldrian
 *     rotos solo a quien abre la app sin conexion. Este test lo impide.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..');
const CATALOGOS = ['es', 'en', 'va'] as const;

function catalogo(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(RAIZ, 'messages', `${locale}.json`), 'utf8'));
}

function clave(obj: Record<string, unknown>, ruta: string): unknown {
  let cur: unknown = obj;
  for (const p of ruta.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const COMPONENTE = readFileSync(join(__dirname, 'club-partners.tsx'), 'utf8');

const PANTALLAS: Record<string, string> = {
  familia: join(RAIZ, 'apps', 'native', 'src', 'screens', 'family', 'inicio.tsx'),
  staff: join(RAIZ, 'apps', 'native', 'src', 'screens', 'staff', 'inicio.tsx'),
  direccion: join(RAIZ, 'apps', 'native', 'src', 'screens', 'direction', 'inicio.tsx'),
  seguidor: join(RAIZ, 'apps', 'native', 'src', 'screens', 'spectator', 'agenda.tsx'),
};

describe('V-3 · los textos de los socios del club', () => {
  it('cada tipo tiene rotulo en los tres idiomas', () => {
    expect(PARTNER_KINDS.length).toBeGreaterThan(0);
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const kind of PARTNER_KINDS) {
        const v = clave(cat, `partners.${kind}`);
        expect(typeof v, `${locale}: falta partners.${kind}`).toBe('string');
        expect((v as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('el titulo de la tarjeta de la web tambien esta en los tres', () => {
    for (const locale of CATALOGOS) {
      const v = clave(catalogo(locale), 'partners.title');
      expect(typeof v, `${locale}: falta partners.title`).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('los tres idiomas dicen cosas DISTINTAS: nadie se dejo el castellano pegado', () => {
    // Un copia-pega del catalogo es el fallo silencioso tipico de un idioma nuevo.
    const porIdioma = CATALOGOS.map((l) => clave(catalogo(l), 'partners.patrocinador'));
    expect(new Set(porIdioma).size, 'es/en/va no deberian coincidir los tres').toBeGreaterThan(1);
  });

  it('la clave que pide el componente es la que existe en el catalogo', () => {
    // El componente calcula la clave. Si alguien renombra el namespace aqui, esto cae.
    expect(COMPONENTE).toContain('`partners.${kind}`');
  });
});

describe('V-3 · las CUATRO superficies', () => {
  for (const [quien, ruta] of Object.entries(PANTALLAS)) {
    it(`el inicio de ${quien} pinta la seccion`, () => {
      const src = readFileSync(ruta, 'utf8');
      expect(src, `${quien}: no importa ClubPartnersSection`).toContain(
        "from '@/ui/club-partners'",
      );
      expect(src, `${quien}: no la renderiza`).toContain('<ClubPartnersSection');
      expect(src, `${quien}: no le pasa el club`).toContain('clubId={clubId}');
    });
  }

  it('el seguidor la pinta AUNQUE no tenga eventos', () => {
    // Su pantalla es una FlatList: antes se sustituia entera por el estado vacio, y
    // los socios habrian desaparecido justo el dia que no hay nada en la agenda.
    const src = readFileSync(PANTALLAS.seguidor!, 'utf8');
    const pie = src.indexOf('ListFooterComponent');
    expect(pie, 'la seccion tiene que ir en el pie de la lista').toBeGreaterThan(-1);
    expect(src.indexOf('<ClubPartnersSection')).toBeGreaterThan(pie);
    expect(src, 'sigue habiendo un estado vacio, dentro de la lista').toContain(
      'ListEmptyComponent',
    );
  });
});

describe('V-3 · la firma NO entra en la cache de disco', () => {
  it('lo que se cachea son las FILAS, sin firmar', () => {
    expect(COMPONENTE).toContain('getClubPartnerRowsFromClient');
  });

  it('NO se usa la funcion que lee y firma de una vez (esa es solo para la web)', () => {
    // `getClubPartnersFromClient` devuelve `logoUrl` ya firmada: cachearla es servir
    // enlaces muertos una hora despues.
    expect(COMPONENTE).not.toContain('getClubPartnersFromClient');
  });

  it('la firma se pide FUERA del fetcher de useCached', () => {
    const fetcher = COMPONENTE.indexOf('useCached');
    const efecto = COMPONENTE.indexOf('useEffect');
    const firma = COMPONENTE.indexOf('signClubPartnerLogosFromClient(supabase');
    expect(fetcher).toBeGreaterThan(-1);
    expect(efecto).toBeGreaterThan(-1);
    // La llamada a firmar vive despues del useEffect, no dentro del useCached.
    expect(firma, 'la firma tiene que ir en el efecto').toBeGreaterThan(efecto);
  });

  it('solo se firma ONLINE: sin conexion se pintan los nombres, no un logo roto', () => {
    expect(COMPONENTE).toContain('useIsOnline');
    expect(COMPONENTE).toContain('if (online &&');
  });

  it('sin socios no se pinta nada: ni rotulo ni hueco', () => {
    expect(COMPONENTE).toContain('if (filas.length === 0) return null;');
  });
});

/**
 * V-4 — las cadenas de la GESTION, que es de la web.
 *
 * Viven vigiladas desde aqui porque el catalogo es UNO para web y app, y porque
 * `apps/web` no ejecuta ni un test: si estas claves no se comprueban en algun sitio,
 * no se comprueban en ninguno. Lo que se afirma es que existen en los tres idiomas y
 * que los mensajes de error CUBREN todos los codigos que devuelven las Server
 * Actions — un codigo sin clave sale como texto generico y quien gestiona no se
 * entera de que el problema era el enlace.
 */
const GESTION = [
  'subtitle', 'count', 'empty', 'new', 'retired', 'retire', 'restore', 'edit', 'delete',
  'delete_confirm', 'move_up', 'move_down', 'change_logo', 'save', 'cancel',
  'field_name', 'field_tagline', 'field_url', 'field_logo',
] as const;

/** Los codigos que pueden llegar desde `actions.ts`, y el de reserva. */
const CODIGOS_DE_ERROR = [
  'error_logo_required', 'error_mime', 'error_too_large', 'error_upload',
  'error_kind', 'error_name', 'error_tagline', 'error_url',
  'error_forbidden', 'error_not_found', 'error_generic',
] as const;

const GESTOR = readFileSync(
  join(RAIZ, 'apps', 'web', 'src', 'app', '[locale]', '(authenticated)', 'patrocinadores', 'partners-manager.tsx'),
  'utf8',
);
const ACCIONES = readFileSync(
  join(RAIZ, 'apps', 'web', 'src', 'app', '[locale]', '(authenticated)', 'patrocinadores', 'actions.ts'),
  'utf8',
);
const PAGINA = readFileSync(
  join(RAIZ, 'apps', 'web', 'src', 'app', '[locale]', '(authenticated)', 'patrocinadores', 'page.tsx'),
  'utf8',
);

describe('V-4 · los textos de la gestion', () => {
  it('estan en los tres idiomas', () => {
    for (const locale of CATALOGOS) {
      const cat = catalogo(locale);
      for (const k of [...GESTION, ...CODIGOS_DE_ERROR]) {
        const v = clave(cat, `partners.manage.${k}`);
        expect(typeof v, `${locale}: falta partners.manage.${k}`).toBe('string');
        expect((v as string).trim().length, `${locale}: ${k} vacia`).toBeGreaterThan(0);
      }
    }
  });

  it('el aviso de borrado nombra al socio y avisa de que se lleva el logo', () => {
    for (const locale of CATALOGOS) {
      const v = clave(catalogo(locale), 'partners.manage.delete_confirm') as string;
      expect(v, `${locale}: sin {name}`).toContain('{name}');
      expect(v.toLowerCase(), `${locale}: no menciona el logo`).toContain('logo');
    }
  });

  it('el recuento usa plural ICU en los tres', () => {
    for (const locale of CATALOGOS) {
      const v = clave(catalogo(locale), 'partners.manage.count') as string;
      expect(v, `${locale}`).toContain('plural,');
    }
  });

  it('la entrada de menu tiene nombre en los tres', () => {
    for (const locale of CATALOGOS) {
      const v = clave(catalogo(locale), 'shell.nav.patrocinadores');
      expect(typeof v, `${locale}: falta shell.nav.patrocinadores`).toBe('string');
    }
  });

  it('cada codigo que devuelven las actions tiene su mensaje', () => {
    // La tabla de traduccion vive en el componente. Un codigo nuevo en actions.ts que
    // nadie anada a la tabla cae en generico, y este test lo hace visible.
    const desde = GESTOR.indexOf('const claves');
    const hasta = GESTOR.indexOf('function claveDeError');
    expect(desde, 'no encuentro la tabla de claves').toBeGreaterThan(-1);
    expect(hasta, 'no encuentro claveDeError').toBeGreaterThan(desde);
    const tabla = GESTOR.slice(desde, hasta);
    for (const code of ['kind', 'name', 'tagline', 'url', 'logo_path', 'forbidden', 'not_found', 'no_active_club', 'invalid']) {
      expect(tabla, `la tabla no nombra ${code}`).toContain(`${code}:`);
    }
    expect(GESTOR, 'lo desconocido tiene que caer en generic').toContain(
      ": 'manage.error_generic'",
    );
  });
});

describe('V-4 · la puerta y lo que no se le pregunta al cliente', () => {
  it('la pagina comprueba el rol en el SERVIDOR, no solo esconde el menu', () => {
    expect(PAGINA).toContain('canManageClubPartners');
    const gate = PAGINA.indexOf('canManageClubPartners');
    const carga = PAGINA.indexOf('getClubPartnersForManageFromClient');
    expect(gate, 'el guard tiene que ir ANTES de leer nada').toBeLessThan(carga);
    expect(PAGINA).toContain('redirect(');
  });

  it('borrar NO acepta la ruta del logo por parametro', () => {
    // Si la aceptara, un cliente podria pasar la ruta del logo de OTRO socio: la
    // policy de Storage autoriza a borrar cualquier objeto de la carpeta del club.
    // La firma de la action es la garantia: un solo argumento.
    expect(ACCIONES).toContain('export async function deletePartner(partnerId: unknown)');
    expect(ACCIONES, 'la ruta se lee de la fila').toContain('filaDelClub');
  });

  it('el club sale de la cookie, no del cliente', () => {
    expect(ACCIONES).toContain('ACTIVE_CLUB_COOKIE_NAME');
    expect(ACCIONES).toContain('resolveActiveClub');
  });

  it('el movimiento se planea sobre la lista LEIDA, no sobre la del navegador', () => {
    const i = ACCIONES.indexOf('export async function movePartner');
    const trozo = ACCIONES.slice(i, i + 1200);
    expect(trozo).toContain('getClubPartnersForManageFromClient');
    expect(trozo).toContain('planClubPartnerMove');
  });

  it('la subida no admite SVG', () => {
    // Un SVG es un documento con script, y esto lo manda una empresa por correo.
    expect(GESTOR).toContain('AVATAR_MIME_TYPES');
    expect(GESTOR).not.toContain('image/svg');
  });
});
