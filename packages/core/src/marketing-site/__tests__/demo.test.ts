import { describe, expect, it } from 'vitest';
import { crearLimitePorVentana, DEMO_TRAMPA, leerSolicitudDemo } from '../demo';

const BUENA: Record<string, string> = {
  nombre: 'Ana Pérez',
  papel: 'coordinacion',
  club: 'CF Ejemplo',
  municipio: 'Valencia',
  equipos: 'de6a10',
  email: ' ana@example.com ',
  telefono: '',
  comentario: '',
  privacidad: 'on',
};

const lector =
  (form: Record<string, string>) =>
  (campo: string): string | null =>
    campo in form ? (form[campo] ?? null) : null;

describe('leerSolicitudDemo', () => {
  it('premisa: la solicitud de ejemplo es válida y llega recortada', () => {
    const r = leerSolicitudDemo(lector(BUENA));
    expect(r.estado).toBe('valida');
    if (r.estado === 'valida') expect(r.datos.email).toBe('ana@example.com');
  });

  it('los opcionales pueden no venir', () => {
    const { telefono: _t, comentario: _c, ...sin } = BUENA;
    expect(leerSolicitudDemo(lector(sin)).estado).toBe('valida');
  });

  it('el campo trampa con algo dentro gana a todo lo demás', () => {
    expect(leerSolicitudDemo(lector({ ...BUENA, [DEMO_TRAMPA]: 'http://x' })).estado).toBe(
      'trampa',
    );
    expect(leerSolicitudDemo(lector({ [DEMO_TRAMPA]: 'x' })).estado).toBe('trampa');
    expect(leerSolicitudDemo(lector({ ...BUENA, [DEMO_TRAMPA]: '  ' })).estado).toBe('valida');
  });

  it('formulario vacío: los 6 obligatorios y la casilla, en el orden de la página', () => {
    expect(leerSolicitudDemo(lector({}))).toEqual({
      estado: 'invalida',
      campos: ['nombre', 'papel', 'club', 'municipio', 'equipos', 'email', 'privacidad'],
    });
  });

  it.each([
    ['casilla sin marcar', { privacidad: undefined }, 'privacidad'],
    ['correo mal escrito', { email: 'ana@' }, 'email'],
    ['papel que no está en la lista', { papel: 'presidente' }, 'papel'],
    ['equipos que no está en la lista', { equipos: '1-5' }, 'equipos'],
    ['teléfono con letras', { telefono: 'llámame' }, 'telefono'],
    ['comentario de 501', { comentario: 'a'.repeat(501) }, 'comentario'],
    ['salto de línea en el club', { club: 'CF\r\nBcc: x' }, 'club'],
    ['solo espacios en el nombre', { nombre: '   ' }, 'nombre'],
  ] as const)('%s → marca %s', (_n, cambio, campo) => {
    const form: Record<string, string> = { ...BUENA };
    for (const [k, v] of Object.entries(cambio)) {
      if (v === undefined) delete form[k];
      else form[k] = v;
    }
    expect(leerSolicitudDemo(lector(form))).toEqual({ estado: 'invalida', campos: [campo] });
  });

  it('comentario de 500 y teléfono con prefijo valen', () => {
    const r = leerSolicitudDemo(
      lector({ ...BUENA, comentario: 'a'.repeat(500), telefono: '+34 600 00 00 00' }),
    );
    expect(r.estado).toBe('valida');
  });
});

describe('crearLimitePorVentana', () => {
  const HORA = 3_600_000;

  it('5 por hora y clave: el 6.º no cabe y dice cuánto falta', () => {
    const l = crearLimitePorVentana({ max: 5, ventanaMs: HORA });
    for (let i = 0; i < 5; i += 1) expect(l.intentar('1.2.3.4', 1000 + i)).toEqual({ ok: true });
    expect(l.intentar('1.2.3.4', 2000)).toEqual({ ok: false, esperaMs: 1000 + HORA - 2000 });
  });

  it('cada clave lleva su cuenta', () => {
    const l = crearLimitePorVentana({ max: 1, ventanaMs: HORA });
    expect(l.intentar('a', 0).ok).toBe(true);
    expect(l.intentar('b', 0).ok).toBe(true);
    expect(l.intentar('a', 1).ok).toBe(false);
  });

  it('la ventana desliza: al pasar una hora del primero, vuelve a caber uno', () => {
    const l = crearLimitePorVentana({ max: 2, ventanaMs: HORA });
    l.intentar('a', 0);
    l.intentar('a', 10);
    expect(l.intentar('a', HORA - 1).ok).toBe(false);
    expect(l.intentar('a', HORA).ok).toBe(true);
    expect(l.intentar('a', HORA + 5).ok).toBe(false);
  });

  it('un intento rechazado no alarga la espera', () => {
    const l = crearLimitePorVentana({ max: 1, ventanaMs: HORA });
    l.intentar('a', 0);
    for (let t = 1; t < 50; t += 1) l.intentar('a', t);
    expect(l.intentar('a', HORA).ok).toBe(true);
  });
});
