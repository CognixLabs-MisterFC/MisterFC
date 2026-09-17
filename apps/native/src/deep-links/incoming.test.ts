import { describe, it, expect } from 'vitest';
import { resolveInvitePath } from '@/deep-links/incoming';

/**
 * R-4 — la traducción de la URL entrante.
 *
 * Es la pieza del arranque en frío, que es el camino que menos se prueba y el único que
 * el usuario ve la primera vez. Aquí no hay pantalla que mirar: si esto se equivoca, la
 * app abre en la portada y el enlace del correo parece no haber hecho nada.
 */

const TOKEN = '3f7c2b10-8f4a-4e21-9a55-2c1d6e0b7a90';

describe('resolveInvitePath · lo que llega del correo', () => {
  it.each(['es', 'en', 'va'])('quita el locale /%s/ que la app no tiene', (loc) => {
    expect(resolveInvitePath(`https://misterfc.es/${loc}/invite/${TOKEN}`)).toBe(
      `/invite/${TOKEN}`,
    );
  });

  it('tira el FRAGMENTO de error de Supabase y abre igual', () => {
    // Medido en BUG-3: el verify caducado redirige con `#error=…`. Da igual: el token
    // por si solo basta (Rework B), asi que la pantalla tiene que abrirse.
    expect(
      resolveInvitePath(
        `https://misterfc.es/es/invite/${TOKEN}#error=access_denied&error_code=otp_expired`,
      ),
    ).toBe(`/invite/${TOKEN}`);
  });

  it('tira la query', () => {
    expect(resolveInvitePath(`https://misterfc.es/es/invite/${TOKEN}?utm=mail`)).toBe(
      `/invite/${TOKEN}`,
    );
  });

  it('aguanta la barra final', () => {
    expect(resolveInvitePath(`https://misterfc.es/es/invite/${TOKEN}/`)).toBe(
      `/invite/${TOKEN}`,
    );
  });

  it('aguanta espacios alrededor (enlace pegado a mano)', () => {
    expect(resolveInvitePath(`  https://misterfc.es/es/invite/${TOKEN}  `)).toBe(
      `/invite/${TOKEN}`,
    );
  });
});

describe('resolveInvitePath · las otras formas de llegar', () => {
  it('esquema propio: misterfc://invite/token', () => {
    expect(resolveInvitePath(`misterfc://invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
  });

  it('esquema propio CON locale', () => {
    expect(resolveInvitePath(`misterfc://es/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
  });

  it('ruta ya relativa, con locale y sin el', () => {
    expect(resolveInvitePath(`/es/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
    expect(resolveInvitePath(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
  });

  it('http tambien, que un enlace pegado a mano puede perder la s', () => {
    expect(resolveInvitePath(`http://misterfc.es/es/invite/${TOKEN}`)).toBe(
      `/invite/${TOKEN}`,
    );
  });
});

describe('resolveInvitePath · lo que NO es nuestro devuelve null', () => {
  it.each([
    ['la portada', 'https://misterfc.es/es'],
    ['los legales', 'https://misterfc.es/es/legal/terminos'],
    ['el panel', 'https://misterfc.es/es/equipos/123'],
    ['otro dominio con nuestra ruta', 'https://otrositio.com/es/invite/abc'],
    ['invite SIN token', 'https://misterfc.es/es/invite'],
    ['invite con barra y sin token', 'https://misterfc.es/es/invite/'],
    ['vacio', ''],
  ])('%s', (_caso, url) => {
    expect(resolveInvitePath(url)).toBeNull();
  });

  it('null y undefined no revientan', () => {
    expect(resolveInvitePath(null)).toBeNull();
    expect(resolveInvitePath(undefined)).toBeNull();
  });
});

describe('resolveInvitePath · lo que NO hace', () => {
  it('no valida el token: un token con forma rara ABRE la pantalla', () => {
    // Deliberado. Quien decide si un token vale es el servidor, y la pantalla sabe
    // decir "no encontrada". Filtrar aqui por forma haria que un enlace roto pareciera
    // que no hizo nada, que es el peor de los dos fallos.
    expect(resolveInvitePath('https://misterfc.es/es/invite/no-es-un-uuid')).toBe(
      '/invite/no-es-un-uuid',
    );
  });

  it('no se queda con segmentos de mas: /invite/token/loquesea', () => {
    expect(resolveInvitePath(`https://misterfc.es/es/invite/${TOKEN}/extra`)).toBe(
      `/invite/${TOKEN}`,
    );
  });
});
